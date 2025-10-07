#!/bin/bash

set -e

echo "🚀 Setting up ChipFlow development environment..."

# Single optimized package installation - remove duplicates and combine operations
echo "📦 Installing system dependencies (optimized)..."
sudo apt-get update && sudo apt-get install -y \
    build-essential \
    curl \
    wget \
    make \
    cmake \
    pkg-config \
    libffi-dev \
    libssl-dev \
    zlib1g-dev \
    libbz2-dev \
    libreadline-dev \
    libsqlite3-dev \
    libncurses5-dev \
    libgdbm-dev \
    libnss3-dev \
    liblzma-dev \
    jq \
    && sudo apt-get clean && sudo rm -rf /var/lib/apt/lists/*

# Install PDM and development tools in parallel where possible
echo "🐍 Installing PDM and development tools..."
{
    # Install PDM
    curl -sSL https://pdm-project.org/install-pdm.py | python3 - &

    # Download ripgrep and fd in parallel
    curl -sSLO https://github.com/BurntSushi/ripgrep/releases/download/13.0.0/ripgrep_13.0.0_amd64.deb &
    curl -sSLO https://github.com/sharkdp/fd/releases/download/v8.7.0/fd_8.7.0_amd64.deb &

    wait # Wait for all downloads to complete
}

# Install downloaded packages
sudo dpkg -i ripgrep_13.0.0_amd64.deb fd_8.7.0_amd64.deb && rm -f *.deb

# Add PDM to PATH
export PATH="/home/vscode/.local/bin:$PATH"
echo 'export PATH="/home/vscode/.local/bin:$PATH"' >> ~/.bashrc

# Verify PDM installation
pdm --version

# Check if design configuration was passed from configurator
if [ -n "$CHIPFLOW_DESIGN_CONFIG" ]; then
    echo "🎨 Generating ChipFlow design from configurator..."

    # Decode and save design configuration
    echo "$CHIPFLOW_DESIGN_CONFIG" | base64 -d > design.json
    echo "✅ Design configuration saved to design.json"

    # The design files will be generated after dependencies are installed
    export GENERATE_DESIGN_ON_START=1
fi

# Install project dependencies if pyproject.toml exists
if [ -f "pyproject.toml" ]; then
    echo "📚 Installing Python dependencies..."
    pdm install --dev

    # If design configuration exists, generate design files
    if [ -n "$GENERATE_DESIGN_ON_START" ] && [ -f "design.json" ]; then
        echo "🔨 Generating design.py from configuration..."

        # Create design directory structure
        mkdir -p design/software design/steps design/tests

        # Use Node.js to generate design.py from design.json
        node scripts/generate-design-py.js design.json design/design.py \
            && echo "✅ Design files generated successfully" \
            || echo "⚠️  Could not generate design files automatically"

        # Generate README with design information
        if [ -f "design.json" ]; then
            ACTIVE_CONFIG=$(jq -r '.activeConfigId // "unknown"' design.json)
            ENABLED_BLOCKS=$(jq -r '.enabledBlocks | length' design.json)

            cat > README.md << EOF
# ChipFlow Design

**Generated from configurator**

- **Configuration**: ${ACTIVE_CONFIG}
- **Enabled Blocks**: ${ENABLED_BLOCKS}
- **Generated**: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

## Quick Start

\`\`\`bash
# Build and run simulation
pdm chipflow sim build
pdm chipflow sim run

# Generate Verilog
pdm chipflow build
\`\`\`

## VS Code Tasks

Use the Run/Debug button (F5) or Terminal → Run Task to:
- Build simulation
- Run simulation
- Generate Verilog

## Project Structure

- \`design/design.py\` - Generated Amaranth HDL design
- \`design/software/\` - Embedded software
- \`chipflow.toml\` - ChipFlow configuration
- \`.vscode/\` - VS Code tasks and launch configs
EOF
        fi
    fi

    # Create optimized activation script
    cat > activate_env.sh << 'EOF'
#!/bin/bash
eval $(pdm info --env)
echo "✅ ChipFlow environment activated!"
echo "📋 Run 'pdm run --list' to see available commands"
EOF
    chmod +x activate_env.sh
else
    echo "⚠️  No pyproject.toml found, skipping dependency installation"
fi

# Optimized git configuration (minimal)
git config --global init.defaultBranch main
git config --global pull.rebase false

# Create minimal welcome message
cat > README_CODESPACE.md << 'EOF'
# 🚀 ChipFlow Codespace

## Quick Start
```bash
source activate_env.sh    # Activate environment
pdm run --list            # See available commands
pdm run sim-check         # Run simulation with verification
```

## Key Commands
- `pdm run chipflow` - ChipFlow CLI
- `pdm run sim-run` - Run simulation
- `pdm run sim-check` - Run simulation with verification
- `pdm run test` - Run tests
- `pdm run lint` - Code linting

Happy coding! 🎉
EOF

echo "✅ ChipFlow environment ready! Run: source activate_env.sh"