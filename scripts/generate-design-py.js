#!/usr/bin/env node

/**
 * ChipFlow Design.py Generator
 * Generates design.py file from JSON configuration for ChipFlow projects
 */

function generateDesignPy(designData) {
  const { enabledBlocks, digitalBlocks: directDigitalBlocks, config } = designData;
  
  // Handle both export formats - from configurator (enabledBlocks) and test files (digitalBlocks)
  const allBlocks = enabledBlocks || directDigitalBlocks || [];
  const digitalBlocks = enabledBlocks ? 
    allBlocks.filter(block => block.type === 'digital') : 
    allBlocks.filter(block => block.enabled);
  const processors = digitalBlocks.filter(block => 
    block.id.includes('cv32e40p') || block.id.includes('minerva')
  );
  const cpu = processors[0]; // Take first processor as main CPU
  
  // Group blocks by type for organization
  const memory = digitalBlocks.filter(block => 
    block.id.includes('sram') || block.id.includes('qspi') || block.id.includes('hyperram')
  );
  const io = digitalBlocks.filter(block => 
    block.id.includes('gpio') || block.id.includes('uart') || 
    block.id.includes('spi') || block.id.includes('i2c')
  );
  const other = digitalBlocks.filter(block => 
    !processors.includes(block) && !memory.includes(block) && !io.includes(block)
  );

  // Generate imports
  const imports = new Set([
    'from pathlib import Path',
    '',
    'from amaranth import Module',
    'from amaranth.lib import wiring',
    'from amaranth.lib.wiring import Out, flipped, connect',
    '',
    'from amaranth_soc import csr, wishbone',
    'from amaranth_soc.csr.wishbone import WishboneCSRBridge',
    '',
    'from chipflow_digital_ip.base import SoCID'
  ]);

  // Add memory imports
  if (memory.some(b => b.id.includes('qspi'))) {
    imports.add('from chipflow_digital_ip.memory import QSPIFlash');
  }
  if (memory.some(b => b.id.includes('hyperram'))) {
    imports.add('from chipflow_digital_ip.memory import HyperRAM');
  }
  if (memory.some(b => b.id.includes('sram')) || !memory.length) {
    imports.add('from amaranth_soc.wishbone.sram import WishboneSRAM');
  }

  // Add IO imports
  const ioImports = [];
  if (io.some(b => b.id.includes('gpio'))) ioImports.push('GPIOPeripheral');
  if (io.some(b => b.id.includes('uart'))) ioImports.push('UARTPeripheral');
  if (io.some(b => b.id.includes('spi'))) ioImports.push('SPIPeripheral');
  if (io.some(b => b.id.includes('i2c'))) ioImports.push('I2CPeripheral');
  
  if (ioImports.length > 0) {
    imports.add(`from chipflow_digital_ip.io import ${ioImports.join(', ')}`);
  }

  // Add processor imports
  if (cpu?.id.includes('cv32e40p')) {
    imports.add('from chipflow_digital_ip.processors import CV32E40P, OBIDebugModule');
  } else if (cpu?.id.includes('minerva')) {
    imports.add('from minerva.core import Minerva');
  }

  // Add platform imports
  const platformImports = ['attach_data', 'SoftwareBuild'];
  if (io.some(b => b.id.includes('gpio'))) platformImports.push('GPIOSignature');
  if (io.some(b => b.id.includes('uart'))) platformImports.push('UARTSignature');
  if (io.some(b => b.id.includes('spi'))) platformImports.push('SPISignature');
  if (io.some(b => b.id.includes('i2c'))) platformImports.push('I2CSignature');
  if (memory.some(b => b.id.includes('qspi'))) platformImports.push('QSPIFlashSignature');
  if (cpu?.id.includes('cv32e40p')) platformImports.push('JTAGSignature');
  
  imports.add(`from chipflow_lib.platforms import ${platformImports.join(', ')}`);

  // Generate interface definitions
  const interfaces = [];
  
  // Add flash interface if QSPI present
  if (memory.some(b => b.id.includes('qspi'))) {
    interfaces.push('"flash": Out(QSPIFlashSignature())');
  }
  
  // Add CPU debug interface
  if (cpu?.id.includes('cv32e40p')) {
    interfaces.push('"cpu_jtag": Out(JTAGSignature())');
  }

  // Add IO interfaces
  io.forEach(block => {
    const count = block.count || 1;
    const bitSize = block.bitSize || (block.id.includes('gpio') ? 8 : undefined);
    
    if (block.id.includes('gpio')) {
      for (let i = 0; i < count; i++) {
        interfaces.push(`"gpio_${i}": Out(GPIOSignature(pin_count=${bitSize || 8}))`);
      }
    } else if (block.id.includes('uart')) {
      for (let i = 0; i < count; i++) {
        interfaces.push(`"uart_${i}": Out(UARTSignature())`);
      }
    } else if (block.id.includes('spi')) {
      const startIndex = interfaces.filter(iface => iface.includes('spi_')).length;
      for (let i = 0; i < count; i++) {
        interfaces.push(`"spi_${startIndex + i}": Out(SPISignature())`);
      }
    } else if (block.id.includes('i2c')) {
      for (let i = 0; i < count; i++) {
        interfaces.push(`"i2c_${i}": Out(I2CSignature())`);
      }
    }
  });

  // Generate memory map
  let memoryMap = `        # Memory regions:
        self.mem_spiflash_base = 0x00000000
        self.mem_sram_base     = 0x10000000

        # Debug region
        self.debug_base        = 0xa0000000

        # CSR regions:
        self.csr_base          = 0xb0000000`;

  if (memory.some(b => b.id.includes('qspi'))) {
    memoryMap += '\n        self.csr_spiflash_base = 0xb0000000';
  }
  
  memoryMap += `
        self.csr_gpio_base     = 0xb1000000
        self.csr_uart_base     = 0xb2000000
        self.csr_soc_id_base   = 0xb4000000`;

  if (io.some(b => b.id.includes('spi'))) {
    memoryMap += '\n        self.csr_spi_base      = 0xb5000000';
  }
  if (io.some(b => b.id.includes('i2c'))) {
    memoryMap += '\n        self.csr_i2c_base      = 0xb6000000';
  }

  memoryMap += `
        
        self.periph_offset     = 0x00100000
        self.sram_size  = 0x800 # 2KiB
        self.bios_start = 0x100000 # 1MiB into spiflash to make room for a bitstream`;

  // Generate CPU instantiation
  let cpuCode = '';
  if (cpu?.id.includes('cv32e40p')) {
    cpuCode = `        # CPU
        cpu = CV32E40P(config="default", reset_vector=self.bios_start, dm_haltaddress=self.debug_base+0x800)
        wb_arbiter.add(cpu.ibus)
        wb_arbiter.add(cpu.dbus)
        m.submodules.cpu = cpu

        # Debug
        debug = OBIDebugModule()
        wb_arbiter.add(debug.initiator)
        wb_decoder.add(debug.target, name="debug", addr=self.debug_base)
        m.d.comb += cpu.debug_req.eq(debug.debug_req)

        m.d.comb += [
            debug.jtag_tck.eq(self.cpu_jtag.tck.i),
            debug.jtag_tms.eq(self.cpu_jtag.tms.i),
            debug.jtag_tdi.eq(self.cpu_jtag.tdi.i),
            debug.jtag_trst.eq(self.cpu_jtag.trst.i),
            self.cpu_jtag.tdo.o.eq(debug.jtag_tdo),
        ]
        m.submodules.debug = debug`;
  } else if (cpu?.id.includes('minerva')) {
    cpuCode = `        # CPU
        cpu = Minerva(reset_address=self.bios_start, with_muldiv=True)
        wb_arbiter.add(cpu.ibus)
        wb_arbiter.add(cpu.dbus)
        m.submodules.cpu = cpu`;
  }

  // Generate memory components
  let memoryCode = '';
  
  // QSPI Flash
  if (memory.some(b => b.id.includes('qspi'))) {
    memoryCode += `
        # QSPI Flash
        spiflash = QSPIFlash(addr_width=24, data_width=32)
        wb_decoder.add(spiflash.wb_bus, name="spiflash", addr=self.mem_spiflash_base)
        csr_decoder.add(spiflash.csr_bus, name="spiflash", addr=self.csr_spiflash_base - self.csr_base)
        m.submodules.spiflash = spiflash
        connect(m, flipped(self.flash), spiflash.pins)`;
  }

  // SRAM (always include basic SRAM)
  memoryCode += `
        # SRAM
        from amaranth_soc.wishbone.sram import WishboneSRAM
        sram = WishboneSRAM(size=self.sram_size, data_width=32, granularity=8)
        wb_decoder.add(sram.wb_bus, name="sram", addr=self.mem_sram_base)
        m.submodules.sram = sram`;

  // Generate IO components
  let ioCode = '';
  
  // GPIO
  const gpioBlocks = io.filter(b => b.id.includes('gpio'));
  gpioBlocks.forEach((block, index) => {
    const bitSize = block.bitSize || 8;
    ioCode += `
        # GPIO ${index}
        m.submodules.gpio_${index} = gpio_${index} = GPIOPeripheral(pin_count=${bitSize}, addr_width=5)
        csr_decoder.add(gpio_${index}.bus, name="gpio_${index}", addr=self.csr_gpio_base + ${index} * self.periph_offset - self.csr_base)
        connect(m, flipped(self.gpio_${index}), gpio_${index}.pins)`;
  });

  // UART
  const uartBlocks = io.filter(b => b.id.includes('uart'));
  uartBlocks.forEach((block, index) => {
    ioCode += `
        # UART ${index}
        m.submodules.uart_${index} = uart_${index} = UARTPeripheral(init_divisor=int(25e6//115200), addr_width=5)
        csr_decoder.add(uart_${index}.bus, name="uart_${index}", addr=self.csr_uart_base + ${index} * self.periph_offset - self.csr_base)
        connect(m, flipped(self.uart_${index}), uart_${index}.pins)`;
  });

  // SPI
  const spiBlocks = io.filter(b => b.id.includes('spi'));
  let spiIndex = 0;
  spiBlocks.forEach((block) => {
    const count = block.count || 1;
    for (let i = 0; i < count; i++) {
      ioCode += `
        # SPI ${spiIndex}
        m.submodules.spi_${spiIndex} = spi_${spiIndex} = SPIPeripheral()
        csr_decoder.add(spi_${spiIndex}.bus, name="spi_${spiIndex}", addr=self.csr_spi_base + ${spiIndex} * self.periph_offset - self.csr_base)
        connect(m, flipped(self.spi_${spiIndex}), spi_${spiIndex}.spi_pins)`;
      spiIndex++;
    }
  });

  // I2C
  const i2cBlocks = io.filter(b => b.id.includes('i2c'));
  i2cBlocks.forEach((block, index) => {
    ioCode += `
        # I2C ${index}
        m.submodules.i2c_${index} = i2c_${index} = I2CPeripheral()
        csr_decoder.add(i2c_${index}.bus, name="i2c_${index}", addr=self.csr_i2c_base + ${index} * self.periph_offset - self.csr_base)
        connect(m, flipped(self.i2c_${index}), i2c_${index}.i2c_pins)`;
  });

  // Generate the complete design.py file
  const designPy = `${Array.from(imports).join('\n')}

__all__ = ["MySoC"]

class MySoC(wiring.Component):
    def __init__(self):
        # Top level interfaces
        super().__init__({
${interfaces.map(iface => '            ' + iface).join(',\n')}
        })

${memoryMap}

    def elaborate(self, platform):
        m = Module()

        wb_arbiter  = wishbone.Arbiter(addr_width=30, data_width=32, granularity=8)
        wb_decoder  = wishbone.Decoder(addr_width=30, data_width=32, granularity=8)
        csr_decoder = csr.Decoder(addr_width=28, data_width=8)

        m.submodules.wb_arbiter  = wb_arbiter
        m.submodules.wb_decoder  = wb_decoder
        m.submodules.csr_decoder = csr_decoder

        connect(m, wb_arbiter.bus, wb_decoder.bus)

${cpuCode}
${memoryCode}
${ioCode}

        # SoC ID
        soc_id = SoCID(type_id=0xCA7F100F)
        csr_decoder.add(soc_id.bus, name="soc_id", addr=self.csr_soc_id_base - self.csr_base)
        m.submodules.soc_id = soc_id

        # Wishbone-CSR bridge
        wb_to_csr = WishboneCSRBridge(csr_decoder.bus, data_width=32)
        wb_decoder.add(wb_to_csr.wb_bus, name="csr", addr=self.csr_base, sparse=False)
        m.submodules.wb_to_csr = wb_to_csr

        sw = SoftwareBuild(sources=Path('design/software').glob('*.c'),
                           offset=self.bios_start)

        # you need to attach data to both the internal and external interfaces${memory.some(b => b.id.includes('qspi')) ? '\n        attach_data(self.flash, m.submodules.spiflash, sw)' : ''}
        return m


if __name__ == "__main__":
    from amaranth.back import verilog
    soc_top = MySoC()
    with open("build/soc_top.v", "w") as f:
        f.write(verilog.convert(soc_top, name="soc_top"))
`;

  return designPy;
}

// Export function for use in Node.js
// Export for CommonJS
module.exports = { generateDesignPy };

// CLI usage - check if this file is being run directly
if (require.main === module) {
  const fs = require('fs');

  if (process.argv.length < 3) {
    console.error('Usage: node generate-design-py.js <design.json>');
    process.exit(1);
  }

  const designPath = process.argv[2];
  const designData = JSON.parse(fs.readFileSync(designPath, 'utf8'));

  const designPy = generateDesignPy(designData);
  console.log(designPy);
}