#!/usr/bin/env bash
set -e

# ---------------------------------------------------------------------------
# Optional hard resource ceiling, the non-Docker counterpart to the `cpus` and
# `mem_limit` in docker-compose.yml.
#
# The SAKUYA_MAX_* knobs in .env cap what the app *asks for* (job concurrency,
# ffmpeg/onnx/libvips threads). They cannot stop a runaway the way Docker can,
# because Docker's limits are kernel cgroup limits. systemd can hand us the same
# cgroup outside Docker, so when it is available we re-exec this script inside a
# transient scope. Everything here fails soft: no systemd, an unwritable
# controller, or a bad value leaves the app running with in-app limits only,
# because a resource knob should never be the reason the server won't boot.
#
# Skipped entirely when neither variable is set. Set SAKUYA_HARD_LIMIT=false to
# keep the in-app limits but never wrap.
# ---------------------------------------------------------------------------
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

# Read a single KEY=value out of .env. Deliberately not `source`: .env is data,
# and sourcing it would execute whatever happens to be in there.
env_value() {
    [ -f .env ] || return 0
    sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" .env | tail -n1 | tr -d "\"' \r"
}

MAX_MEMORY="${SAKUYA_MAX_MEMORY:-$(env_value SAKUYA_MAX_MEMORY)}"
MAX_CPUS="${SAKUYA_MAX_CPUS:-$(env_value SAKUYA_MAX_CPUS)}"
HARD_LIMIT="${SAKUYA_HARD_LIMIT:-$(env_value SAKUYA_HARD_LIMIT)}"

if [ -z "${SAKUYA_HARD_LIMIT_APPLIED:-}" ] && [ "$HARD_LIMIT" != "false" ] &&
   { [ -n "$MAX_MEMORY" ] || [ -n "$MAX_CPUS" ]; }; then
    if command -v systemd-run &>/dev/null; then
        props=()
        [ -n "$MAX_MEMORY" ] && props+=(-p "MemoryMax=$(echo "$MAX_MEMORY" | tr '[:lower:]' '[:upper:]')")
        # systemd counts a core as 100%, so 1.5 CPUs is CPUQuota=150%.
        [ -n "$MAX_CPUS" ] && props+=(-p "CPUQuota=$(awk -v c="$MAX_CPUS" 'BEGIN{printf "%d", c*100}')%")

        # Dry-run the scope before committing to it. The cpu controller is often not delegated to
        # user slices, and this is the only way to find out without either masking the real exit
        # code or losing the chance to fall back.
        if systemd-run --user --scope --collect --quiet "${props[@]}" true &>/dev/null; then
            echo "Hard limits via systemd: ${props[*]}"
            echo ""
            export SAKUYA_HARD_LIMIT_APPLIED=true
            exec systemd-run --user --scope --collect --quiet "${props[@]}" "$SCRIPT_PATH" "$@"
        fi
        echo "Note: systemd-run rejected ${props[*]} (the cpu controller is commonly not"
        echo "      delegated to user slices). Continuing with in-app limits only."
        echo ""
    else
        echo "Note: systemd-run not found, so SAKUYA_MAX_MEMORY cannot be enforced as a"
        echo "      real ceiling. In-app concurrency/thread limits still apply."
        echo ""
    fi
fi

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
