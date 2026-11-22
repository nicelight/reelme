import { getContext } from 'svelte';
import type { DigiCamControl } from './camera';
import type { CaptureDiagnostics } from './capture-diagnostics';
import type { BoothUsb } from './booth-usb.svelte';

export const cameraContext = Symbol('capture camera');
export interface BoothCamera {
  session: (diagnostics?: CaptureDiagnostics) => Pick<DigiCamControl, 'startLiveView' | 'preview' | 'capture' | 'hasPendingCapture'>;
  Diagnostics?: typeof CaptureDiagnostics;
  usb?: BoothUsb;
}
export function boothCamera() {
  return getContext<BoothCamera | undefined>(cameraContext);
}
