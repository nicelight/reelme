<script lang="ts">
  /*
   * /cam-test-web · EOS 1100D · web-gphoto2 0.4.1
   * Stop scheduling previews and drain the in-flight read before viewfinder=false.
   * Enqueue captureImageAsFile() immediately after the toggle. setConfigValue()
   * starts an 800 ms timer inside its queued operation and awaits it outside the queue.
   * Observe both promises. disconnect() deletes the context outside the queue: drain first.
   * captureImageAsFile() runs AF, releases, reads and requests deletion of the original.
   * autofocusdrive=true is repeatable AF only; a later captureImageAsFile() runs AF again.
   * eosremoterelease=Immediate releases without AF or JPEG transfer. Never follow it
   * with captureImageAsFile() to fetch a file. Never retry an uncertain release.
   * Gate writes by getConfig() widgets/choices. manualfocusdrive is relative (Near/Far 1–3).
   * Focus presets 5 = 3+2, 10 = 3+3+3+1. Await each drive before sending the next.
   * Drive magnitudes are lens-dependent; no absolute position or calibrated distance.
   * Browser timestamps measure dispatch, promise settlement and displayed frames.
   * A pending preview, camera busy state, AF and shutter mechanics can delay exposure.
   * The 50 ms flash is timer-driven. Its timestamp is independent of exposure.
   */
  import { onMount, tick } from 'svelte';
  import { checkSelectedCamera, chooseCamera, createCamera, errorMessage, unsupportedReason, usbApi, writableSettings, type ConfigWidget, type Camera, type Device } from './camera';

  type Phase = 'idle' | 'connecting' | 'ready' | 'preview' | 'stopping' | 'shooting' | 'setting' | 'closing';
  interface Shot { id: number; url: string; thumbnail: string; name: string; size: number; receiveMs: number }
  const labels: Record<Phase, string> = {
    idle: 'Камера отключена', connecting: 'Подключение…', ready: 'Камера подключена',
    preview: 'Live View включён', stopping: 'Остановка Live View…',
    setting: 'Применяем настройку…', shooting: 'Получаем фотографию…', closing: 'Освобождаем USB…'
  };
  let phase = $state<Phase>('idle');
  let support = $state(unsupportedReason());
  let message = $state('');
  let deviceName = $state('');
  let ops = $state({ capturePreview: false, captureImage: false, config: false });
  let uncertain = $state(false);
  let shots = $state.raw<Shot[]>([]);
  let fps = $state<number | null>(null);
  let p95 = $state<number | null>(null);
  let frameSeen = $state(false);
  let canvas: HTMLCanvasElement;
  let device: Device | undefined;
  let camera: Camera | undefined;
  let command: Promise<void> = Promise.resolve();
  let frames: Promise<void> = Promise.resolve();
  let lastProgress = 0;
  let lastDraws: number[] = [];
  let intervals: number[] = [];
  let lastDraw = 0;
  let id = 0;
  let slow = $state(false);
  let closing = false;
  let shutterSent = false;
  let allowResume = false;
  let mode = $state<'manual' | 'auto'>('manual');
  let settings = $state<Record<string, ConfigWidget>>({});
  let configReadFailed = false;
  const focusButtons = [-10, -5, -3, -2, -1, 1, 2, 3, 5, 10].map(step => {
    const magnitude = Math.abs(step);
    const sizes = magnitude === 10 ? [3, 3, 3, 1] : magnitude === 5 ? [3, 2] : [magnitude];
    const direction = step < 0 ? 'Near' : 'Far';
    return { label: (step < 0 ? '−' : '+') + magnitude, moves: sizes.map(size => direction + ' ' + size) };
  });
  let autoArmed = $state(false);
  let countdown = $state(0);
  let whiteScreen = $state(false);
  let flash = $state(false);
  let review = $state<Shot | null>(null);
  let countdownTimers: number[] = [];
  let flashOn: number;
  let flashOff: number;
  const countdownMs = 3000, captureLeadMs = 300, flashDelayMs = 200, flashMs = 50, reviewMs = 1000;
  const origin = performance.now();
  let events = $state.raw<{ at: number; label: string; duration?: number }[]>([]);
  function record(label: string, start?: number) {
    const now = performance.now();
    events = [...events.slice(-79), { at: Math.round(now - origin), label, duration: start === undefined ? undefined : Math.round(now - start) }];
    progress();
  }
  function report(label: string, error: unknown, start?: number) {
    const detail = label + ' ' + errorMessage(error);
    message = [message, detail].filter(Boolean).join(' ');
    record(detail, start);
  }
  function cancelCountdown() {
    countdownTimers.forEach(clearTimeout);
    countdownTimers = []; autoArmed = false; countdown = 0;
  }
  function clearFlash() {
    clearTimeout(flashOn); clearTimeout(flashOff); flash = false;
  }
  let wakeFrame: (() => void) | undefined;
  let busy = $derived(autoArmed || (phase !== 'ready' && !(phase === 'preview' && frameSeen)));

  function progress() { lastProgress = performance.now(); slow = false; }
  function nextPaint() {
    return new Promise<void>(resolve => {
      const frame = requestAnimationFrame(() => { wakeFrame = undefined; resolve(); });
      wakeFrame = () => { cancelAnimationFrame(frame); wakeFrame = undefined; resolve(); };
    });
  }
  function clearFrame() {
    wakeFrame?.();
    frameSeen = false; fps = null; p95 = null; lastDraws = []; intervals = []; lastDraw = 0;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }
  function metrics() {
    const now = performance.now();
    if (phase === 'preview') {
      lastDraws = lastDraws.filter(at => at > now - 1000);
      fps = lastDraws.length;
      if (intervals.length) {
        const sorted = [...intervals].sort((a, b) => a - b);
        p95 = Math.round(sorted[Math.ceil(sorted.length * .95) - 1]);
      }
    }
    const waiting = !['idle', 'ready'].includes(phase) && now - lastProgress > 8000;
    if (waiting && !slow && pendingStep) sendConnectionEvent(pendingStep, 'waiting', now - stepStarted);
    slow = waiting;
  }

  async function disconnect(reason = '') {
    if (closing || phase === 'idle') return;
    closing = true; cancelCountdown(); clearFlash(); whiteScreen = false;
    phase = 'closing'; progress(); clearFrame();
    if (reason) message = reason;
    await Promise.allSettled([command, frames]);
    try { await camera?.disconnect(); }
    catch (e) { message = 'Ошибка отключения. ' + errorMessage(e); }
    finally {
      device = undefined; camera = undefined; deviceName = ''; closing = false;
      settings = {};
      ops = { capturePreview: false, captureImage: false, config: false };
      phase = 'idle'; progress(); clearFrame();
    }
  }

  let attempt = $state('');
  let deliveryFailed = $state(false);
  let pendingStep = $state('');
  let stepStarted = 0;

  // Send each stage immediately: a stuck USB promise may never reach catch/finally.
  // Keep network delivery independent of USB scheduling and the picker's user gesture.
  function sendConnectionEvent(stage: string, state: 'start' | 'done' | 'waiting' | 'error', ms: number, detail = '') {
    const id = attempt;
    const payload = { attempt: id, stage, state, ms: Math.round(ms), detail: detail.slice(0, 400) };
    void fetch('/cam-test-web/diagnostics', {
      method: 'POST', credentials: 'omit', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }).then(response => {
      if (!response.ok && attempt === id) deliveryFailed = true;
    }).catch(() => { if (attempt === id) deliveryFailed = true; });
  }

  async function connectionStep<T>(label: string, run: () => Promise<T>): Promise<T> {
    pendingStep = label;
    const start = performance.now();
    stepStarted = start;
    record(label + ' · начало');
    sendConnectionEvent(label, 'start', 0);
    console.info('[cam-test-web]', label, '· начало');
    try {
      const result = await run();
      record(label + ' · готово', start);
      sendConnectionEvent(label, 'done', performance.now() - start);
      console.info('[cam-test-web]', label, '· готово', Math.round(performance.now() - start), 'мс');
      return result;
    } catch (error) {
      record(label + ' · ' + String(error), start);
      sendConnectionEvent(label, 'error', performance.now() - start, String(error));
      console.error('[cam-test-web]', label, error);
      throw error;
    } finally {
      pendingStep = '';
    }
  }

  function downloadLog() {
    const localTime = new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3
    });
    const openedAt = performance.timeOrigin + origin;
    const lines = [
      new Date().toISOString() + ' · /cam-test-web · web-gphoto2 0.4.1',
      'Время событий · ' + localTime.resolvedOptions().timeZone,
      navigator.userAgent,
      'Попытка подключения · ' + attempt,
      ...events.map(event => localTime.format(openedAt + event.at) + ' · +' + event.at + ' мс · ' + event.label
        + (event.duration === undefined ? '' : ' · ' + event.duration + ' мс'))
    ];
    if (pendingStep) lines.push(pendingStep + ' · ожидание ' + Math.round(performance.now() - stepStarted) + ' мс');
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'cam-test-web.log'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function connect() {
    const usb = usbApi();
    if (!usb || support || phase !== 'idle') return;
    attempt = crypto.randomUUID(); deliveryFailed = false;
    phase = 'connecting'; message = ''; progress();
    command = (async () => {
      try {
        const selected = await connectionStep('Выбор камеры · requestDevice()', () => chooseCamera(usb));
        device = selected;
        if (closing) return;
        deviceName = device.productName || 'USB-камера';
        const usbId = [selected.vendorId, selected.productId].map(id => id.toString(16).padStart(4, '0')).join(':');
        record(deviceName + ' · USB ' + usbId);
        await connectionStep('Проверка разрешённых устройств · getDevices()', () => checkSelectedCamera(usb, selected));
        if (closing) return;
        const current = await connectionStep('Загрузка модуля · camera.js', createCamera);
        camera = current;
        if (closing) return;
        await connectionStep('Запуск WASM и открытие камеры · camera.connect()', () => current.connect());
        if (closing) return;
        ops = await connectionStep('Чтение возможностей · getSupportedOps()', () => current.getSupportedOps());
        if (closing) return;
        message = ops.captureImage || ops.capturePreview ? '' : 'Камера не поддерживает съёмку и Live View через этот адаптер.';
        configReadFailed = false;
        if (ops.config) {
          try {
            settings = writableSettings(await connectionStep('Чтение настроек · getConfig()', () => current.getConfig()));
          } catch (e) {
            configReadFailed = true;
            report('Не удалось прочитать настройки камеры.', e);
          }
        }
        if (!closing) phase = 'ready';
      } catch (e) {
        if (closing) return;
        message = errorMessage(e);
        // The picker can be cancelled before a context exists.
        const current = camera;
        if (current) {
          try { await connectionStep('Освобождение камеры · disconnect()', () => current.disconnect()); }
          catch { /* The stage log retains both errors. */ }
        }
        device = undefined; camera = undefined; deviceName = ''; phase = 'idle';
      }
    })();
  }

  async function viewfinderOff(current: Camera) {
    // Canon EOS exposes this libgphoto2 toggle; reads start it on demand.
    if (!settings.viewfinder && !(ops.config && device?.vendorId === 0x04a9 && configReadFailed)) return;
    const at = performance.now();
    record('Команда viewfinder=false отправлена');
    try { await current.setConfigValue('viewfinder', false); }
    catch (error) { report('Не удалось выключить видоискатель.', error, at); return; }
    record('viewfinder=false · ответ библиотеки', at);
  }

  async function readFrames(current: Camera, started: number, firstLabel: string, shutterAt?: number) {
    let failures = 0;
    let first = true;
    while (phase === 'preview') {
      try {
        const image = await current.capturePreviewAsBlob();
        if (phase !== 'preview') return;
        const bitmap = await createImageBitmap(image);
        try {
          if (phase !== 'preview') return;
          const scale = Math.min(1, 800 / bitmap.width, 600 / bitmap.height);
          const width = Math.max(1, Math.round(bitmap.width * scale));
          const height = Math.max(1, Math.round(bitmap.height * scale));
          if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Не удалось открыть область просмотра.');
          context.drawImage(bitmap, 0, 0, width, height);
          frameSeen = true; failures = 0; progress();
          if (first) {
            record(firstLabel, started);
            if (shutterAt !== undefined) record('От команды съёмки до первого кадра Live View', shutterAt);
            first = false; whiteScreen = false;
            if (autoArmed && !countdown) beginCountdown();
          }
          if (lastDraw) {
            intervals.push(lastProgress - lastDraw);
            if (intervals.length > 100) intervals.shift();
          }
          lastDraw = lastProgress; lastDraws.push(lastDraw);
        } finally { bitmap.close(); }
        await nextPaint();
      } catch (e) {
        if (phase !== 'preview') return;
        if (e instanceof Error && /busy|занят|-110|temporar/i.test(e.message) && ++failures <= 3) {
          await new Promise(resolve => setTimeout(resolve, failures * 200));
          continue;
        }
        cancelCountdown(); whiteScreen = false; phase = 'stopping';
        message = 'Live View остановлен. ' + errorMessage(e);
        record(message); await viewfinderOff(current);
        if (!closing) phase = 'ready';
        clearFrame(); return;
      }
    }
  }
  function start(firstLabel = 'Live View · первый кадр', shutterAt?: number) {
    if (phase !== 'ready' || !ops.capturePreview || !camera) return;
    lastDraws = []; intervals = []; lastDraw = 0; p95 = null;
    phase = 'preview'; fps = 0; progress();
    frames = readFrames(camera, performance.now(), firstLabel, shutterAt);
  }
  function stop() {
    if (phase !== 'preview' || !camera) return;
    const current = camera;
    cancelCountdown();
    phase = 'stopping'; clearFrame(); progress();
    command = (async () => {
      await frames;
      if (closing) return;
      await viewfinderOff(current);
      if (!closing) phase = 'ready';
    })();
  }
  async function finishOperation(current: Camera, previewWasOn: boolean, firstLabel: string, shutterAt?: number) {
    if (closing) return;
    if (previewWasOn && !allowResume) await viewfinderOff(current);
    if (closing) return;
    phase = 'ready'; progress();
    if (allowResume && !document.hidden) start(firstLabel, shutterAt);
    else { clearFrame(); whiteScreen = false; }
  }
  function supportsSetting(name: string, values: (string | boolean)[]) {
    const widget = settings[name];
    return !!widget && values.every(value => typeof value === 'boolean' || widget.choices?.includes(value));
  }
  function configure(name: string, values: (string | boolean)[], label: string) {
    if (busy || !camera || !supportsSetting(name, values)) return;
    const current = camera;
    const resume = phase === 'preview';
    allowResume = resume;
    phase = 'setting'; message = ''; wakeFrame?.(); progress();
    command = (async () => {
      await frames;
      if (closing) return;
      const at = performance.now();
      shutterSent = name === 'eosremoterelease';
      try {
        for (const value of values) {
          if (closing || document.hidden) return;
          const operation = name === 'manualfocusdrive' ? label + ' · ' + value : label;
          const sentAt = performance.now();
          record(operation + ' · команда отправлена');
          await current.setConfigValue(name, value);
          record(operation + ' · ответ библиотеки', sentAt);
          if (name === 'afmethod') settings = { ...settings, afmethod: { ...settings.afmethod, value } };
        }
        if (shutterSent) uncertain = false;
      } catch (e) {
        if (shutterSent) uncertain = true;
        report(shutterSent ? 'Снимок мог быть сделан.' : label + ' · ошибка.', e, at);
      } finally {
        shutterSent = false;
        await finishOperation(current, resume, 'Live View после настройки · первый кадр');
      }
    })();
  }
  function armAuto() {
    if (busy || !settings.viewfinder || !ops.captureImage || !ops.capturePreview || document.hidden) return;
    autoArmed = true; message = '';
    if (phase === 'ready') start();
    else if (frameSeen) beginCountdown();
  }
  function beginCountdown() {
    countdown = 3;
    record('Начало отсчёта');
    countdownTimers = [
      window.setTimeout(() => countdown = 2, 1000),
      window.setTimeout(() => countdown = 1, 2000),
      window.setTimeout(() => {
        cancelCountdown();
        if (phase === 'preview' && !document.hidden) capture(true);
      }, countdownMs - captureLeadMs)
    ];
  }
  async function makeShot(file: File, receiveMs: number): Promise<Shot> {
    const signature = new Uint8Array(await file.slice(0, 3).arrayBuffer());
    if (signature[0] !== 255 || signature[1] !== 216 || signature[2] !== 255)
      throw new Error('На камере выберите JPEG вместо RAW.');
    const url = URL.createObjectURL(file);
    let thumbnail = url;
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file);
      const thumb = document.createElement('canvas');
      const scale = Math.min(1, 220 / Math.max(bitmap.width, bitmap.height));
      thumb.width = Math.max(1, Math.round(bitmap.width * scale)); thumb.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = thumb.getContext('2d');
      if (!context) throw new Error('Не удалось прочитать изображение.');
      context.drawImage(bitmap, 0, 0, thumb.width, thumb.height);
      thumbnail = thumb.toDataURL('image/jpeg', 0.8);
    } catch (error) {
      report('Миниатюра недоступна. Оригинал сохранён.', error);
    } finally { bitmap?.close(); }
    const sequence = ++id;
    return { id: sequence, thumbnail, receiveMs, size: file.size, url, name: `camera-${sequence}.jpg` };
  }
  function addShot(shot: Shot) {
    for (const old of shots.slice(4)) URL.revokeObjectURL(old.url);
    shots = [shot, ...shots.slice(0, 4)];
  }

  function capture(automatic = false) {
    if (!camera || !ops.captureImage || busy) return;
    const current = camera;
    const resume = phase === 'preview';
    allowResume = resume;
    phase = 'shooting'; message = ''; clearFrame(); progress();
    if (automatic) {
      whiteScreen = true;
      record('Остановка цикла Live View');
      flashOn = window.setTimeout(() => {
        flash = true; record('Экранная вспышка');
        flashOff = window.setTimeout(() => flash = false, flashMs);
      }, flashDelayMs);
    }
    command = (async () => {
      await frames;
      if (closing) return;
      if (automatic && !allowResume) {
        await viewfinderOff(current);
        clearFlash(); whiteScreen = false;
        if (!closing) phase = 'ready';
        return;
      }
      const off = automatic ? viewfinderOff(current) : Promise.resolve();
      const shutterAt = performance.now();
      record('Команда съёмки с AF отправлена');
      shutterSent = true;
      try {
        const file = await current.captureImageAsFile();
        const received = performance.now();
        shutterSent = false;
        record('Файл получен · ' + file.size.toLocaleString('ru') + ' байт', shutterAt);
        const shot = await makeShot(file, Math.round(received - shutterAt));
        uncertain = false;
        if (automatic && !closing && allowResume) {
          review = shot;
          await tick();
          await new Promise(resolve => setTimeout(resolve, reviewMs));
        }
        addShot(shot);
        review = null;
      } catch (e) {
        uncertain = true;
        report(shutterSent ? 'Снимок мог быть сделан. Оригинал JPEG не получен.' : 'Не удалось обработать полученный файл.', e);
      } finally {
        shutterSent = false;
        await off;
        if (uncertain) allowResume = false;
        await finishOperation(current, !automatic && resume, 'Восстановление Live View · первый кадр', shutterAt);
      }
    })();
  }

  onMount(() => {
    const usb = usbApi();
    const unplugged = (event: Event) => {
      if (device !== undefined && (event as Event & { device: Device }).device === device)
        void disconnect(shutterSent ? 'USB отключён во время съёмки. Снимок мог быть сделан.' : 'Камера отключена от USB.');
    };
    const hide = () => { void disconnect(); };
    const background = () => {
      if (!document.hidden) return;
      allowResume = false; cancelCountdown(); clearFlash();
      if (phase === 'preview') stop();
    };
    usb?.addEventListener('disconnect', unplugged);
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', background);
    const timer = setInterval(metrics, 500);
    return () => {
      clearInterval(timer); usb?.removeEventListener('disconnect', unplugged);
      window.removeEventListener('pagehide', hide); document.removeEventListener('visibilitychange', background);
      void disconnect().then(() => shots.forEach(shot => URL.revokeObjectURL(shot.url)));
    };
  });
