#!/usr/bin/env bash
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
trap 'printf "\nSetup stopped. Review the failure; do not retry partial migrations automatically.\n" >&2' ERR
mode="${1:-}"
if [[ "$mode" != test && "$mode" != production ]] || [[ $# -gt 2 ]] || [[ $# -eq 2 && "$2" != --skip-install ]]; then
  echo 'Usage: bash setup.sh <test|production> [--skip-install]' >&2
  exit 1
fi
command -v node >/dev/null || { echo 'Install Node.js 22.12+ first.' >&2; exit 1; }
command -v npm >/dev/null || { echo 'npm is required.' >&2; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12)){console.error("Node.js 22.12+ required");process.exit(1)}'
echo 'MySQL must already be running. Create an EMPTY database first; see README.fa.md.'
if [[ "${2:-}" != '--skip-install' ]]; then npm ci --no-audit --no-fund; fi
if [[ ! -f .env ]]; then npm run setup:env -- "$mode"; else echo 'Existing .env preserved.'; fi
npm run db:check -- "$mode"
npm run db:generate
npm run db:deploy -- "$mode"
npm run db:admin -- "$mode" --if-missing
npm run typecheck
npm run build
printf '\nSetup complete. Run: npm start -- --hostname 127.0.0.1\nLocal test: http://localhost:3000. Production: configure HTTPS reverse proxy before login.\n'
