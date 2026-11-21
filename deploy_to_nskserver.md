# Развёртывание ReelMe: nskserver через VPS nskigorprod

## Текущая схема: nskserver, 20 ноября 2026 — запущено

Размещение приложения — **nskserver (AlmaLinux 10.3, за CGNAT)**. VPS
**nskigorprod** (46.8.200.99, AlmaLinux 9.8; прежний alias `igornskprod`)
остаётся точкой входа HTTPS. Домен — https://reelme.natureonzoom.win.

```text
Интернет → VPS Caddy :443 → 127.0.0.1:23000 на VPS
         → обратный SSH-туннель → nskserver 127.0.0.1:3000 → контейнер ReelMe
```

Сервер сам устанавливает исходящие SSH-соединения к VPS, поэтому публичный IP
и проброс входящих портов за CGNAT не нужны. DNS и сертификат остаются на VPS.
Порты приложения на обоих хостах привязаны только к loopback.

### Текущий релиз от 20 ноября 2026 — подписи и кеш ракурсов

На nskserver запущен `reelme:20261120T162846Z-de1404a-guide-cache` из коммита `de1404a`. Предыдущий образ — `reelme:20261120T161758Z-preview-delay`.
Резервная копия перед миграцией SQLite 13 → 14 находится в `/var/backups/reelme/before-20261120T162846Z-de1404a-guide-cache/`. Целостность БД, внешние ключи, количества записей и назначения ракурсов проверены после запуска.
Контейнер healthy. Публичные JS-файлы админки и фотосессии по HTTPS совпали с файлами образа. Для всех четырёх назначенных изображений проверены авторизованная выдача и повторный ответ 304 без тела.

### История релиза «Фотобудка» от 20 ноября 2026

Работает **`reelme:20261119T202532Z-993844d-photobooth`**, image ID
`sha256:92ce0a35e001a51999e60af8828f93802a52489ba8505b2d0b6f7b9386f20b58`.
Добавлены инструкция первого запуска в админке и скачивание канонического HTML
для текущего origin. Docker build теперь включает `WebServer/reelme.html`.

- Base source: предыдущая поставка `20261119T191045Z-993844d-promo-v2`;
  overlay SHA256 `92227cd898146f398009a7f99a900c7c26ff4df9ef70143bd91559b0d9618f89`.
  Сервер проверил SHA256 всех 942 файлов перед сборкой. Исходники, manifest,
  release.json и build.log: `/srv/reelme/releases/20261119T202532Z-993844d-photobooth/`.
- Check/build PASS локально и на сервере. Browser smoke: admin-only вкладка,
  переходы/черновик, keyboard details и реальные байты скачанного HTML; desktop/mobile,
  обе темы. Постоянные тесты для инструкции не добавлялись, backend не менялся.
- Backup: `/var/backups/reelme/before-20261119T202532Z-993844d-photobooth/`.
  До/после: schema 11, 2 аккаунта, 3 слота, 0 мероприятий; integrity_check=ok,
  контейнер healthy с SELinux container_t. Прежний runtime image сохранён.
- Production browser: вход admin, вкладка и скачивание HTML размером 437 байт подтверждены;
  desktop/mobile с закрытыми и всеми раскрытыми разделами, без horizontal overflow
  и JS ошибок; logout выполнен. Первый screenshot ждал Manrope 700 более 60 секунд;
  ограниченный повтор дождался шрифта и прошёл.
- Доказательства и ограничения: [TASK-029](.memory-bank/tasks/TASK-029-T1-FT-002-W26.task.json).
  Установка digiCamControl и реальная камера не проверялись; fal/SMTP не настраивались.

### Предыдущий релиз: промогалерея — 20 ноября 2026

Работает **`reelme:20261119T191045Z-993844d-promo-v2`**; image ID
`sha256:0d520a6f2c1b68d9e8b47d27717b13d93bb673ebacda3b4b42837bec00e62cbd`.
Это commit `993844d` с изменениями рабочей копии: публичная промогалерея, отдельные
рабочие маршруты, явная неактивная кнопка выбора на главной и изменения деплоя ниже.

- `/` — публичные сюжеты/превью без выбора и съёмки; `/admin` — редактор admin;
  `/operator` — сегодня/архив обеих ролей; `/results` — fullscreen обеих ролей.
  Старый `/?screen=results` возвращает 308 на `/results`.
