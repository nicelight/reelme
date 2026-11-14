# Развёртывание ReelMe на igornskprod

Состояние подготовки: 14 ноября 2026. SSH alias — **`igornskprod`** (порядок букв отличается от имени этого файла). Приложение на сервере **не развёрнуто**. DNS настраивает оператор.

Принято: собирать Docker-образ на локальном компьютере для `linux/amd64`, переносить готовый архив на VPS. На VPS не выполнять `docker build`, `npm ci`, TypeScript/Vite-сборку. Node.js, FFmpeg и нативные зависимости находятся внутри образа; ОС контейнера не обязана совпадать с AlmaLinux хоста. Существующий Caddy остаётся системным сервисом.

## Сервер и исходное состояние

| Параметр | Проверено |
|---|---|
| Подключение | `ssh igornskprod`, пользователь root |
| Hostname / ОС | `igornskprod-alma9`, AlmaLinux 9.8, x86_64 |
| IPv4 | `46.8.200.99` |
| CPU | 2 vCPU, AMD EPYC 9654 |
| RAM / swap | 1,7 GiB / 190 MiB; перед подготовкой доступно около 1,2 GiB RAM |
| Диск | корневой раздел 20 GB; до подготовки свободно около 16 GB |
| Caddy | 2.11.4, уже установлен, service active; TCP 80/443, UDP 443, admin API 127.0.0.1:2019 |
| FRP | `frps.service`, слушает 127.0.0.1:7000 |
| Защита | SELinux Enforcing; firewalld public: ssh/http/https |
| ReelMe | порт 3000 свободен; приложение, БД и секреты не установлены |

Действующий `/etc/caddy/Caddyfile` обслуживает `face-moment.ru` и `face-time.moment-studio.ru`. Имена заданы в `/etc/caddy/face-moment.env`, подключённом systemd drop-in `/etc/systemd/system/caddy.service.d/face-moment.conf`.

- `/~!frp` проксируется на `127.0.0.1:7000`.
- Остальные запросы — на `https://127.0.0.1:18443`, с внутренним TLS SNI `localhost` и существующим `tls_insecure_skip_verify`.
- **До изменений оба домена уже возвращали HTTPS 502**, а порт 18443 не слушался. Это исходная недоступность старого backend; функциональную работоспособность полного FRP-туннеля подтвердить нельзя. Исправление старого backend не выполнялось.
- До/после подготовки проверяются контрольные суммы Caddyfile, Caddy env и FRP TOML, PID/счётчики рестартов служб и ответы обоих доменов. Не заменять старый Caddyfile конфигурацией только ReelMe.

Резервная копия исходной конфигурации и журналы подготовки: `/root/reelme-prep-20261114/` (каталог 0700; содержит секреты, не переносить в Git). В частности: `proxy.sha256`, `proxy-services.before`, `listeners.before`, `nft.before`, `docker-install.log`.

## Подготовлено

- Docker Engine 29.9.3, containerd 2.4.2, Compose plugin 5.7.1 из Docker RHEL RPM repository. Установка добавляет 5 пакетов, без обновления Caddy/FRP. Docker включён в автозагрузку.
- `/etc/docker/daemon.json`: драйвер логов `local`, ротация 3 × 10 MB, `ip-forward-no-drop: true`. Последнее сохраняет разрешающую политику forwarding при старте Docker. Docker добавляет собственные bridge/NAT/firewalld-правила; это не утверждение о неизменности всего firewall. Входящие правила public и старые службы проверяются отдельно.
- Системный пользователь `reelme`: UID 989, GID 988, без shell. Эти значения зафиксированы в Compose.
- `/srv/reelme/` — Compose и файл выбранного образа; `/srv/reelme-data/` — SQLite, ключ установки, фото/видео, владелец 989:988, режим 0700.
- `/etc/reelme/` — конфигурация; `/var/backups/reelme/` — закрытый каталог резервных копий.
- `/srv/reelme/compose.yaml` и `/etc/reelme/app.env.example` скопированы. Боевой `app.env` не создан, credentials не задавались.
- Caddyfile не изменён и не перезагружен. Домен ReelMe не подключён. На сервер не передавался образ ReelMe и не запускался setup приложения.

