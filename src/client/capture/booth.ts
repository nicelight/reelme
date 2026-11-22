import { mount } from 'svelte';
import App from './App.svelte';
import { cameraContext, type BoothCamera } from './camera-context';
import { BoothUsb } from './booth-usb.svelte';

const usb = new BoothUsb();
const camera: BoothCamera = { usb, session: () => usb };
mount(App, { target: document.getElementById('app')!, context: new Map([[cameraContext, camera]]) });