- Исходники, `release.json`, `source-files.json`, `build.log` и архивы поставки —
  `/srv/reelme/releases/20261119T191045Z-993844d-promo-v2/`.
  Базовый архив SHA256: `12489a27c4d1dd6e729f1433a0f9251477053437a5865a8cecd9166fa724c308`;
  поверх него patch SHA256: `fe888e9c79bcd6dca7c22e9e4c0c3cffcad184b4c07d65444bb4d09fc4b06663`.
  Перед сборкой сервер проверил SHA256 всех 940 файлов по manifest.
- Локальный и серверный check/build PASS; полный последовательный API/shared suite
  — 120/120 PASS. При параллельном прогоне один раз упал прежний camera abort test;
  отдельный повтор 4/4 и последовательный полный прогон успешны.
- Chromium на изолированных данных: 20 сценариев подтверждены; два устаревших
  ожидания тестов исправлены и перепроверены. После финального оформления disabled
  кнопки promo 2/2 PASS, desktop/mobile и image/video screenshots просмотрены.
- Backup перед переключением: `/var/backups/reelme/before-20261119T191045Z-993844d-promo-v2/`.
  Он уже содержит импортированные слоты. До/после: schema 11, 2 аккаунта, 3 слота,
  0 мероприятий; `integrity_check=ok`, контейнер healthy, SELinux `container_t`.
  Предыдущий runtime image `reelme:20261119T172650Z-993844d` сохранён.
- Публичные страницы/loader, redirect, публичные медиа с Range, анонимные запреты,
  login/session/logout обеих ролей и защита admin API подтверждены через HTTPS.
  Настройки 3 слотов и метаданные/Range всех 7 материалов совпали после обновления.
  Один первоначальный HTTP smoke получил connect timeout; повторный полный проход,
  публичный HTTPS с VPS и loopback-туннель — PASS/200.
- Production Chromium anonymous: desktop 1440×1000 и mobile 390×844, все 3 слота,
  оба видео воспроизводятся, изображение загружено, листание работает. Нет JS/HTTP
  ошибок, private API/mutation requests и horizontal overflow; ожидаемые отмены
  загрузки предыдущего видео при смене карточки отмечены отдельно.
- Проверки и артефакты: [TASK-028](.memory-bank/tasks/TASK-028-T2-FT-001-W25.task.json).
  Реальные камера, fal и SMTP не проверялись; fal/SMTP пока не настроены.

### Перенос локальных слотов — 20 ноября 2026

Перенесены 3 слота, 7 записей медиа и все связанные файлы: 7 материалов,
2 исходных шаблона MP4 и README каталога шаблонов. Таблица образцов ракурсов пуста.
JSON настроек сохранён точно, включая `simulateGeneration=true` у двух слотов.
Аккаунты, installation key, история и display settings сервера не заменялись.

- Архив: `reelme-slots-20261119T184710Z.tar.gz`, 58 422 295 bytes; SHA256
  `2eaa33bebdbfed8d29cfe3320a8bbfaa20f41a108953f08be5c8a0105a118272`.
- Backup до импорта: `/var/backups/reelme/before-slots-20261119T184710Z/`.
  Импорт выполнялся при остановленном приложении, только в пустые таблицы;
  проверены SHA256 файлов, foreign keys и `integrity_check=ok`.
- После запуска через публичный домен подтверждены все настройки 3 слотов,
  метаданные 7 материалов и защищённая Range-выдача каждого файла.

### Предыдущий релиз — 19 ноября 2026

На nskserver собран и запущен **`reelme:20261119T172650Z-993844d`** из текущего
commit `993844d02effc3ab53de138b3af9d8d7eb6258dd`. Дополнительно исправлен Dockerfile:
в образ включены `public/test-videos` для симуляции генерации. Изменения Compose —
настраиваемые UID/GID и поддержка образа, собранного на сервере.

- Image ID: `sha256:370155d9aa8f2c9b150522a1883b706b35101585ee5db7e79d96b48215bea095`.
- SHA256 архива исходников: `90da54815ce985c66433acd37d0fc10dcc8b0e86dce47aec9bec3a59a44d6b20`.
  Исходники, `release.json`, `build.log` и результат локальных тестов хранятся в
  `/srv/reelme/releases/20261119T172650Z-993844d/` (root, 0700).
