<script lang="ts">
  import { onMount } from 'svelte';
  import { chooseCamera, createCamera, errorMessage, unsupportedReason, usbApi, type Camera, type Device } from './camera';

  type Phase = 'idle' | 'connecting' | 'ready' | 'preview' | 'stopping' | 'shooting' | 'closing';
  interface Shot { id: number; url: string; thumbnail: string; name: string; size: number; receiveMs: number }
  const labels: Record<Phase, string> = {
    idle: 'Камера отключена', connecting: 'Подключение…', ready: 'Камера подключена',
    preview: 'Live View включён', stopping: 'Остановка Live View…',
    shooting: 'Получаем фотографию…', closing: 'Освобождаем USB…'
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
  let resumeAfterShot = false;
  let wakeFrame: (() => void) | undefined;
  let busy = $derived(phase !== 'ready' && phase !== 'preview');

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
    slow = !['idle', 'ready'].includes(phase) && now - lastProgress > 8000;
  }

  // disconnect() in web-gphoto2 destroys the native context outside its queue.
  // Drain both the current command and the preview read before releasing USB.
  async function disconnect(reason = '') {
    if (closing || phase === 'idle') return;
    closing = true;
    phase = 'closing'; progress(); clearFrame();
    if (reason) message = reason;
    await Promise.allSettled([command, frames]);
    try { await camera?.disconnect(); }
    catch (e) { message = 'Ошибка отключения. ' + errorMessage(e); }
    finally {
      device = undefined; camera = undefined; deviceName = ''; closing = false;
      ops = { capturePreview: false, captureImage: false, config: false };
      phase = 'idle'; progress(); clearFrame();
    }
  }

  function connect() {
    const usb = usbApi();
    if (!usb || support || phase !== 'idle') return;
    phase = 'connecting'; message = ''; progress();
    command = (async () => {
      try {
        device = await chooseCamera(usb);
        if (closing) return;
        deviceName = device.productName || 'USB-камера';
        camera = await createCamera(usb, device);
        if (closing) return;
        await camera.connect();
        if (closing) return;
        ops = await camera.getSupportedOps();
        if (closing) return;
        message = ops.captureImage || ops.capturePreview ? '' : 'Камера не поддерживает съёмку и Live View через этот адаптер.';
        phase = 'ready';
      } catch (e) {
        if (closing) return;
        message = errorMessage(e);
        // The picker can be cancelled before a context exists.
        try { await camera?.disconnect(); } catch { /* keep the connection error */ }
        device = undefined; camera = undefined; deviceName = ''; phase = 'idle';
      }
    })();
  }

  async function viewfinderOff(current: Camera) {
    // Canon EOS exposes this libgphoto2 toggle; reads start it on demand.
    if (device?.vendorId === 0x04a9 && ops.config) await current.setConfigValue('viewfinder', false);
  }

  async function readFrames(current: Camera) {
    let failures = 0;
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
        phase = 'stopping';
        message = 'Live View остановлен. ' + errorMessage(e);
        try { await viewfinderOff(current); } catch { /* preserve the preview error */ }
        if (!closing) phase = 'ready';
        clearFrame(); return;
      }
    }
  }
  function start() {
    if (phase !== 'ready' || !ops.capturePreview || !camera) return;
    phase = 'preview'; message = ''; fps = 0; progress();
    frames = readFrames(camera);
  }
  function stop() {
    if (phase !== 'preview' || !camera) return;
    const current = camera;
    phase = 'stopping'; clearFrame(); progress();
    command = (async () => {
      await frames;
      if (closing) return;
      try { await viewfinderOff(current); }
      catch (e) { message = 'Не удалось выключить видоискатель камеры. ' + errorMessage(e); }
      if (!closing) phase = 'ready';
    })();
  }
  async function makeShot(file: File, receiveMs: number): Promise<Shot> {
    const signature = new Uint8Array(await file.slice(0, 3).arrayBuffer());
    if (signature[0] !== 255 || signature[1] !== 216 || signature[2] !== 255)
      throw new Error('На камере выберите JPEG вместо RAW.');
    const bitmap = await createImageBitmap(file);
    let thumbnail: string;
    try {
      const thumb = document.createElement('canvas');
      const scale = Math.min(1, 220 / Math.max(bitmap.width, bitmap.height));
      thumb.width = Math.max(1, Math.round(bitmap.width * scale)); thumb.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = thumb.getContext('2d');
      if (!context) throw new Error('Не удалось прочитать изображение.');
      context.drawImage(bitmap, 0, 0, thumb.width, thumb.height);
      thumbnail = thumb.toDataURL('image/jpeg', 0.8);
    } finally { bitmap.close(); }
    const sequence = ++id;
    return { id: sequence, thumbnail, receiveMs, size: file.size, url: URL.createObjectURL(file), name: `camera-${sequence}.jpg` };
  }
  function capture() {
    if (!camera || !ops.captureImage || busy) return;
    const current = camera;
    const resume = phase === 'preview';
    resumeAfterShot = resume;
    phase = 'shooting'; message = ''; clearFrame(); progress();
    command = (async () => {
      await frames;
      if (closing) return;
      shutterSent = true; // Once dispatched, a lost USB response can still mean an exposure.
      try {
        const shutterAt = performance.now();
        const file = await current.captureImageAsFile();
        const shot = await makeShot(file, Math.round(performance.now() - shutterAt));
        for (const old of shots.slice(4)) URL.revokeObjectURL(old.url);
        shots = [shot, ...shots.slice(0, 4)];
        uncertain = false;
      } catch (e) {
        uncertain = true;
        message = 'Снимок мог быть сделан. Оригинал JPEG не получен. ' + errorMessage(e);
      } finally {
        shutterSent = false;
        if (!closing) {
          phase = 'ready'; progress();
          if (resumeAfterShot && !uncertain && !document.hidden) start();
          else if (resume) {
            phase = 'stopping';
            try { await viewfinderOff(current); } catch { /* retain shot error */ }
            if (!closing) phase = 'ready';
          }
        }
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
      resumeAfterShot = false;
      if (phase === 'preview') stop();
    };
    usb?.addEventListener('disconnect', unplugged);
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', background);
    const timer = setInterval(metrics, 500);
    return () => {
      clearInterval(timer); usb?.removeEventListener('disconnect', unplugged);
      window.removeEventListener('pagehide', hide); document.removeEventListener('visibilitychange', background);
      void disconnect(); shots.forEach(shot => URL.revokeObjectURL(shot.url));
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
  </section>

  <div class="connection">
    {#if phase === 'idle'}
      <button class="primary" onclick={connect} disabled={!!support}>Выбрать камеру</button>
    {:else}
      <button onclick={() => void disconnect()} disabled={phase === 'closing' || phase === 'connecting'}>Отключить</button>
    {/if}
  </div>
  <div class="status" role="status"><i class:connected={phase === 'ready' || phase === 'preview'}></i>{labels[phase]}{deviceName ? ' · ' + deviceName : ''}</div>
  {#if support || message}<p class="notice" role="alert">{support || message}</p>{/if}
  {#if slow}<p class="notice" role="status">Ожидаем ответ камеры. При зависании сохраните нужные снимки и переподключите USB. Если соединение не освободилось, перезагрузите вкладку.</p>{/if}

  <section aria-labelledby="live-heading">
    <div class="heading"><h2 id="live-heading">Live View</h2><output aria-label="Статистика Live View" aria-live="off" title="P95 — интервал, в который укладываются 95% последних межкадровых пауз">{fps ?? '—'} FPS{p95 !== null ? ` · P95 ${p95} мс` : ''}</output></div>
    <div class="screen">
      <canvas class:visible={frameSeen} bind:this={canvas} aria-label="Изображение с камеры"></canvas>
      {#if !frameSeen}<span>{phase === 'preview' ? 'Ожидаем первый кадр' : phase === 'shooting' ? 'Идёт съёмка' : 'Превью выключено'}</span>{/if}
    </div>
    <div class="controls">
      {#if phase === 'preview'}<button onclick={stop}>Остановить Live View</button>
      {:else}<button disabled={phase !== 'ready' || !ops.capturePreview} onclick={start}>Запустить Live View</button>{/if}
      <button class="primary" disabled={busy || !ops.captureImage} onclick={capture}>{uncertain ? 'Снять новый кадр' : 'Снять фото'}</button>
    </div>
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

</main>

<style>
  @font-face{font-family:Manrope;src:url('../capture/story/assets/manrope-0.woff2') format('truetype');font-weight:400;font-display:swap}
  @font-face{font-family:Manrope;src:url('../capture/story/assets/manrope-3.woff2') format('truetype');font-weight:650 800;font-display:swap}
  :global(html){color-scheme:dark;background:#171419}
  :global(body){margin:0;color:#f6f1f6;font-family:Manrope,system-ui,sans-serif;font-size:15px;line-height:1.45}
  main{box-sizing:border-box;width:min(100%,848px);margin:auto;padding:clamp(18px,4vw,32px) 24px}
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
  .connection{margin-top:14px}
  ol a{color:#f3b6d0}
  ol{padding:8px 0 0 24px}
  ol li{margin-top:4px}
  .driver-note,.gallery-note{margin-top:8px;font-size:13px}
  @media(max-width:480px){main{padding:18px 14px}header{align-items:start;flex-wrap:wrap}.controls{gap:8px}button{padding-inline:12px}}
</style>
