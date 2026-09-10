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
if [ -d "$HOME/.sakuya" ]; then
    echo "Data folder: $HOME/.sakuya (already set up)"
elif [ -f "apps/server/data/tbge.db" ]; then
    echo "Data folder: apps/server/data (existing database found)"
    echo "Move it to $HOME/.sakuya any time from Settings > System in the web UI."
else
    echo "Where should Sakuya keep its data (database, thumbnails, uploads, downloads)?"
    echo "  1) $HOME/.sakuya  - survives reinstalling or moving the app folder (recommended)"
    echo "  2) apps/server/data - inside this project folder"
    read -rp "Choice [1]: " data_choice || true
    if [ "$data_choice" = "2" ]; then
        mkdir -p apps/server/data
        echo "Using apps/server/data."
    else
        mkdir -p "$HOME/.sakuya"
        echo "Using $HOME/.sakuya."
    fi
fi

echo ""
echo "Installing dependencies..."
bun install

echo ""
echo "Setup complete. Run ./run.sh to start the dev server."
