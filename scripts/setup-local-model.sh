#!/bin/sh
# Install the selected engine only. Download is explicit and resumable.
set -eu
FILMMA_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec python3 "$FILMMA_ROOT/runtime/filmma_runtime.py" install-runtime "$@"
