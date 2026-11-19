<script lang="ts">
  /** Admin setup guide. Downloads the canonical camera-page template for this
   * server's origin; never embeds credentials or changes installation settings. */
  import cameraPage from '../../../WebServer/reelme.html?raw';
  const localPage = 'http://localhost:5513/reelme.html';
  const download = `data:text/html;charset=utf-8,${encodeURIComponent(cameraPage.replace('https://reelme.natureonzoom.win/capture-loader.js', new URL('/capture-loader.js', location.origin).href))}`;
</script>

<main class="photobooth">
  <header class="guide-heading">
    <h1>Фотобудка</h1>
    <p>От установки на Windows до первого ролика. Короткий план — перед вами, подробности раскрываются по нажатию.</p>
    <div class="actions">
      <a class="button primary" href={download} download="reelme.html">Скачать страницу ReelMe</a>
      <a class="button" href="https://digicamcontrol.com/download" target="_blank" rel="noopener noreferrer">Скачать digiCamControl</a>
    </div>
    <p class="caption">Выполняйте эти шаги на компьютере, к которому подключена камера.</p>
  </header>

  <ol class="steps" aria-label="Настройка фотобудки">
    <li><details>
      <summary><span class="step-number" aria-hidden="true">1</span><span><strong>Установите digiCamControl и подключите камеру</strong><span class="step-hint">Сначала проверьте обычный снимок в программе.</span></span></summary>
      <div class="detail-body">
        <ol>
          <li>Откройте страницу загрузки выше и выберите <strong>digiCamControl Stable Version</strong>. Запустите установщик и установите необходимые компоненты, если он их запросит.</li>
          <li>Подключите включённую камеру по USB. Запустите digiCamControl и дождитесь её появления в списке устройств.</li>
          <li>Выберите сохранение снимков в <strong>JPEG</strong> и неповторяющиеся имена файлов. Сделайте пробный снимок: он должен появиться на компьютере.</li>
        </ol>
        <p>Закройте DSLR Remote Pro, EOS Utility и другие программы, использующие эту камеру. Их настройки удалять не нужно.</p>
        <p class="caption">Нужна основная программа digiCamControl; Virtual Webcam для этого сценария не требуется. Если камера предлагает режим USB, используйте PTP/MTP.</p>
        <a href="https://digicamcontrol.com/cameras" target="_blank" rel="noopener noreferrer">Проверить поддержку камеры</a>
      </div>
    </details></li>
    <li><details>
      <summary><span class="step-number" aria-hidden="true">2</span><span><strong>Включите веб-сервер digiCamControl</strong><span class="step-hint">Он соединяет локальную страницу с камерой.</span></span></summary>
      <div class="detail-body">
        <ol>
          <li>В настройках найдите <strong>Webserver</strong> или <strong>Triggers</strong> — название раздела зависит от версии.</li>
          <li>Включите <strong>Use web server</strong> и <strong>Allow interaction via web server</strong> (разрешение команд, <code>AllowWebserverActions</code>). Порт — <strong>5513</strong>.</li>
          <li>Перезапустите digiCamControl и откройте <a href="http://localhost:5513/" target="_blank" rel="noopener noreferrer">http://localhost:5513/</a>. Должна открыться страница программы.</li>
        </ol>
        <p>Оставляйте digiCamControl запущенным во время работы фотобудки. Доступ к камере нужен только на этом компьютере: проброс порта на роутере не требуется.</p>
        <a href="https://digicamcontrol.com/learn/userguide/settings" target="_blank" rel="noopener noreferrer">Настройки в документации digiCamControl</a>
      </div>
    </details></li>
    <li><details>
      <summary><span class="step-number" aria-hidden="true">3</span><span><strong>Сохраните страницу ReelMe в папку WebServer</strong><span class="step-hint">Один HTML-файл; интерфейс обновляется с сервера.</span></span></summary>
      <div class="detail-body">
        <ol>
          <li>Нажмите <strong>«Скачать страницу ReelMe»</strong> вверху. Сохраните файл как <code>reelme.html</code>, без добавочного расширения <code>.txt</code>.</li>
          <li>Скопируйте его в папку <code>WebServer</code> внутри каталога установки digiCamControl. Найти каталог можно через ярлык программы: «Расположение файла». Windows может запросить права администратора для копирования.</li>
          <li>Откройте <a href={localPage} target="_blank" rel="noopener noreferrer">{localPage}</a> в браузере на этом компьютере.</li>
        </ol>
        <p>Не открывайте HTML двойным щелчком: странице нужен адрес <code>http://localhost:5513/</code>, чтобы управлять камерой.</p>
        <p class="caption">Файл уже подключён к этому серверу ReelMe. Интернет нужен для загрузки интерфейса и отправки фотографий. После обновления ReelMe достаточно перезагрузить страницу между съёмками; скачивать файл заново обычно не нужно.</p>
      </div>
    </details></li>
    <li><details>
      <summary><span class="step-number" aria-hidden="true">4</span><span><strong>Введите ключ установки один раз</strong><span class="step-hint">Используйте постоянный профиль браузера.</span></span></summary>
      <div class="detail-body">
        <ol>
          <li>Получите <strong>ключ установки</strong> у того, кто настраивал сервер ReelMe. Пароли аккаунтов admin и operator здесь не подходят.</li>
          <li>Откройте <a href={`${localPage}#setup`} target="_blank" rel="noopener noreferrer">страницу настройки фотобудки</a>, введите ключ и подтвердите подключение.</li>
          <li>После успешной проверки вернитесь на <a href={localPage} target="_blank" rel="noopener noreferrer">страницу съёмки</a>. Должен появиться каталог сюжетов.</li>
        </ol>
        <p>Ключ запоминается в этом браузерном профиле. В другом профиле или после очистки данных сайта настройку нужно повторить. Посетителю вводить ключ и входить в аккаунт не нужно.</p>
        <p class="caption">Для администратора сервера: ключ находится в <code>DATA_DIR/installation-key.txt</code>; на nskserver — <code>/srv/reelme-data/installation-key.txt</code>. Не добавляйте его в HTML или ссылку.</p>
      </div>
    </details></li>
    <li><details>
      <summary><span class="step-number" aria-hidden="true">5</span><span><strong>Пройдите путь до готового ролика</strong><span class="step-hint">Проверьте съёмку, результат, QR и получение видео.</span></span></summary>
      <div class="detail-body">
        <ol>
          <li>Во вкладке <strong>«Сюжеты»</strong> сохраните настроенный сюжет и включите «Отображать клиенту».</li>
          <li>Для проверки без расходов на fal в разделе «Тесты» выберите режим <strong>«Тестовое видео — полный проход без fal»</strong> и сохраните сюжет. Режим «Только проверка входных данных» проверяет фотографии, но готового ролика не создаёт.</li>
          <li>На локальной странице заполните мероприятие при первом запуске за день или нажмите «Пропустить». Выберите сюжет, начните съёмку и следуйте подсказкам. После последнего кадра нажмите <strong>«Завершить фотосессию»</strong>.</li>
          <li>Откройте <a href="/operator" target="_blank" rel="noopener">«Сегодня / Архив»</a> и дождитесь результата. Проверьте видео и QR. Для общего показа используйте <a href="/results" target="_blank" rel="noopener">экран результатов</a>.</li>
          <li>Перед реальной работой выберите <strong>«fal.ai — реальная генерация» и сохраните сюжет</strong>. На сервере должен быть настроен fal; для отправки писем — SMTP. Проверьте один реальный ролик и получение по QR.</li>
        </ol>
        <p class="caption">Симуляция проверяет путь внутри ReelMe, но не качество AI-видео. Отправка письма даже в тестовом режиме использует настроенный SMTP.</p>
      </div>
    </details></li>
  </ol>

  <section class="help" aria-label="Работа с фотобудкой">
    <details>
      <summary><strong>Перед каждым мероприятием</strong></summary>
      <div class="detail-body">
        <ul>
          <li>Проверьте питание камеры, USB, свет, кадрирование и интернет.</li>
          <li>Запустите digiCamControl, затем откройте локальную страницу в том же браузерном профиле. Для полного экрана в браузере нажмите <kbd>F11</kbd>.</li>
          <li>Проверьте видимость нужных сюжетов и отключённое тестирование. Сделайте пробную съёмку до прихода гостей.</li>
          <li>Откройте экран результатов под admin или operator. Во время активной съёмки не обновляйте и не закрывайте вкладку.</li>
        </ul>
      </div>
    </details>
    <details>
      <summary><strong>Если что-то не заработало</strong></summary>
      <div class="detail-body problems">
        <h2>Не открывается localhost:5513</h2><p>Проверьте, что digiCamControl запущен, веб-сервер включён и программа перезапущена после изменения настройки.</p>
        <h2>Страница программы открывается, а ReelMe — нет</h2><p>Проверьте папку WebServer и имя <code>reelme.html</code>. Если видна только «Загрузка», проверьте интернет и доступность этого сайта ReelMe.</p>
        <h2>Нет сюжетов или запрошен сотрудник</h2><p>Проверьте ключ через <code>#setup</code>. Затем убедитесь, что сюжет сохранён, видим и содержит необходимые материалы; для V2V нужен исходный ролик.</p>
        <h2>Камера не снимает или не приходит фотография</h2><p>Проверьте USB, разрешение команд веб-сервера, JPEG и уникальные имена. Закройте другие программы камеры. Не запускайте второй затвор, пока ожидается предыдущий снимок.</p>
        <h2>Нет живого превью</h2><p>Можно выбрать «Продолжить без превью»: подсказки и съёмка сохраняются. Сам JPEG всё равно должен поступить с камеры.</p>
        <h2>Ролик не готов или письмо не приходит</h2><p>Посмотрите сообщение в «Сегодня / Архив». Проверьте режим тестирования, настройки и доступность fal/SMTP на сервере. Не перезапускайте всю съёмку, если требуется только повтор отправки письма.</p>
      </div>
    </details>
  </section>
