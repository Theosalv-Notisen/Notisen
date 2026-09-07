#!/bin/sh
# Wrapper so the preview runner finds our userland Node install.
export PATH="$HOME/.local/node/bin:$PATH"
cd "$(dirname "$0")/.."
exec npm run dev