- Docker build на сервере успешен: Svelte/TypeScript check — 0 ошибок/предупреждений,
  Vite/TypeScript build PASS, npm audit — 0 vulnerabilities. `npm test` для исходников
  поставки на рабочем компьютере — 118 PASS, 0 fail/skip.
- Перед переключением сохранён `/var/backups/reelme/before-20261119T172650Z-993844d/`:
  весь каталог данных, app.env, Compose и прежний тег. Миграция SQLite 9 → 11 прошла,
  `integrity_check=ok`, 2 аккаунта сохранены; контейнер healthy с SELinux `container_t`.
- HTTP через VPS и публичный HTTPS — 200; sharp и декодирование обоих тестовых MP4
  через FFmpeg проверены. Сборщик ресурсов видит новый контейнер. Свободно около 60 GiB на `/`.
- Через публичный домен проверены login/session/logout admin/operator, `/admin`
  и `/capture-loader.js`. Chromium: desktop 1440×1000 и mobile viewport 390×844;
  новый центрированный login, фон `#0d0a13`, кнопка `#f5a4df`, без horizontal overflow.
  JS exceptions/failed requests нет; 401 `/api/auth/session` ожидаем до входа.
  Первый browser `networkidle` превысил 30 секунд, повторная проверка завершилась успешно.
- fal/SMTP не настраивались; реальная камера, платная генерация и email не проверялись.

### Доступ и расположение файлов

- `ssh nskserver`: пользователь `facetime`, passwordless `sudo`; локальный SSH alias
  использует `ProxyJump nskigorprod`, `HostName 127.0.0.1`, `Port 22022`.
- `ssh nskigorprod`: root на VPS. `nskserver` — кодовое имя; системный hostname
  пока `localhost.localdomain`.
- Доступ к SSH поддерживает существующий `nsk-reverse-ssh.service` на nskserver:
  VPS `127.0.0.1:22022` → nskserver `127.0.0.1:22`. Не останавливать его при деплое.
- HTTP поддерживает отдельный [reelme-tunnel.service](deploy/reelme-tunnel.service).
  Ключ `/home/facetime/.ssh/id_ed25519_reelme` хранится только на nskserver;
  его public key добавлен пользователю VPS `revtunnel` с `restrict`,
  `permitlisten="127.0.0.1:23000"`, `permitopen="127.0.0.1:23000"` и запретом команд.
  Проверка host key включена; keepalive 30 секунд × 3, systemd перезапускает SSH
  через 5 секунд после завершения. Tunnel и Docker включены в автозагрузку независимо.
- Контекст ОС: `/home/facetime/OS_context.md` на nskserver; содержит сведения
  об ОС, службах, дисках и эксплуатации без секретов.
- Compose и тег образа: `/srv/reelme/compose.yaml`, `/srv/reelme/.env`.
  Секреты: `/etc/reelme/app.env` (0600, root).
- Данные: `/srv/reelme-data` (0700); резервные копии: `/var/backups/reelme`.
  Здесь корневой раздел 70 GiB, а `/home` — отдельный раздел 843 GiB:
  свободное место `/home` **не увеличивает** ёмкость `/srv` или `/var/lib/docker`.
- Пользователь приложения на nskserver: `reelme`, UID 978 / GID 977. Эти значения
  записаны в `/srv/reelme/.env` как `REELME_UID` / `REELME_GID`. Значения по умолчанию
  989:988 оставлены для старого VPS, но на AlmaLinux 10 они заняты другими службами.
- Изоляция контейнера и отсутствие дополнительных лимитов ресурсов сохранены.
  SELinux Enforcing; для Docker явно включён `selinux-enabled: true`, mount `:Z`.
  Docker Engine 29.10.0 / Compose 5.8.0; существующий Podman сохранён.
- Сбор ресурсов — `reelme-observe.service`, `/var/log/reelme/resources.jsonl`
  на nskserver; формат и ограничения описаны ниже.

### История: первоначальная миграция 19 ноября

