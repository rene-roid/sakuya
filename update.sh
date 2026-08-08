#!/usr/bin/env bash
set -e

echo "========================================"
echo "  Sakuya - Update"
echo "========================================"
echo ""

if ! command -v bun &>/dev/null; then
    echo "Bun is not installed. Run ./setup.sh first."
    exit 1
fi

echo "Pulling latest changes..."
git pull

echo ""
echo "Updating dependencies..."
bun install

echo ""
echo "Update complete. Run ./run.sh to start the dev server."
