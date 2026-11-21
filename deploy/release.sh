#!/usr/bin/env bash
# Deploy the current committed ReelMe application from the workstation.
set -euo pipefail
umask 077
case "$#:${1:-}" in
  0:) with_tests=false ;;
  1:--with-tests) with_tests=true ;;
  *) echo "Использование: $0 [--with-tests]" >&2; exit 2 ;;
esac
cd "$(dirname "$0")/.."
commit=$(git rev-parse --verify 'HEAD^{commit}')
release="$(date -u +%Y%m%dT%H%M%SZ)-${commit:0:12}"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
ssh_cmd=(ssh -o BatchMode=yes -o ConnectTimeout=15 nskserver)
image_files=(Dockerfile .dockerignore package.json package-lock.json 'tsconfig*.json'
  vite.config.ts index.html src WebServer/reelme.html public/slot-prompts public/test-videos deploy/compose.yaml)

echo "Разворачиваем коммит $commit на nskserver"
git archive --format=tar.gz --output="$work/source.tar.gz" "$commit" -- "${image_files[@]}"
checksum=$(sha256sum "$work/source.tar.gz" | cut -d' ' -f1)
if [[ "$with_tests" = true ]]; then
  echo "Запускаем серверные и общие тесты коммита ${commit:0:12}"
  mkdir "$work/check"
  tar -xzf "$work/source.tar.gz" -C "$work/check"
  git archive "$commit" tests | tar -x -C "$work/check"
  (
    cd "$work/check"
    npm ci --include=dev --prefer-offline --no-audit --no-fund
    node --import tsx --test --test-concurrency=1 tests/*.test.ts
  )
fi

# Keep the uploaded build context only for this invocation, including on failure.
remote_runner='
set -eu
umask 077
stage=$(mktemp -d)
cleanup() { rm -rf -- "$stage"; }
trap cleanup EXIT
tar -x -C "$stage"
bash "$stage/activate-release.sh" "$stage" "$@"
'
tar -c -C "$work" source.tar.gz -C "$PWD/deploy" activate-release.sh |
  "${ssh_cmd[@]}" "sudo -n flock -n /run/lock/reelme-deploy.lock bash -c '$remote_runner' bash '$release' '$commit' '$checksum'"