</script>

<main>
  <header>
    <div><h1>Тест USB-камеры</h1><p>Canon EOS 1100D · WebUSB</p></div>
  </header>

  <section aria-labelledby="setup-heading">
    <h2 id="setup-heading">Подключение и драйвер Windows</h2>
    <ol>
      <li>Подключите Canon по USB, выберите JPEG и закройте digiCamControl. Если WinUSB уже установлен, перейдите к шагу 5.</li>
      <li><a href="https://zadig.akeo.ie/" target="_blank" rel="noreferrer">Скачайте Zadig</a> и запустите его.</li>
      <li>В Zadig откройте <b>Options → List All Devices</b>. Выберите именно Canon EOS 1100D и запишите название текущего драйвера.</li>
      <li>Выберите <b>WinUSB</b> и нажмите <b>Replace Driver</b> или <b>Install Driver</b>.</li>
      <li>В Chrome или Edge обновите эту страницу, нажмите «Выбрать камеру» и подтвердите выбор Canon.</li>
    </ol>
    <p class="driver-note">Для возврата к digiCamControl может понадобиться восстановить прежний драйвер в диспетчере устройств Windows.</p>
    <p class="driver-note"><a href="/cam-test-web-assets/restart-canon-usb.ps1" download>Скачать скрипт перезапуска Canon</a> (.ps1). Перед перезапуском сохраните нужные снимки, закройте вкладки камеры и приложения, использующие Canon. Запустите скрипт из PowerShell от имени администратора.</p>
  </section>

  <div class="connection">
    {#if phase === 'idle'}
      <button class="primary" onclick={connect} disabled={!!support}>Выбрать камеру</button>
    {:else}
      <button onclick={() => void disconnect()} disabled={phase === 'closing' || phase === 'connecting'}>Отключить</button>
    {/if}
    {#if events.length}<button onclick={downloadLog}>Скачать журнал</button>{/if}
  </div>
  <div class="status" role="status"><i class:spinner={['setting','stopping','connecting'].includes(phase) || (phase === 'preview' && !frameSeen)} class:connected={phase === 'ready' || phase === 'preview'}></i>{pendingStep || labels[phase]}{deviceName ? ' · ' + deviceName : ''}</div>
  {#if attempt}<p class="driver-note">Диагностика подключения · {attempt.slice(0, 8)}{deliveryFailed ? ' · Журнал отправлен не полностью. Используйте «Скачать журнал».' : ''}</p>{/if}
  {#if support || message}<p class="notice" role="alert">{support || message}</p>{/if}
  {#if slow}<p class="notice" role="status">Ожидаем ответ камеры. При зависании сохраните нужные снимки и переподключите USB. Если соединение не освободилось, перезагрузите вкладку.</p>{/if}

  <section aria-labelledby="live-heading">
    <div class="modes" role="group" aria-label="Режим съёмки">
      <button aria-pressed={mode === 'manual'} disabled={busy && phase !== 'idle'} onclick={() => mode = 'manual'}>Ручной</button>
      <button aria-pressed={mode === 'auto'} disabled={busy && phase !== 'idle'} onclick={() => mode = 'auto'}>Автоматический</button>
    </div>
    <div class="heading"><h2 id="live-heading">Live View</h2><output aria-label="Статистика Live View" aria-live="off" title="P95 — интервал, в который укладываются 95% последних межкадровых пауз">{fps ?? '—'} FPS{p95 !== null ? ` · P95 ${p95} мс` : ''}</output></div>
    <div class="screen" class:white={whiteScreen}>
      <canvas class:visible={frameSeen && !review} bind:this={canvas} aria-label="Изображение с камеры"></canvas>
      {#if review}<img class="review" src={review.url} alt="Полученный JPEG">
      {:else if !frameSeen && !whiteScreen}<span>{phase === 'preview' ? 'Ожидаем первый кадр' : phase === 'shooting' ? 'Идёт съёмка' : 'Превью выключено'}</span>{/if}
      {#if countdown}<strong class="countdown" aria-label="Обратный отсчёт">{countdown}</strong>{/if}
    </div>
    {#if mode === 'auto'}
      <div class="controls">
        <button class="primary" disabled={busy || !ops.captureImage || !ops.capturePreview || !settings.viewfinder} onclick={armAuto}>{uncertain ? 'Снять новый кадр через 3 с' : 'Снять через 3 с'}</button>
        {#if phase === 'preview' && !autoArmed}<button onclick={stop}>Остановить Live View</button>{/if}
      </div>
      {#if !busy && !settings.viewfinder}<p>Для автоматической съёмки камера должна поддерживать отключение видоискателя.</p>{/if}
    {:else}
      <div class="controls">
        {#if phase === 'preview'}<button onclick={stop}>Остановить Live View</button>
        {:else}<button disabled={phase !== 'ready' || !ops.capturePreview} onclick={() => start()}>Запустить Live View</button>{/if}
        <button class="primary" disabled={busy || !ops.captureImage} onclick={() => capture()}>{uncertain ? 'Снять новый кадр' : 'Снять фото'}</button>
        {#if settings.eosremoterelease?.choices?.includes('Immediate')}
          <button disabled={busy} onclick={() => configure('eosremoterelease', ['Immediate'], 'Спуск без AF')}>Спуск без AF · без JPEG</button>
        {/if}
      </div>
      <h3>Фокусировка {#if phase === 'setting'}<i class="spinner" aria-hidden="true"></i>{/if}</h3>
      <div class="controls">
        <button disabled={busy || !settings.autofocusdrive} onclick={() => configure('autofocusdrive', [true], 'Автофокус')}>Автофокус без снимка</button>
        {#each ['Quick', 'Live'] as method}
          {#if settings.afmethod?.choices?.includes(method)}
            <button disabled={busy} aria-pressed={settings.afmethod.value === method} onclick={() => configure('afmethod', [method], method + ' AF')}>{method} AF</button>
          {/if}
        {/each}
      </div>
      <fieldset class="focus-control">
        <legend>Ручной фокус</legend>
        <div class="focus-buttons">
          {#each focusButtons as button}
            <button disabled={busy || !supportsSetting('manualfocusdrive', button.moves)}
              onclick={() => configure('manualfocusdrive', button.moves, 'Фокус ' + button.label)}>{button.label}</button>
          {/each}
        </div>
        <div class="focus-directions"><span>Ближе</span><span>Дальше</span></div>
      </fieldset>
    {/if}
    {#if !busy && (!ops.capturePreview || !ops.captureImage)}<p>{!ops.capturePreview ? 'Камера не заявила поддержку Live View.' : ''} {!ops.captureImage ? 'Спуск затвора недоступен.' : ''}</p>{/if}
  </section>

  <section aria-labelledby="shots-heading">
    <div class="heading"><h2 id="shots-heading">Последние снимки</h2><span>{shots.length} / 5</span></div>
    {#if shots.length}
      <ul>{#each shots as shot (shot.id)}
        <li><img src={shot.thumbnail} alt={'Кадр ' + shot.id}><strong>Кадр {shot.id}</strong>
          <small>{(shot.size / 1048576).toLocaleString('ru', { maximumFractionDigits: 1 })} МБ · {shot.receiveMs} мс</small>
          <a href={shot.url} download={shot.name}>Скачать оригинал</a>
        </li>
      {/each}</ul>
    {:else}<p>Здесь появятся пять последних JPEG. Снимки хранятся до закрытия или перезагрузки вкладки.</p>{/if}
    <p class="gallery-note">Скачайте нужные оригиналы до закрытия страницы. После получения снимка библиотека запрашивает удаление файла с камеры.</p>
  </section>

  <section aria-labelledby="timings-heading">
    <div class="heading"><h2 id="timings-heading">Журнал операций</h2></div>
    {#if events.length}
      <div class="log" role="region" aria-label="Измерения камеры">
        <table><thead><tr><th>От открытия</th><th>Событие</th><th>Длительность</th></tr></thead>
          <tbody>{#each [...events].reverse() as event}<tr>
            <td>{(event.at / 1000).toFixed(3)} с</td><td>{event.label}</td><td>{event.duration === undefined ? '—' : event.duration + ' мс'}</td>
          </tr>{/each}</tbody>
        </table>
      </div>
    {:else}<p>Здесь появятся замеры Live View, фокусировки и съёмки.</p>{/if}
  </section>
</main>
{#if flash}<div class="flash" aria-hidden="true"></div>{/if}

<style>
  @font-face{font-family:Manrope;src:url('../capture/story/assets/manrope-0.woff2') format('truetype');font-weight:400;font-display:swap}
  @font-face{font-family:Manrope;src:url('../capture/story/assets/manrope-3.woff2') format('truetype');font-weight:650 800;font-display:swap}
  :global(html){color-scheme:dark;background:#171419}
  :global(body){margin:0;color:#f6f1f6;font-family:Manrope,system-ui,sans-serif;font-size:15px;line-height:1.45}
  main{box-sizing:border-box;width:100%;margin:auto;padding:clamp(18px,4vw,32px) clamp(14px,4vw,64px)}
  section[aria-labelledby="setup-heading"]{max-width:800px}
  header,.heading,.controls,.status{display:flex;align-items:center;gap:12px}
  header,.heading{justify-content:space-between}
  h1,h2,p,ul,ol{margin:0}
  h1{font-size:clamp(23px,4vw,30px);letter-spacing:-.025em;line-height:1.2}
  h2{font-size:18px;letter-spacing:-.015em}
  header p,section p,.heading span,small{color:#cec3ce}
  header p{margin-top:4px}
  button{border:1px solid #655a69;background:#302932;color:inherit;min-height:42px;padding:8px 16px;border-radius:7px;cursor:pointer;font:inherit;font-weight:650}
  button.primary{border-color:#e9b0ca;background:#e9b0ca;color:#261822}
  button:disabled{opacity:.5;cursor:default}
  button:enabled:hover{filter:brightness(1.12)}
  :is(button,a):focus-visible{outline:3px solid #efd2a5;outline-offset:3px}
  .status{gap:8px;margin:18px 0 0;color:#d3c9d4}
  .status i{width:8px;height:8px;background:#998e9b;border-radius:50%}
  .status i.connected{background:#94cda8}
  .notice{margin-top:10px;padding:8px 12px;border:1px solid #89613f;border-radius:6px;background:#302521;color:#ffdab7;overflow-wrap:anywhere}
  section{margin-top:22px}
  .heading{margin-bottom:8px}
  output,.heading span,small{font-variant-numeric:tabular-nums;font-size:13px}
  .screen{display:grid;place-items:center;background:#0d0c0e;color:#b4aab6;border:1px solid #453d48;border-radius:8px;overflow:hidden;height:clamp(160px,42vh,600px)}
  canvas{display:none;max-height:100%;max-width:100%;height:100%;width:100%;object-fit:contain;min-height:0}
  canvas.visible{display:block}
  .controls{flex-wrap:wrap;margin-top:10px}
  ul{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(115px,1fr));gap:12px;padding:0}
  li img{display:block;width:100%;aspect-ratio:4/3;object-fit:contain;background:#0d0c0e;margin-bottom:4px;border-radius:5px}
  li strong,li small{display:block}
  li a{color:#f3b6d0}
  ul li a{font-size:13px}
  .connection{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
  ol a,.driver-note a{color:#f3b6d0}
  ol{padding:8px 0 0 24px}
  ol li{margin-top:4px}
  .driver-note,.gallery-note{margin-top:8px;font-size:13px}
  .modes{display:flex;gap:4px;margin-bottom:14px}
  button[aria-pressed="true"]{background:#48313e;border-color:#da9ebc}
  .status i.spinner,h3 i.spinner{display:inline-block;vertical-align:middle;box-sizing:border-box;width:16px;height:16px;border:2px solid #655a69;border-top-color:#efc4d8;border-radius:50%;background:none;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .screen{position:relative}
  .screen.white,.flash{background:white}
  .flash{position:fixed;inset:0;z-index:10;pointer-events:none}
  .review{position:absolute;width:100%;height:100%;object-fit:contain}
  .countdown{position:absolute;display:grid;place-items:center;min-width:1.5em;border-radius:8px;background:#171419bd;color:white;font-size:clamp(36px,8vw,72px);font-variant-numeric:tabular-nums}
  h3{margin:18px 0 0;font-size:16px}
  .focus-control{max-width:680px;min-width:0;margin:16px 0 0;padding:0;border:0}
  .focus-control legend{padding:0;margin-bottom:6px}
  .focus-buttons{display:grid;grid-template-columns:repeat(5,minmax(0,1fr)) clamp(4px,1vw,12px) repeat(5,minmax(0,1fr));gap:clamp(2px,.5vw,6px)}
  .focus-buttons button{padding-inline:0;font-size:clamp(13px,3.5vw,15px);font-variant-numeric:tabular-nums}
  .focus-buttons button:nth-child(6){grid-column:7}
  .focus-directions{display:flex;justify-content:space-between;margin-top:4px;font-size:13px;color:#cec3ce}
  .log{overflow:auto;max-height:18rem}
  table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
  td,th{padding:6px 4px;text-align:left;border-bottom:1px solid #453d48}
  th{background:#171419;position:sticky;top:0}
  td:last-child,th:last-child{text-align:right;white-space:nowrap}
  @media(max-width:480px){main{padding:18px 14px}header{align-items:start;flex-wrap:wrap}.controls{gap:8px}button{padding-inline:12px}}
</style>
