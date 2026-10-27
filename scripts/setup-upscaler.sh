#!/bin/sh
# Install only the pinned local super-resolution engine; no video-model changes.
set -eu
FILMMA_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FILMMA_UPSCALE_PYTHON=${FILMMA_UPSCALE_PYTHON:-python3}
exec "$FILMMA_UPSCALE_PYTHON" "$FILMMA_ROOT/runtime/filmma_upscale.py" setup --json "$@"