</main>

<style>
  .photobooth{max-width:960px;margin:0 auto;padding:40px 32px 64px;line-height:1.65}
  .guide-heading h1{font-size:32px;line-height:1.2;margin:0 0 12px;letter-spacing:-.025em}
  .guide-heading>p{max-width:68ch;color:var(--muted);margin:0 0 24px}
  .actions{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:12px}
  .photobooth a{color:var(--accent);text-underline-offset:.2em}
  .actions a{min-height:48px;display:inline-flex;align-items:center;justify-content:center;text-decoration:none;border-radius:12px;padding:10px 18px}
  .actions .primary{color:var(--accent-text)}
  .photobooth .caption{font-size:13px;color:var(--muted);line-height:1.6}
  .steps{list-style:none;padding:0;margin:32px 0 0}
  .steps>li{margin:0;border-top:1px solid var(--line)}
  .steps>li:last-child{border-bottom:1px solid var(--line)}
  summary{cursor:pointer;padding:20px 4px;min-height:48px;color:var(--text)}
  .steps summary{display:flex;align-items:baseline;gap:16px;list-style:none}
  .steps summary::-webkit-details-marker{display:none}
  .steps summary::after{content:'';width:9px;height:9px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);margin:5px 8px 0 auto;flex:none;align-self:flex-start}
  .steps details[open]>summary::after{transform:rotate(225deg);margin-top:10px}
  .step-number{font-size:14px;color:var(--accent);font-variant-numeric:tabular-nums;flex:0 0 16px}
  summary strong{font-size:16px;font-weight:700;line-height:1.5}
  .step-hint{display:block;font-size:14px;color:var(--muted);margin-top:4px;line-height:1.5}
  .detail-body{padding:0 4px 24px 36px;max-width:76ch;font-size:15px}
  .detail-body ol,.detail-body ul{padding-left:22px;margin:0 0 16px}
  .detail-body li+li{margin-top:10px}
  .detail-body p{margin:0 0 16px}
  .detail-body>:last-child{margin-bottom:0}
  code{font-size:.9em;overflow-wrap:anywhere;color:var(--text)}
  kbd{font:inherit;border:1px solid var(--line);border-radius:4px;padding:1px 5px}
  .help{margin-top:36px}
  .help>details{border-bottom:1px solid var(--line)}
  .help .detail-body{padding-left:20px}
  .problems h2{font-size:15px;margin:24px 0 6px;font-weight:700;line-height:1.5}
  .problems h2:first-child{margin-top:0}
  summary:hover{color:var(--accent)}
  @media(max-width:600px){.photobooth{padding:28px 20px 40px}.guide-heading h1{font-size:28px}.actions{flex-direction:column}.actions a{width:100%}.steps summary{gap:10px}.detail-body{padding-left:0}.help .detail-body{padding-left:0}.step-hint{font-size:13px}}
</style>