До выбора Docker был отдельно распакован Node 22.23.5 в `/opt/reelme-runtime/` (SHA256 проверен по nodejs.org). Он не добавлен в PATH и не используется контейнером. Попытка host-установки FFmpeg завершилась до RPM-транзакции из-за HTTP 403 зеркала Cisco openh264; host FFmpeg для Docker не нужен. `/srv/reelme/releases/` остался пустым от предварительного варианта с systemd.

### Результаты проверок подготовки

- На VPS: `dockerd --validate` и Compose `config --no-env-resolution --quiet` успешны; `hello-world` выполнен, исходящий HTTPS из временного curl-контейнера вернул 200. Тестовые контейнеры удалены, `docker ps -a` пуст.
- Caddy/FRP: все три SHA256 совпали; PID 18136/18310 и NRestarts=0 сохранились. Оба домена до/после отвечают 502. Проверено сохранение исходного состояния, не исправность недоступного старого backend.
- Отдельный `/root/reelme-prep-20261114/Caddyfile.candidate` с новым доменом прошёл `caddy validate` с рабочим env; не применён. Осталось прежнее предупреждение о лишнем `header_up X-Forwarded-For` и замечание о форматировании черновика.
- После подготовки: доступно около 1,1 GiB RAM, на диске свободно около 16 GB. RSS dockerd + containerd в простое/после pull составлял примерно 140–170 MiB; это ориентир, не верхняя граница расхода Docker.
- Локально собран `reelme:prep-20261114`, linux/amd64; image ID `sha256:95f4bcd9c86179a293ea176f7101b395b373a2651d80cc70f4ad500707ed7e67`. `npm run check` — 0 ошибок/предупреждений; `npm run build` успешен. Audit полного build-дерева сообщил 2 low findings; после удаления devDependencies — 0.
- Локальный smoke этого образа: setup SQLite и двух тестовых аккаунтов; HTTP `/` и `/capture-loader.js` — 200; sharp создаёт JPEG; FFmpeg кодирует/декодирует H.264 и извлекает кадр; после restart аккаунты сохранены и HTTP доступен. Проверено с UID 989:988, read-only rootfs и лимитом 1 GiB; после restart Docker stats показал 47,44 MiB в простое. Временные контейнер и volume удалены.
- На VPS образ ReelMe не загружен. Реальная нагрузка, SELinux bind mount приложения, HTTPS нового домена, fal, SMTP и камера пока не проверены. Локальный smoke не заменяет эту приёмку.

## Файлы поставки и память

- [Dockerfile](Dockerfile): multi-stage build, Node 22.23.5, production dependencies и FFmpeg в итоговом Debian Bookworm образе. Сборка запускает `npm run check` и `npm run build`.
- [.dockerignore](.dockerignore): разрешает только исходники и build manifests; `.env`, Git, локальные данные и `node_modules` не отправляются в build context.
- [deploy/compose.yaml](deploy/compose.yaml): только `image`, без `build`, `pull_policy: never`, порт `127.0.0.1:3000`, непривилегированный UID, read-only rootfs, отдельный writable `/data`, SELinux `:Z`, tmpfs `/tmp`, ротация логов, healthcheck.
- [deploy/app.env.example](deploy/app.env.example): шаблон server-only credentials. Compose читает значения буквально (`format: raw`): без shell-кавычек, по одной строке на значение.

Начальный предел **1 GiB на весь контейнер**, включая Node, FFmpeg, tmpfs и учитываемую cgroup память. Swap для контейнера отключён (`memswap_limit` равен `mem_limit`). Остальная память нужна ОС, Docker, Caddy и FRP. Тяжёлая генерация моделей выполняется в fal; локально остаются загрузки, изображения, проверка и декодирование видео. Этот лимит требует проверки реальными материалами: большой upload и декодирование могут привести к OOM. Не повышать лимит вслепую на этом VPS. При нехватке — увеличить RAM сервера либо отдельно оптимизировать обработку медиа.

20 GB диска также не подтверждены как достаточные для 14 дней хранения. Учитывать фотографии, видео, образы и резервные копии; оставлять минимум несколько GB свободными. Healthcheck проверяет HTTP, не fal/SMTP и не всю бизнес-функциональность. Docker restart policy перезапускает завершившийся процесс, но сам по себе статус unhealthy перезапуска не вызывает.

