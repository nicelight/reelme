#!/usr/bin/env bash
# Run by release.sh under the production deployment lock.
set -euo pipefail
umask 077
stage=${1:?}
release=${2:?}
commit=${3:?}
checksum=${4:?}
log_dir="/srv/reelme/releases/$release"
backup="/var/backups/reelme/before-$release"
origin=https://reelme.natureonzoom.win
cd "$stage"
echo "$checksum  source.tar.gz" | sha256sum -c -
mkdir src
tar -xzf source.tar.gz -C src
cd /srv/reelme
docker compose config --quiet
# Production compose or infrastructure changes require their own rollout.
cmp compose.yaml "$stage/src/deploy/compose.yaml"
container=$(docker compose ps -q app)
previous=$(docker inspect "$container" --format '{{.Config.Image}}')
running_commit=$(docker inspect "$container" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')

verify_public() {
  local container_id=$1 expected received code asset asset_checksums
  local -a get=(curl --silent --show-error --retry 3 --connect-timeout 6 --max-time 25)
  expected=$(docker exec "$container_id" sha256sum /app/dist/client/index.html | cut -d' ' -f1)
  received=$("${get[@]}" --fail "$origin/statuses" | sha256sum | cut -d' ' -f1)
  test "$expected" = "$received"
  asset_checksums=$(docker exec "$container_id" sh -c 'cd /app/dist/client && sha256sum assets/App-*.js')
  while read -r expected asset; do
    received=$("${get[@]}" --fail "$origin/$asset" | sha256sum | cut -d' ' -f1)
    if [[ "$expected" != "$received" ]]; then
      echo "Не совпала контрольная сумма $origin/$asset" >&2
      return 1
    fi
  done <<< "$asset_checksums"
  "${get[@]}" --fail "$origin/capture-loader.js" -o /dev/null
  for asset in /api/statuses /api/statuses/fal-balance; do
    code=$("${get[@]}" -o /dev/null -w '%{http_code}' "$origin$asset")
    test "$code" = 401
  done
}
if [[ "$running_commit" = "$commit" && "$(docker inspect "$container" --format '{{.State.Health.Status}}')" = healthy ]]; then
  verify_public "$container"
  echo "Уже развёрнут $previous, публичная проверка прошла."
  exit 0
fi

echo "Собираем reelme:$release"
mkdir -m 0700 "$log_dir"
docker build --label "org.opencontainers.image.revision=$commit" -t "reelme:$release" "$stage/src" > "$log_dir/build.log" 2>&1 || { tail -40 "$log_dir/build.log" >&2; exit 1; }
python3 - <<'PY'
import sqlite3
db = sqlite3.connect('file:/srv/reelme-data/reelme.sqlite?mode=ro', uri=True)
active = db.execute("SELECT state,count(*) FROM capture_sessions WHERE state IN ('submit_pending','observing','preparing') GROUP BY state").fetchall()
if active:
    raise SystemExit('Есть незавершённые генерации. Повторите деплой после завершения: ' + str(active))
PY

schema() {
  python3 -c "import sqlite3; print(sqlite3.connect('file:/srv/reelme-data/reelme.sqlite?mode=ro',uri=True).execute('pragma user_version').fetchone()[0])"
}
old_schema=$(schema)
mkdir -m 0700 "$backup"
cp -a .env compose.yaml /etc/reelme/app.env "$backup/"
recover() {
  local result=$?
  trap - EXIT
  if ((result != 0)); then
    if [[ "$(schema)" = "$old_schema" ]]; then
      echo "Возвращаем $previous" >&2
      cp -a "$backup/.env" .env
      docker compose up -d --no-build --pull never --wait --wait-timeout 120 app
    else
      echo "Схема БД изменилась. Требуется восстановление из $backup с учётом новых записей." >&2
    fi
  fi
  exit "$result"
}
trap recover EXIT
echo "Создаём резервную копию $backup"
docker compose stop app
tar --acls --xattrs --selinux -C /srv -czf "$backup/data.tar.gz" reelme-data
tar -tzf "$backup/data.tar.gz" | grep -Fx 'reelme-data/reelme.sqlite' >/dev/null
grep -q '^REELME_IMAGE=' .env
sed -i "s/^REELME_IMAGE=.*/REELME_IMAGE=reelme:$release/" .env
docker compose up -d --no-build --pull never --wait --wait-timeout 120 app
container=$(docker compose ps -q app)
test "$(docker inspect "$container" --format '{{.Config.Image}}')" = "reelme:$release"
python3 - <<'PY'
import sqlite3
db = sqlite3.connect('file:/srv/reelme-data/reelme.sqlite?mode=ro', uri=True)
if db.execute('pragma integrity_check').fetchall() != [('ok',)] or db.execute('pragma foreign_key_check').fetchone():
    raise SystemExit('Ошибка проверки SQLite')
PY
verify_public "$container"
echo "Развёрнут reelme:$release, предыдущий образ $previous. SQLite и публичный HTTPS проверены."
