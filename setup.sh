#!/usr/bin/env bash
set -e

echo "========================================"
echo "  Sakuya - Setup"
echo "========================================"
echo ""

if ! command -v bun &>/dev/null; then
    echo "Bun is not installed. Installing Bun..."
    curl -fsSL https://bun.sh/install | bash

    if [ $? -ne 0 ]; then
        echo "Failed to install Bun. Please install it manually from https://bun.sh"
        exit 1
    fi

    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    echo "Bun installed successfully."
else
    echo "Bun found: $(bun --version)"
fi

echo ""
echo "Installing dependencies..."
bun install

echo ""
echo "Setup complete. Run ./run.sh to start the dev server."
