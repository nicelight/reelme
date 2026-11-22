// capturePreviewAsBlob starts Canon Live View. Stop issuing reads and drain the
// last read before viewfinder=false. Its 800 ms JS acknowledgement is outside
// the native queue. Measure the 100 ms from dispatch and observe both promises.
// disconnect() deletes the native context outside the queue; drain before delete.
import { canonVendorId, checkSelectedCamera, chooseCamera, createCamera, errorMessage, unsupportedReason, usbApi, writableSettings, type Camera, type ConfigWidget, type Device } from '../cam-test-web/camera';
import { pause, validatedCameraJpeg } from './camera-frame';

export class BoothUsb {
  state = $state<'idle' | 'connecting' | 'ready' | 'closing'>('idle');
  detail = $state('');
  stage = $state('');
  uncertain = $state(false);
  battery = $state('');
  readonly support = unsupportedReason();
  readonly hasPendingCapture = false; // The wrapper cannot retrieve an earlier shot by filename.
  private camera?: Camera;
  private device?: Device;
  private tail: Promise<void> = Promise.resolve();
  private owner?: AbortController;
  private viewfinder = false;
  attempt = $state('');
  sendCaptureLogs = false;
  private previewInFlight = false;
  private batteryTimer?: number;
  private batteryInFlight = false;
  private pending = 0;
  private toggleAck?: Promise<void>;

  private track<T>(work: Promise<T>) {
    this.pending++;
    const finished = () => { this.pending--; };
    this.tail = work.then(finished, finished);
    return work;
  }

  private updateBattery(config: ConfigWidget) {
    const value = config.children?.status?.children?.batterylevel?.value;
    this.battery = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }

  private async pollBattery() {
    const owner = this.owner;
    if (!owner || this.state !== 'ready' || this.pending) return;
    // Reading EOS config also invokes libgphoto2's capability-gated KeepDeviceOn.
    this.batteryInFlight = true;
    try {
      const config = await this.operation(owner.signal, camera => camera.getConfig());
      if (!owner.signal.aborted) this.updateBattery(config);
    } catch (cause) {
      if (!owner.signal.aborted) {
        this.battery = '';
        // A critical rejection poisons the web-gphoto2 queue for this connection.
        if (!(cause instanceof Error && cause.constructor === Error)) void this.release(errorMessage(cause));
      }
    } finally {
      this.batteryInFlight = false;
    }
  }

