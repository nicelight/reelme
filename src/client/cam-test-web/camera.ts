// Minimal surface used from WebUSB and the pinned web-gphoto2 build.
export interface Device {
  readonly vendorId: number;
  readonly productName?: string;
  readonly manufacturerName?: string;
  readonly configurations: readonly {
    interfaces: readonly { alternates: readonly { interfaceClass: number; interfaceSubclass: number }[] }[];
  }[];
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

export async function createCamera(usb: Usb, selected: Device): Promise<Camera> {
  // Upstream auto-detects a permitted PTP camera; it cannot take a USBDevice.
  const permitted = (await usb.getDevices()).filter(device => device.configurations.some(configuration =>
    configuration.interfaces.some(iface => iface.alternates.some(alt => alt.interfaceClass === 6 && alt.interfaceSubclass === 1))
  ));
  if (permitted.length !== 1 || permitted[0] !== selected) {
    throw new Error('Для теста подключите одну разрешённую USB-камеру и выберите её снова.');
  }
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
