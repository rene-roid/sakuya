#!/usr/bin/env bash
set -e

if ! command -v bun &>/dev/null; then
    echo "Bun is not installed. Run ./setup.sh first."
    exit 1
fi

bun install

# Ports, bind address, login and resource limits all come from sakuya.config.json (created with the
# defaults on first run). The server and web URLs are printed below once each is up.
bun dev
