#!/usr/bin/env bash
set -e

echo "========================================"
echo "  Sakuya - Dev Server"
echo "========================================"
echo ""

if ! command -v bun &>/dev/null; then
    echo "Bun is not installed. Run ./setup.sh first."
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "Dependencies not found. Running bun install..."
    bun install
fi

# Ports, bind address, login and resource limits all come from sakuya.config.json (created with the
# defaults on first run). The server and web URLs are printed below once each is up.
echo "Starting development server..."
echo ""

bun dev