Перенесена действовавшая на VPS версия `reelme:20261116-e979835-deploy1`,
без обновления кода до текущего checkout. Image ID на обоих хостах:
`sha256:774a409a25e40b5b7264ba5f65604e3df89253d0eaf3f730bc660cbf75edd843`.
SHA256 архива образа: `eb07aebcb1b0bb7b8e57cecf048098d8e0fbd5350dfbd5abf05aef4c1234d0f4`;
архива данных: `8c3eb4518bc70b7764d22e7a0318a391f81209d6c58028d4cb9f351b01bb842e`.
Архивы проверены после передачи. Для прямого скачивания образа использовался
временный ключ с доступом только к чтению одного архива; ключ и разрешение удалены.

- SQLite `integrity_check=ok`; сохранены 2 аккаунта. На момент переноса сюжетов,
  событий, сессий съёмки и заданий генерации не было.
- HTTP nskserver `:3000`, VPS `:23000` и публичный HTTPS — 200;
  `/capture-loader.js` — 200. Через публичный домен проверены login/session/logout
  admin и operator, включая Secure/HttpOnly cookie.
- Контейнер healthy; проверены sharp JPEG и FFmpeg/libx264. После перезапуска
  контейнера данные доступны. После restart HTTP-туннеля маршрут восстановился,
  административный SSH остался доступен. Полный reboot хоста не выполнялся.
- Docker, оба туннеля и сборщик ресурсов active/enabled. Лог наблюдений содержит
  новый контейнер. После развёртывания свободно около 63 GiB на `/`.
- Caddy изменён только в upstream ReelMe (`3000` → `23000`), validate/reload успешны;
  PID Caddy/FRP не изменились, конфигурации FRP и Caddy env совпали по SHA256.
  Старые домены сохранили исходный 502; их недоступный backend не исправлялся.
- Старый контейнер на VPS остановлен, резервная копия и образ сохранены.
- fal и SMTP **не настроены** в перенесённом окружении. Исходящий HTTPS к fal.run
  доступен (ответ 404 корневого URL); это не проверка API или генерации.
  Реальная камера, генерация, email и нагрузка не проверялись.
- Новая сборка, `npm run check` и `npm test` не выполнялись: исходники приложения
  не менялись и переносился готовый работающий образ. Compose validation и
  `git diff --check` успешны.

### Обновление приложения на nskserver

По решению оператора от 19 ноября сборка и пересборка **разрешены на nskserver**:
у сервера 32 GB RAM (ОС показывает около 30 GiB). Полный `docker build`, включая
`npm ci`, Svelte/TypeScript checks и Vite build, выполняется в build stage.
Сборка на рабочем компьютере с передачей готового образа также допустима.
Ограничение прежнего маломощного VPS больше не относится к серверу приложения;
`nskigorprod` остаётся HTTPS-прокси и не участвует в сборке.

На рабочем компьютере упаковать **текущий исходный код**, без `.env`, данных,
`node_modules` и Git. Изменения checkout входят в архив; фиксировать commit,
добавленные изменения и SHA256, не переиспользовать тег предыдущей поставки:

```bash
set -euo pipefail
RELEASE="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
SOURCE_ARCHIVE="/tmp/$RELEASE-source.tar.gz"
tar -czf "$SOURCE_ARCHIVE" Dockerfile .dockerignore package.json package-lock.json \
  tsconfig*.json vite.config.ts index.html src public/slot-prompts public/test-videos \
  deploy/compose.yaml WebServer/reelme.html
(cd /tmp && sha256sum "$RELEASE-source.tar.gz" > "$RELEASE-source.tar.gz.sha256")
scp "$SOURCE_ARCHIVE" "$SOURCE_ARCHIVE.sha256" nskserver:/tmp/
```

На nskserver под root, подставив тот же RELEASE:

```bash
set -euo pipefail
RELEASE='ЗНАЧЕНИЕ_ИЗ_ПРЕДЫДУЩЕГО_ШАГА'
cd /tmp
sha256sum -c "$RELEASE-source.tar.gz.sha256"
install -d -m 0700 "/srv/reelme/releases/$RELEASE"
tar -xzf "$RELEASE-source.tar.gz" -C "/srv/reelme/releases/$RELEASE"
cd "/srv/reelme/releases/$RELEASE"
docker build --platform linux/amd64 -t "reelme:$RELEASE" .
docker image inspect "reelme:$RELEASE" --format '{{.Id}} {{.Os}}/{{.Architecture}}'
```

