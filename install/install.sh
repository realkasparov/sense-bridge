#!/bin/bash
# Usage: ./install/install.sh [chrome-extension-id]
#
# A thin wrapper for people working from a clone. Everything it does lives in the
# CLI, so a clone and an npm install register the connector identically.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$REPO/dist/cli.js" ]; then
  echo "dist/cli.js is missing - run 'npm run build' first." >&2
  exit 1
fi

exec node "$REPO/dist/cli.js" install "$@"
