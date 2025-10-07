from pathlib import Path

from amaranth import Module
from amaranth.lib import wiring
from amaranth.lib.wiring import Out, flipped, connect
from amaranth_soc import csr, wishbone
from amaranth_soc.csr.wishbone import WishboneCSRBridge
from chipflow_digital_ip.base import SoCID
from amaranth_soc.wishbone.sram import WishboneSRAM
from chipflow_lib.platforms import attach_data, SoftwareBuild

__all__ = ["MySoC"]

class MySoC(wiring.Component):
    def __init__(self):
        # Top level interfaces
        super().__init__({

        })

        # Memory regions:
        self.mem_spiflash_base = 0x00000000
        self.mem_sram_base     = 0x10000000

        # Debug region
        self.debug_base        = 0xa0000000

        # CSR regions:
        self.csr_base          = 0xb0000000
        self.csr_gpio_base     = 0xb1000000
        self.csr_uart_base     = 0xb2000000
        self.csr_soc_id_base   = 0xb4000000
        
        self.periph_offset     = 0x00100000
        self.sram_size  = 0x800 # 2KiB
        self.bios_start = 0x100000 # 1MiB into spiflash to make room for a bitstream

    def elaborate(self, platform):
        m = Module()

        wb_arbiter  = wishbone.Arbiter(addr_width=30, data_width=32, granularity=8)
        wb_decoder  = wishbone.Decoder(addr_width=30, data_width=32, granularity=8)
        csr_decoder = csr.Decoder(addr_width=28, data_width=8)

        m.submodules.wb_arbiter  = wb_arbiter
        m.submodules.wb_decoder  = wb_decoder
        m.submodules.csr_decoder = csr_decoder

        connect(m, wb_arbiter.bus, wb_decoder.bus)



        # SRAM
        from amaranth_soc.wishbone.sram import WishboneSRAM
        sram = WishboneSRAM(size=self.sram_size, data_width=32, granularity=8)
        wb_decoder.add(sram.wb_bus, name="sram", addr=self.mem_sram_base)
        m.submodules.sram = sram


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

        # you need to attach data to both the internal and external interfaces
        return m


if __name__ == "__main__":
    from amaranth.back import verilog
    soc_top = MySoC()
    with open("build/soc_top.v", "w") as f:
        f.write(verilog.convert(soc_top, name="soc_top"))
