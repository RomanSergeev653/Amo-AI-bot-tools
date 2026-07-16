#!/usr/bin/env bash
# Non-interactive connection check (uses .env / environment).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
exec npx --yes tsx scripts/check-connection.ts
