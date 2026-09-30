#!/usr/bin/env bash
# One-command setup for a new machine:  bash setup.sh
set -u
cd "$(dirname "$0")"
say() { printf '\n== %s\n' "$1"; }

say "Node"
command -v node >/dev/null || { echo "Node is not installed. Install Node 20.11+ (https://nodejs.org or 'brew install node') and re-run."; exit 1; }
node -v

say "Dependencies"
if [ -f package-lock.json ]; then npm ci || npm install || exit 1; else npm install || exit 1; fi

say "Browser (Playwright Chromium)"
npx playwright install chromium || echo "Could not download Chromium (managed network?). That is OK if Google Chrome is installed: the tool falls back to it."

say "Settings"
if [ ! -f .env ]; then cp .env.example .env && echo "Created .env. Open it and paste your keys (never share them in chat or commit them)."; else echo ".env already exists, left untouched."; fi

say "Check"
node bin/mole.mjs doctor
