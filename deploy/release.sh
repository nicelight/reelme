#!/usr/bin/env bash
# Deploy the current committed ReelMe application from the workstation.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
commit=$(git rev-parse --verify 'HEAD^{commit}')
release="$(date -u +%Y%m%dT%H%M%SZ)-${commit:0:12}"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
ssh_cmd=(ssh -o BatchMode=yes -o ConnectTimeout=15 nskserver)
image_files=(Dockerfile .dockerignore package.json package-lock.json 'tsconfig*.json'
  vite.config.ts index.html src WebServer/reelme.html public/slot-prompts public/test-videos deploy/compose.yaml)

echo "Проверяем коммит $commit"
git archive --format=tar.gz --output="$work/source.tar.gz" "$commit" -- "${image_files[@]}"
checksum=$(sha256sum "$work/source.tar.gz" | cut -d' ' -f1)
mkdir "$work/check"
tar -xzf "$work/source.tar.gz" -C "$work/check"
git archive "$commit" tests | tar -x -C "$work/check"
(
  cd "$work/check"
  npm ci --prefer-offline --no-audit --no-fund
  node --import tsx --test --test-concurrency=1 tests/*.test.ts
) > "$work/check.log" 2>&1 || { cat "$work/check.log" >&2; exit 1; }
tail -9 "$work/check.log"

# All interpolated remote arguments are generated timestamps or Git/SHA hex.
remote_dir="/srv/reelme/releases/$release"
"${ssh_cmd[@]}" "sudo -n mkdir -m 0700 '$remote_dir' && sudo -n tee '$remote_dir/source.tar.gz' >/dev/null" < "$work/source.tar.gz"
"${ssh_cmd[@]}" "sudo -n tee '$remote_dir/tests.log' >/dev/null" < "$work/check.log"
"${ssh_cmd[@]}" "sudo -n flock -n /run/lock/reelme-deploy.lock bash -s -- '$release' '$commit' '$checksum'" < deploy/activate-release.sh
