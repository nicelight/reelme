// Minimal surface used from WebUSB and the pinned web-gphoto2 build.
interface Interface {
  interfaceNumber: number;
  claimed: boolean;
  alternates: readonly { interfaceClass: number; interfaceSubclass: number }[];
}
interface Configuration {
  configurationValue: number;
  interfaces: readonly Interface[];
}
export interface Device {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName?: string;
  readonly manufacturerName?: string;
  readonly configuration: Configuration | null;
  readonly configurations: readonly Configuration[];
  open(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(value: number): Promise<void>;
  close(): Promise<void>;
}

export interface Usb extends EventTarget {
  requestDevice(options: { filters: { classCode: number; subclassCode: number }[] }): Promise<Device>;
  getDevices(): Promise<Device[]>;
}

interface Capabilities {
  captureImage: boolean;
  capturePreview: boolean;
  config: boolean;
}

export interface ConfigWidget {
  name: string;
  readonly: boolean;
  value?: string | boolean | number;
  choices?: string[];
  children?: Record<string, ConfigWidget>;
}

export function writableSettings(root: ConfigWidget): Record<string, ConfigWidget> {
  const settings: Record<string, ConfigWidget> = {};
  function visit(widget: ConfigWidget) {
    if (widget.children) Object.values(widget.children).forEach(visit);
    else if (!widget.readonly) settings[widget.name] = widget;
  }
  visit(root);
  return settings;
}

export interface Camera {
  prepareRuntime(): Promise<unknown>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getSupportedOps(): Promise<Capabilities>;
  getConfig(): Promise<ConfigWidget>;
  setConfigValue(name: string, value: boolean | string): Promise<void>;
  captureImageAsFile(): Promise<File>;
  capturePreviewAsBlob(): Promise<Blob>;
}

export function usbApi(): Usb | undefined {
  return (navigator as Navigator & { usb?: Usb }).usb;
}

export function unsupportedReason(): string {
  if (!window.isSecureContext) return 'Откройте страницу по HTTPS или через localhost.';
  if (!usbApi()) return 'Для доступа по WebUSB откройте страницу в настольном Chrome или Edge.';
  if (!window.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') return 'Недоступна изоляция страницы. Проверьте заголовки COOP и COEP для /cam-test-web.';
  return '';
}

export function chooseCamera(usb: Usb): Promise<Device> {
  // The picker must run in the click handler, before module loading or other awaits.
  return usb.requestDevice({ filters: [{ classCode: 6, subclassCode: 1 }] });
}

function ptpInterface(config: Configuration) {
  return config.interfaces.find(iface => iface.alternates.some(alt => alt.interfaceClass === 6 && alt.interfaceSubclass === 1));
}

export async function permittedCameras(usb: Usb) {
  return (await usb.getDevices()).filter(device => device.configurations.some(ptpInterface));
}

export async function checkSelectedCamera(usb: Usb, selected: Device): Promise<void> {
  // Upstream auto-detects a permitted PTP camera; it cannot take a USBDevice.
  const permitted = await permittedCameras(usb);
  if (permitted.length !== 1 || permitted[0] !== selected) {
    throw new Error('Для теста подключите одну разрешённую USB-камеру и выберите её снова.');
  }
}

type Trace = <T>(stage: string, run: () => Promise<T>) => Promise<T>;

// On reload test driver access with a fresh handle. close() releases the claimed
// interface before libgphoto2 takes ownership. No PTP transfers or shutter commands.
export async function reopenCanon(usb: Usb, trace: Trace): Promise<Device> {
  const device = await trace('Поиск разрешённой Canon · getDevices()', async () => {
    const devices = await permittedCameras(usb);
    const canon = devices[0];
    if (devices.length !== 1 || canon.vendorId !== 0x04a9 || canon.productId !== 0x3217) {
      throw new Error('Для автоподключения нужна одна ранее разрешённая Canon 04a9:3217. Доступных PTP-камер: ' + devices.length);
    }
    return canon;
  });
  await trace('Открытие USB · USBDevice.open()', () => device.open());
  try {
    const active = device.configuration;
    const config = active && ptpInterface(active) ? active : device.configurations.find(c => ptpInterface(c))!;
    if (active?.configurationValue !== config.configurationValue) {
      await trace('Выбор конфигурации USB · selectConfiguration()', () => device.selectConfiguration(config.configurationValue));
    }
    const number = ptpInterface(config)!.interfaceNumber;
    await trace('Доступ к PTP-интерфейсу · claimInterface(' + number + ')', () => device.claimInterface(number));
  } finally {
    await trace('Освобождение USB · USBDevice.close()', () => device.close());
  }
  return device;
}

export async function createCamera(): Promise<Camera> {
  const source = '/cam-test-web-assets/v0.4.1/build/camera.js';
  const { Camera } = await import(/* @vite-ignore */ source) as { Camera: new () => Camera };
  return new Camera();
}

export function errorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'Выбор камеры отменён или устройство отключено.';
  if (/busy|claim|занят|could not lock|in use/i.test(detail)) return 'USB-интерфейс занят. Закройте приложения камеры и другие вкладки теста.';
  if (/security|denied|access|permission/i.test(detail)) return 'Нет доступа к камере. Проверьте разрешение браузера и драйвер устройства.';
  if (/no camera|not found|disconnected|no device/i.test(detail)) return 'Камера недоступна. Проверьте USB-кабель и питание камеры.';
  return detail;
}