Сборка идёт при работающей прежней версии. Если checks или build завершились
ошибкой, не менять runtime. Dockerfile включает промпты и `public/test-videos`:
ролики нужны встроенному режиму тестовой генерации. `npm test` проверять для
исходного кода поставки отдельно; production-образ не содержит тестовый runner.

После успешной сборки остановить приложение и создать согласованный backup,
затем заменить Compose и **только REELME_IMAGE** в `.env`, сохраняя UID/GID:

```bash
cd /srv/reelme
BACKUP="/var/backups/reelme/before-$RELEASE"
install -d -m 0700 "$BACKUP"
cp -a .env compose.yaml /etc/reelme/app.env "$BACKUP/"
docker compose stop app
if ! tar --acls --xattrs --selinux -C /srv -czf "$BACKUP/data.tar.gz" reelme-data; then
  docker compose up -d --no-build --pull never
  exit 1
fi
install -m 0640 -o root -g reelme "/srv/reelme/releases/$RELEASE/deploy/compose.yaml" compose.yaml
sed -i "s/^REELME_IMAGE=.*/REELME_IMAGE=reelme:$RELEASE/" .env
docker compose config --quiet
docker compose up -d --no-build --pull never
# Дождаться healthy, проверить HTTP и журнал контейнера:
docker compose ps
curl --fail http://127.0.0.1:3000/ -o /dev/null
```

Старый образ и backup сохранять для отката. После старта проверить публичный
вход и нужные сценарии; при несовместимых миграциях откатывать данные вместе с кодом.

Затем с рабочего компьютера проверить весь маршрут:

```bash
ssh nskigorprod 'curl --fail http://127.0.0.1:23000/ -o /dev/null'
curl --fail https://reelme.natureonzoom.win/ -o /dev/null
```

При обычном обновлении не менять Caddy и не перезапускать SSH-туннели.
Setup при переносе существующих данных повторно не нужен: аккаунты, сессии,
installation key и материалы сохраняются. Секреты не помещать в Git и отчёты.

### Прокси, диагностика и откат переноса

На VPS блок ReelMe в `/etc/caddy/Caddyfile` должен содержать
`reverse_proxy 127.0.0.1:23000`. Старые блоки face-moment/FRP сохраняются.
После изменения: `caddy validate --config /etc/caddy/Caddyfile --envfile
/etc/caddy/face-moment.env`, затем `systemctl reload caddy`.

Проверять цепочку от приложения наружу:

1. nskserver: `sudo docker compose --project-directory /srv/reelme ps`,
   `curl -f http://127.0.0.1:3000/`, журнал контейнера.
2. nskserver: `systemctl status reelme-tunnel`,
   `sudo journalctl -u reelme-tunnel -n 50 --no-pager`.
3. VPS: `ss -lnt` (loopback 23000), `curl -f http://127.0.0.1:23000/`.
4. Публичный HTTPS и журнал Caddy. При 502 проверить туннель и backend;
   сертификат или DNS менять без свидетельств проблемы не нужно.

Для восстановления HTTP-туннеля можно выполнить
`sudo systemctl restart reelme-tunnel` на nskserver: административный SSH остаётся
на независимом туннеле. Если недоступен сам nskserver, проверить питание/сеть
на месте; VPS не способен восстановить выключенный сервер за CGNAT.

Старый контейнер и исходные данные на VPS сохраняются остановленными для отката.
Перед возвратом трафика **остановить приложение на nskserver**, перенести на VPS
согласованную свежую копию данных и назначить владельца 989:988; затем запустить
старый образ и вернуть upstream Caddy на `127.0.0.1:3000` с validate/reload.
Без обратного переноса данных откат вернёт состояние на момент миграции и потеряет
последующие изменения. Не запускать две доступные пользователям копии приложения.

Резервная копия при переносе: `/var/backups/reelme/migrate-nskserver-20261119`
на VPS (данные, app.env, Compose, .env и Caddyfile). Старый runtime и архив образа
не удалять до принятия переноса. Перезагрузка хоста не заменяется проверкой
перезапуска служб; факт её выполнения фиксировать отдельно.

