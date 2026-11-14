import 'vite/modulepreload-polyfill';
import { mount } from 'svelte';
import App from './App.svelte';
const target = document.getElementById('app')!;
target.replaceChildren();
mount(App, { target });
