#!/usr/bin/env bash
# Run every quality gate the package exposes. Intentionally dependency-free so
# `npm run check` works in a fresh checkout without an install step.
set -euo pipefail

cd "$(dirname "$0")/.."

node scripts/lint.js
node scripts/typecheck.js
node test/index.js