## История первоначального развёртывания на VPS

Ниже — сведения и команды первоначального запуска 14–16 ноября. Упоминания
запуска приложения на VPS и upstream `:3000` относятся к старой схеме.
Для текущих обновлений использовать nskserver и инструкции выше; описание
backup, структуры данных, локальной сборки и формата наблюдений остаётся применимо.

Состояние подготовки: 14 ноября 2026; наблюдение и настройки ресурсов обновлены 16 ноября 2026. SSH alias — **`igornskprod`** (порядок букв отличается от имени этого файла). Приложение **запущено 16 ноября 2026**; актуальный результат — в разделе первого деплоя ниже. DNS настроен оператором.

Принято: собирать Docker-образ на локальном компьютере для `linux/amd64`, переносить готовый архив на VPS. На VPS не выполнять `docker build`, `npm ci`, TypeScript/Vite-сборку. Node.js, FFmpeg и нативные зависимости находятся внутри образа; ОС контейнера не обязана совпадать с AlmaLinux хоста. Существующий Caddy остаётся системным сервисом.

## Первый деплой 16 ноября — запущен

Контейнер `reelme-app-1` запущен из `reelme:20261116-e979835-deploy1`, порт
127.0.0.1:3000. Setup создал admin/operator и installation key; первоначальные
пароли удалены из серверного app.env. Локальная копия production-паролей и ключа
установки хранится в `/home/serg/Projects/reelme/.env` (0600, вне Git).
Исходные файлы в `/home/serg/.local/share/reelme/` сохранены как резервные копии.
Ключ установки — `/srv/reelme-data/installation-key.txt` на сервере; `INSTALLATION_KEY`
в локальном `.env` хранит его копию и не импортируется при локальном setup.

Образ собран локально: свежие check (0 ошибок/предупреждений) и build, затем
скомпилированное приложение поверх локального `reelme:prep-20261114` с Node 22.23.5
и FFmpeg. Production dependencies совпали, lockfile не изменён. Полная сборка с
загрузкой зависимостей была остановлена из-за медленной сети. Исправлены
Dockerfile/.dockerignore для включения промптов при будущих полных сборках.
Локальный smoke: HTTP/промпты, оба аккаунта/права, sharp и FFmpeg PASS.

Архив SHA256: `eb07aebcb1b0bb7b8e57cecf048098d8e0fbd5350dfbd5abf05aef4c1234d0f4`.
После передачи checksum совпал; все 13 распакованных слоёв совпали с RootFS сервера.
Локальный config ID: `1d73d7dc906bdff3abd44ce0f1664cb3ed3c44c5c6bd9556895a02e7ddc0130f`;
серверный manifest ID: `774a409a25e40b5b7264ba5f65604e3df89253d0eaf3f730bc660cbf75edd843`.

DNS A → 46.8.200.99, DNS only. Caddy получил доверенный сертификат; отдельный
блок добавлен через validate/reload. Backup: `/root/reelme-deploy-20261116/Caddyfile.before`.
Старые блоки сохранены, PID Caddy/FRP не изменились; их исходные ответы — 502.
Постоянные данные — `/srv/reelme-data`; исходники — `template-videos` внутри него.

Оператор попросил закончить запуск без дальнейших проверок, чтобы выключить
локальный компьютер. Последнее наблюдение: контейнер Up, health starting.
Production smoke/login/restart не выполнялись. fal/SMTP не настроены.
Ниже сохранены сведения подготовки и инструкции дальнейших обновлений.

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
- [.dockerignore](.dockerignore): разрешает исходники, build manifests, `public/slot-prompts` и `public/test-videos`; `.env`, Git, локальные данные и `node_modules` не отправляются в build context.
- [deploy/compose.yaml](deploy/compose.yaml): только `image`, без `build`, `pull_policy: never`, порт `127.0.0.1:3000`, непривилегированный UID, read-only rootfs, отдельный writable `/data`, `TEMPLATE_VIDEOS_DIR=/data/template-videos`, SELinux `:Z`, tmpfs `/tmp`, ротация логов, healthcheck.
- [deploy/app.env.example](deploy/app.env.example): шаблон server-only credentials. Compose читает значения буквально (`format: raw`): без shell-кавычек, по одной строке на значение.