## Будущее развёртывание: только после отдельной команды оператора

Следующие команды — инструкция, **на VPS для ReelMe пока не выполнялись**.

### 1. Локальная сборка и передача

Из корня проекта, после выбора проверенной версии кода:

```bash
set -euo pipefail
RELEASE="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
IMAGE="reelme:$RELEASE"
# Если checkout изменён, образ включает эти изменения; зафиксировать состав поставки.
docker build --platform linux/amd64 -t "$IMAGE" .
docker image inspect "$IMAGE" --format '{{.Id}} {{.Os}}/{{.Architecture}}'
mkdir -p /tmp/reelme-release
docker save "$IMAGE" | gzip > "/tmp/reelme-release/reelme-$RELEASE.tar.gz"
(cd /tmp/reelme-release && sha256sum "reelme-$RELEASE.tar.gz" > "reelme-$RELEASE.tar.gz.sha256")
ssh igornskprod 'install -d -m 0700 /srv/reelme/incoming'
scp "/tmp/reelme-release/reelme-$RELEASE.tar.gz" "/tmp/reelme-release/reelme-$RELEASE.tar.gz.sha256" igornskprod:/srv/reelme/incoming/
scp deploy/compose.yaml igornskprod:/srv/reelme/compose.yaml
```

На сервере, подставив **тот же** RELEASE:

```bash
set -euo pipefail
cd /srv/reelme/incoming
RELEASE='ЗНАЧЕНИЕ_ИЗ_ЛОКАЛЬНОЙ_СБОРКИ'
sha256sum -c "reelme-$RELEASE.tar.gz.sha256"
docker load -i "reelme-$RELEASE.tar.gz"
docker image inspect "reelme:$RELEASE" --format '{{.Id}} {{.Os}}/{{.Architecture}}'
cd /srv/reelme
printf 'REELME_IMAGE=reelme:%s\n' "$RELEASE" > .env
chmod 600 .env
```

Сверить image ID с локальным. Этот `.env` содержит только тег образа. Секреты лежат отдельно.

### 2. Секреты и первоначальный setup

На сервере:

```bash
install -m 0600 /etc/reelme/app.env.example /etc/reelme/app.env
vi /etc/reelme/app.env
```

Указать разные `ADMIN_PASSWORD` и `OPERATOR_PASSWORD` длиной 12–256 символов. Для реальной генерации нужен `FAL_KEY`; для почты — все параметры SMTP. Пустой fal/SMTP позволяет открыть приложение, но не даёт полного рабочего сценария. Не передавать секреты в командной строке или Git. После первого запуска `install` больше не выполнять: он перезапишет секреты шаблоном.

```bash
set -euo pipefail
cd /srv/reelme
docker compose config --quiet
docker compose run --rm --no-deps app node dist/server/setup.js
# После успешного setup очистить ADMIN_PASSWORD и OPERATOR_PASSWORD:
vi /etc/reelme/app.env
docker compose up -d --no-build --pull never
curl --fail http://127.0.0.1:3000/ -o /dev/null
docker compose ps
docker compose logs --tail 50
```

Повторный setup сохраняет существующие аккаунты и ключ; он не сбрасывает пароли. Ключ появляется в `/srv/reelme-data/installation-key.txt`; передать его настройщику установки приватно. Не выводить его в отчёты. Внутри контейнера сервер слушает `0.0.0.0`, на хосте порт опубликован **только на loopback**. Наружу 3000 не открывать.

### 3. DNS и Caddy

Оператор задаёт A-запись `reelme.natureonzoom.win` → `46.8.200.99`. AAAA добавлять только при проверенном маршруте IPv6 к этому же серверу. Перед выпуском сертификата проверить публичный DNS и доступность TCP 80/443. DNS здесь автоматически не меняется.

В существующий `/etc/caddy/Caddyfile` добавить **отдельный блок**, сохранив оба старых домена и FRP-маршрут:

```caddyfile
reelme.natureonzoom.win {
    reverse_proxy 127.0.0.1:3000
}
```

