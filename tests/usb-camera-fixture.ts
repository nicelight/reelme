import type { Page } from '@playwright/test';

// Exercise the shipped JS queue and its 800 ms acknowledgement timer. Only
// the WASM camera context and browser device picker are simulated.
export async function mockUsbCamera(page: Page, bytes: Buffer) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    const config = { configurationValue: 1, interfaces: [{ interfaceNumber: 0, alternates: [{ interfaceClass: 6, interfaceSubclass: 1 }] }] };
    const device = { vendorId: 0x04a9, productId: 0x3217, productName: 'Canon EOS 1100D',
      configurations: [config], configuration: config,
      opened: false,
      async close() { calls.push('close'); this.opened = false; window.dispatchEvent(new Event('camera-handle-closed')); }
    };
    const usb = Object.assign(new EventTarget(), {
      requestDevice: async () => { calls.push('picker'); return device; },
      getDevices: async () => { calls.push('list'); return [device]; }
    });
    Object.assign(window, { usbCalls: calls, cameraDevice: device });
    Object.defineProperty(navigator, 'usb', { configurable: true, value: usb });
  });
  await page.route('**/cam-test-web-assets/*/build/libapi.mjs', route => route.fulfill({
    contentType: 'text/javascript',
    body: `
      const jpeg = Uint8Array.from(atob('${bytes.toString('base64')}'), c => c.charCodeAt(0));
      const stats = window.usbTest = { shots: 0, previews: 0, active: 0, overlaps: 0, stops: 0, writes: [],
        failOff: false, holdShot: false };
      async function read(ms = 25) {
        if (stats.active++) stats.overlaps++;
        await new Promise(resolve => setTimeout(resolve, ms));
        stats.active--;
      }
      class Context {
        constructor() {
          window.cameraDevice.opened = true;
          if (window.holdOpen) return new Promise((_, reject) => {
            window.addEventListener('camera-handle-closed', () => reject(new Error('USB closed')), {once:true});
          });
        }
        isDeleted() { return false; }
        delete() { if (stats.active) stats.overlaps++; }
        supportedOps() { return {capturePreview:true, captureImage:true, config:true}; }
        configToJS() {
          if (window.holdConfig) return new Promise((_, reject) => { window.rejectConfig = reject; });
          const controls = {
            viewfinder: {}, autofocusdrive: {}, manualfocusdrive: { choices: ['Near 1', 'Near 2', 'Near 3', 'Far 1', 'Far 2', 'Far 3'] },
            afmethod: { choices: ['Quick', 'Live'], value: 'Quick' }, eosremoterelease: { choices: ['Immediate'] }
          };
          for (const [name, widget] of Object.entries(controls)) Object.assign(widget, {name, readonly:false});
          return {name:'main', children:{ actions: {name:'actions', children:controls} }};
        }
        async setConfigValue(name, value) {
          stats.writes.push([name, value]);
          if (name === 'viewfinder' && value === false) {
            stats.stops++;
            stats.offAt = performance.now();
            await read();
            if (stats.failOff) throw new Error('viewfinder failure');
          } else await read();
        }
        async capturePreviewAsBlob() {
          await read(); stats.previews++;
          return new Blob([jpeg], {type:'image/jpeg'});
        }
        async captureImageAsFile() {
          const shot = ++stats.shots;
          stats.shotAt = performance.now();
          if (stats.holdShot) await new Promise(resolve => { stats.releaseShot = resolve; });
          await read(120);
          if (stats.failShot || shot === 7) throw new Error('Transfer interrupted');
          return new File([jpeg], 'frame-' + shot + '.jpg', {type:'image/jpeg'});
        }
      }
      export default async () => ({Context});`,
  }));
}