По указанию оператора от 16 ноября **дополнительные ограничения ресурсов контейнера не задаются**: удалены `mem_limit`, `memswap_limit`, `pids_limit` и явный размер tmpfs `/tmp`; CPU quota не устанавливается. Действуют обычные пределы хоста/ядра (в том числе стандартный размер tmpfs), swap доступен по политике ОС. Изоляция, непривилегированный UID и read-only rootfs сохранены. Исторический smoke выше проводился с прежним лимитом 1 GiB; текущая конфигурация его не содержит. Для оценки фактического потребления включён сбор ниже.

20 GB диска также не подтверждены как достаточные для 14 дней хранения. Учитывать фотографии, видео, образы и резервные копии; оставлять минимум несколько GB свободными. Healthcheck проверяет HTTP, не fal/SMTP и не всю бизнес-функциональность. Docker restart policy перезапускает завершившийся процесс, но сам по себе статус unhealthy перезапуска не вызывает.

## Сбор памяти и активности (16 ноября 2026)

На VPS включён отдельный host-сервис `reelme-observe.service`. Это небольшой Python-процесс, не контейнер; он не запускает/останавливает приложение и не устанавливает ему ограничения. Исходники: [deploy/observe.py](deploy/observe.py), [systemd unit](deploy/reelme-observe.service). На сервере скрипт находится в `/usr/local/lib/reelme/observe.py`.

Проверено 16 ноября: Python compile, systemd unit verify и Compose validation успешны; сервис active/enabled, записи создаются. Временный тестовый контейнер выделил и освободил 32 MiB до опроса: лог сохранил текущие 1 908 736 байт и kernel peak 36 122 624 байта, а также CPU, I/O и сеть. После удаления теста корректно записан пустой список. Тест использовал отдельные labels и `/tmp/reelme-observe-check`, рабочий лог не загрязнён. Контейнер ReelMe не запускался; контрольные суммы конфигураций Caddy/FRP остались прежними.

**Место хранения:** `/var/log/reelme/resources.jsonl`, затем `.1` … `.14`. JSONL — одна запись JSON на строку, время UTC. Опрос примерно раз в 10 секунд плюс время чтения Docker. Ротация встроенная: 10 MiB на файл, до 14 архивов (около 150 MiB суммарно); самые старые записи вытесняются. Каталог 0700, файлы 0600, доступ root. Перед длительным анализом выгружать все файлы, пока нужный период не вытеснен.

Сборщик выбирает контейнеры по Compose labels `project=reelme`, `service=app`, исключая одноразовый setup. После пересоздания автоматически обнаруживает новый ID. Пока ReelMe не развёрнут, пишет `containers: []` и показатели хоста — это ожидаемый режим ожидания, не измерение приложения.

| Поле | Что записывается |
|---|---|
| `container_id`, `started_at`, `status`, `health` | Контейнер, начало запуска, состояние и статус healthcheck |
| `memory_current_bytes` | Полная память cgroup: процессы Node/FFmpeg, учитываемые кеши и tmpfs; это не только JS heap и не RSS одного процесса |
| `memory_kernel_peak_bytes` | `memory.peak` ядра: максимум с создания текущей cgroup, включая короткие всплески между опросами |
| `memory_sampled_peak_bytes` | Максимум увиденных текущих значений за этот запуск контейнера и непрерывную работу сборщика; после рестарта сборщика начинается заново |
| `memory_swap_bytes`, `memory_events` | Использованный swap, счётчики событий памяти, включая `oom`/`oom_kill` |
| `cpu_usage_usec`, `cpu_percent`, `pids` | Накопленное CPU-время, средняя загрузка между соседними записями (100% = одно ядро), число задач cgroup |
| `network.rx_bytes`, `network.tx_bytes` | Накопленный сетевой обмен без loopback; включает внешние интеграции и health/служебный трафик через интерфейс |
| `io` | Накопленные дисковые байты/операции cgroup (`rbytes`, `wbytes`, `rios`, `wios` и доступные ядру другие счётчики) |
| `restart_count`, `oom_killed`, `exit_code` | Docker restart count, признак OOM последнего состояния и exit code |
| `host_memory_bytes` | Доступная RAM хоста, свободный и общий swap в байтах |
| `error` | Тип ошибки опроса; отсутствие измерения не выдаётся за нулевое потребление |

