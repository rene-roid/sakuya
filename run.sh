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

echo "Starting development server..."
echo "  Backend  : http://localhost:3777"
echo "  Frontend : http://localhost:5173"
echo ""

bun dev
