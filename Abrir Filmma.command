#!/bin/zsh
set -e
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null; then
  echo "Filmma necesita Node.js 22 o superior. Instálalo y vuelve a abrir este archivo."
  read -k 1
  exit 1
fi
if [ ! -d node_modules ]; then npm ci; fi
if [ ! -f dist/index.html ]; then npm run build; fi
node scripts/launch.mjs