Накопленные счётчики анализировать по разностям внутри одного `container_id`/`started_at`; не складывать их между строками. `cpu_percent` в первой записи — null. Если ядро не предоставляет `memory.peak`, поле — null, остаётся только максимум выборок. Пик cgroup включает файловый кеш и потому может отличаться от `docker stats`.

При завершении/пересоздании cgroup её kernel peak сбрасывается. Записанные пики сохраняются в файлах независимо от контейнера. Всплеск, после которого контейнер успел завершиться до следующего опроса, может остаться незаписанным; опрос также не является полным журналом кратковременных переходов состояний. На выключенном сервере или при остановленном сборщике записи не создаются.

**Активность приложения:** stdout/stderr уже собирает Docker (`local`, 3 × 10 MB), просмотр через `docker compose logs --timestamps`. Fastify пишет входящие/завершённые запросы, request ID, HTTP status и длительность; фоновые ошибки — по логике приложения. Эти логи помогают сопоставить время нагрузки с работой сайта, но не являются аудитом действий пользователя. URL, Authorization и cookies скрываются существующим redaction; сборщик ресурсов не читает env, фото, видео или тела запросов. Docker-логи относятся к конкретному контейнеру: выгружать их **до** его удаления/пересоздания.

Проверка и выгрузка (на VPS):

```bash
systemctl status reelme-observe --no-pager
tail -n 3 /var/log/reelme/resources.jsonl
journalctl -u reelme-observe --since today --no-pager
# После развёртывания приложения:
cd /srv/reelme
docker compose logs --timestamps --since 24h > /root/reelme-application.log
```

Выгрузка метрик локально (содержимое архива включает текущий файл и ротации):

```bash
ssh igornskprod 'tar -C /var/log/reelme -czf - .' > /tmp/reelme-resource-logs.tar.gz
scp igornskprod:/root/reelme-application.log /tmp/
```

Установка/обновление сборщика при восстановлении сервера, из корня локального проекта:

```bash
scp deploy/observe.py deploy/reelme-observe.service igornskprod:/tmp/
ssh igornskprod 'install -d -m 0755 /usr/local/lib/reelme && install -m 0755 /tmp/observe.py /usr/local/lib/reelme/observe.py && install -m 0644 /tmp/reelme-observe.service /etc/systemd/system/reelme-observe.service && systemctl daemon-reload && systemctl enable reelme-observe && systemctl restart reelme-observe'
```

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

Оператор задаёт в Cloudflare A-запись: Name `reelme`, IPv4 `46.8.200.99`, Proxy status **DNS only** (серое облако), TTL Auto. HTTPS обслуживает Caddy напрямую. AAAA добавлять только при проверенном маршруте IPv6 к этому же серверу. Перед выпуском сертификата проверить публичный DNS и доступность TCP 80/443. DNS здесь автоматически не меняется.

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

Каталог подготовленных роликов на хосте — `/srv/reelme-data/template-videos`,
в контейнере — `/data/template-videos`. Владелец 989:988; имена и правила импорта —
[инструкция](media/template-videos/readme_media.md). Каталог не публикуется как static.

### 4. Приёмка

- Войти как admin/operator, проверить загрузку изображения и видео, сохранение сюжетов.
- Проверить `/capture-loader.js`, настроить локальную страницу digiCamControl и приватно ввести installation key; проверить реальную камеру.
- Выполнить одну полноценную генерацию через fal, получение видео, QR и отправку email. Эти действия могут расходовать баланс fal/SMTP.
- Проверить, что порт 3000 недоступен снаружи, а сайт доступен по HTTPS.
- Проверить перезапуск контейнера и сохранность аккаунтов/материалов.
- Во время upload и обработки видео собирать `/var/log/reelme/resources.jsonl`, дополнительно наблюдать `docker stats`, `free -h`, `df -h /`. Проверить `docker inspect "$(docker compose ps -q app)" --format '{{.State.OOMKilled}} {{.RestartCount}}'` и сообщения OOM в kernel journal.
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

- [Linux cgroup v2: memory.current и memory.peak](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html).
