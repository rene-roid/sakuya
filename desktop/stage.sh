#!/usr/bin/env bash
# Assembles what the desktop app ships into desktop/stage/sakuya: the server, the built web UI, a
# production-only node_modules for the OS this runs on, and the Bun binary that runs it all.
# Native modules are per-OS, so each platform's installer has to be staged on that platform.
set -euo pipefail
cd "$(dirname "$0")/.."
out=desktop/stage/sakuya

rm -rf desktop/stage
mkdir -p "$out/bin"
bun run build
git ls-files package.json bun.lock tsconfig.base.json packages apps/server apps/web/package.json ':!*.test.ts' |
  tar -cf - -T - | tar -xf - -C "$out"
cp -r apps/web/dist "$out/apps/web/dist"
cp "$(bun -e 'console.log(process.execPath)')" "$out/bin/"

cd "$out"
# Hoisted: real folders instead of symlinks into node_modules/.bun, which an installer can't carry.
bun install --frozen-lockfile --production --linker hoisted
# The workspace link is a symlink (a junction on Windows); swap it for a real copy.
rm -rf node_modules/.bin node_modules/@sakuya
mkdir -p node_modules/@sakuya
cp -r ../../../packages/shared node_modules/@sakuya/shared

# onnxruntime-node and ffprobe-static ship binaries for every OS; keep only this one's.
os=$(bun -e 'console.log(process.platform)')
for dir in node_modules/onnxruntime-node/bin/napi-v*/* node_modules/ffprobe-static/bin/*; do
  [ "$(basename "$dir")" = "$os" ] || rm -rf "$dir"
done