  private async step<T>(stage: string, operation: () => Promise<T>) {
    const start = performance.now();
    const report = this.state === 'connecting' || this.sendCaptureLogs;
    const log = (state: string, detail = '') => {
      if (!report) return;
      const body = JSON.stringify({ attempt: this.attempt, stage: 'Фотобудка · ' + stage, state,
        ms: Math.round(performance.now() - start), detail: detail.slice(0, 400) });
      void fetch('/cam-test-web/diagnostics', { method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
    };
    this.stage = stage;
    log('start');
    const timer = setTimeout(() => log('waiting', JSON.stringify({ opened: this.device?.opened,
      claimed: this.device?.configuration?.interfaces.filter(i => i.claimed).map(i => i.interfaceNumber) })), 8000);
    try {
      const result = await operation();
      log('done');
      return result;
    } catch (cause) {
      log('error', String(cause));
      throw cause;
    } finally {
      clearTimeout(timer);
    }
  }

  connect() {
    const usb = usbApi();
    if (!usb || this.support || this.state !== 'idle') return;
    const owner = this.owner = new AbortController();
    this.state = 'connecting';
    this.detail = '';
    this.attempt = crypto.randomUUID();
    const opening = (async () => {
      // requestDevice must run in the initiating click, before any await.
      const device = await this.step('Выбор камеры', () => chooseCamera(usb, canonVendorId));
      owner.signal.throwIfAborted();
      this.device = device;
      await this.step('Проверка USB', () => checkSelectedCamera(usb, device));
      owner.signal.throwIfAborted();
      const camera = this.camera = await createCamera();
      await this.step('Запуск WASM', () => camera.prepareRuntime());
      owner.signal.throwIfAborted();
      await this.step('Открытие PTP-сессии Canon', () => camera.connect());
      owner.signal.throwIfAborted();
      const ops = await this.step('Возможности камеры', () => camera.getSupportedOps());
      if (!ops.captureImage || !ops.capturePreview || !ops.config) throw new Error('Камера не поддерживает съёмку с Live View.');
      owner.signal.throwIfAborted();
      const settings = await this.step('Настройки камеры', () => camera.getConfig());
      this.updateBattery(settings);
      if (!writableSettings(settings).viewfinder) throw new Error('Камера не позволяет отключить видоискатель.');
      owner.signal.throwIfAborted();
      this.viewfinder = true;
      await this.step('Проверка Live View', async () => (await createImageBitmap(await camera.capturePreviewAsBlob())).close());
      owner.signal.throwIfAborted();
      await this.step('Остановка Live View', () => camera.setConfigValue('viewfinder', false));
      this.viewfinder = false;
      owner.signal.throwIfAborted();
      this.state = 'ready';
      this.stage = '';
      this.batteryTimer = window.setInterval(() => void this.pollBattery(), 15_000);
    })();
    void this.track(opening).catch(cause => {
      if (!owner.signal.aborted) void this.release(errorMessage(cause));
    });
  }

  listen() {
    const usb = usbApi();
    const unplug = (event: Event) => {
      if ((event as Event & { device: Device }).device === this.device) void this.release('Камера отключена от USB.');
    };
    const leave = () => { void this.release(); };
    usb?.addEventListener('disconnect', unplug);
    window.addEventListener('pagehide', leave);
    return () => {
      usb?.removeEventListener('disconnect', unplug);
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }

  async release(reason = '') {
    if (this.state === 'idle' || this.state === 'closing') return;
    const opening = this.state === 'connecting';
    this.state = 'closing';
    window.clearInterval(this.batteryTimer);
    this.owner?.abort();
    this.detail = reason;
    try {
      // An outstanding connect can be blocked inside an owned WinUSB handle.
      if ((opening || this.previewInFlight || this.batteryInFlight) && this.device?.opened) await this.device.close().catch(() => {});
      await this.tail;
      await this.toggleAck;
      if (this.viewfinder && this.camera && this.device?.opened) {
        await this.camera.setConfigValue('viewfinder', false).catch(() => {});
      }
      await this.camera?.disconnect();
    } catch (cause) {
      this.detail ||= errorMessage(cause);
    } finally {
      try { if (this.device?.opened) await this.device.close(); }
      catch (cause) { this.detail ||= errorMessage(cause); }
      this.camera = undefined;
      this.device = undefined;
      this.viewfinder = false;
      this.battery = '';
      this.stage = '';
      this.state = 'idle';
    }
  }

  private operation<T>(signal: AbortSignal, execute: (camera: Camera, signal: AbortSignal) => Promise<T>) {
    const owner = this.owner;
    return this.track(this.tail.then(() => {
      if (this.state !== 'ready' || !owner || !this.camera) throw new Error('Проверьте камеру.');
      const active = AbortSignal.any([owner.signal, signal]);
      active.throwIfAborted();
      return execute(this.camera, active);
    }));
  }

  async startLiveView(signal: AbortSignal) { signal.throwIfAborted(); }

  preview(signal: AbortSignal) {
    return this.operation(signal, async camera => {
      this.viewfinder = true;
      this.previewInFlight = true;
      try { return await camera.capturePreviewAsBlob(); }
      catch (cause) {
        if (!signal.aborted) void this.release(errorMessage(cause));
        throw cause;
      } finally { this.previewInFlight = false; }
    });
  }

  park() {
    if (this.state !== 'ready') return;
    void this.operation(this.owner!.signal, async camera => {
      if (this.viewfinder) {
        await camera.setConfigValue('viewfinder', false);
        this.viewfinder = false;
      }
    }).catch(cause => { if (this.state === 'ready') void this.release(errorMessage(cause)); });
  }

  capture(_session: string, _pose: number, _live: boolean, signal: AbortSignal) {
    return this.operation(signal, async (camera, active) => {
      this.viewfinder = false;
      this.pending++;
      this.toggleAck = this.step('Отключение видоискателя', () => camera.setConfigValue('viewfinder', false))
        .catch(cause => { this.viewfinder = true; void this.release(errorMessage(cause)); })
        .finally(() => { this.pending--; });
      await pause(100, active);
      if (document.hidden) throw new Error('Съёмка приостановлена.');
      this.uncertain = true;
      const file = await this.step('Спуск с AF и получение JPEG', () => camera.captureImageAsFile());
      const jpeg = await validatedCameraJpeg(file);
      this.uncertain = false;
      return jpeg;
    });
  }
}