Не добавлять `file_server` для `/srv/reelme-data`. До редактирования сохранить свежую копию, затем validate с тем же env, который использует служба:

```bash
set -euo pipefail
CADDY_BACKUP="/root/Caddyfile.before-reelme-$(date -u +%Y%m%dT%H%M%SZ)"
cp -a /etc/caddy/Caddyfile "$CADDY_BACKUP"
vi /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --envfile /etc/caddy/face-moment.env
# Выполнять только при успешном validate:
systemctl reload caddy
curl --fail https://reelme.natureonzoom.win/ -o /dev/null
journalctl -u caddy --since '5 minutes ago' --no-pager
```

Не заменять reload на restart. Если validate не прошёл, не перезагружать службу; вернуть файл из свежей копии. При проблеме после reload вернуть эту же копию, снова validate и reload. Не использовать для этого устаревшую копию от подготовки, если конфигурация с тех пор менялась.

Проверить старые домены и FRP после подключения ReelMe. При SELinux AVC изучить `ausearch -m AVC -ts recent`; не отключать SELinux целиком. Существующий Caddy уже настроен на upstream через loopback, но доступ именно к контейнеру ещё требует проверки после развёртывания.

### 4. Приёмка

- Войти как admin/operator, проверить загрузку изображения и видео, сохранение сюжетов.
- Проверить `/capture-loader.js`, настроить локальную страницу digiCamControl и приватно ввести installation key; проверить реальную камеру.
- Выполнить одну полноценную генерацию через fal, получение видео, QR и отправку email. Эти действия могут расходовать баланс fal/SMTP.
- Проверить, что порт 3000 недоступен снаружи, а сайт доступен по HTTPS.
- Проверить перезапуск контейнера и сохранность аккаунтов/материалов.
- Во время upload и обработки видео наблюдать `docker stats`, `free -h`, `df -h /`. Проверить `docker inspect "$(docker compose ps -q app)" --format '{{.State.OOMKilled}} {{.RestartCount}}'` и сообщения OOM в kernel journal.
- После загрузки реальных материалов оценить хранение на 14 дней и резервную копию. Настоящие показатели нагрузки в ходе подготовки не измерялись.

## Обновление, резервная копия, откат

Каждая поставка имеет новый тег; предыдущий образ и предыдущий `/srv/reelme/.env` сохранить. Перед изменением версии остановить приложение и снять **весь** каталог данных: SQLite вместе с WAL/SHM, медиа и installation key должны соответствовать друг другу.

На сервере перед переключением:

```bash
set -euo pipefail
cd /srv/reelme
BACKUP="/var/backups/reelme/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$BACKUP"
cp -a .env compose.yaml "$BACKUP/"
cp -a /etc/reelme/app.env "$BACKUP/app.env"
docker compose stop app
tar --acls --xattrs --selinux -C /srv -czf "$BACKUP/data.tar.gz" reelme-data
# Только после успешного tar менять REELME_IMAGE в .env:
vi .env
docker compose up -d --no-build --pull never
curl --fail http://127.0.0.1:3000/ -o /dev/null
```

Если backup не создался, обновление не продолжать, запустить прежнюю версию. Копия на том же диске не защищает от потери VPS: зашифрованную копию вынести отдельно. Следить за свободным местом до создания архива.

Для отката кода вернуть предыдущий тег и `docker compose up -d --no-build --pull never`. Если новая версия изменила схему/данные несовместимо, возврат образа недостаточен: остановить контейнер и восстановить согласованную копию данных и конфигурации; новые записи после копии будут потеряны. Не смешивать файлы двух версий каталога данных. Caddy при обычных обновлениях менять не требуется.

Не выполнять `docker system prune -a --volumes` как часть деплоя. Удалять только конкретные старые образы/архивы после принятия новой версии и сохранения возможности отката.

## Источники

- [Docker: установка Engine на RHEL](https://docs.docker.com/engine/install/rhel/).
- [Docker: firewall и forwarding](https://docs.docker.com/engine/network/packet-filtering-firewalls/).
- [Caddy: validate, envfile и reload](https://caddyserver.com/docs/command-line).
- [README приложения](README.md), [.env.example](.env.example).
