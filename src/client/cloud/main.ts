import 'vite/modulepreload-polyfill';
import { mount } from 'svelte';
if (import.meta.env.DEV && new URLSearchParams(location.search).get('prototype') === 'results') {
  void import('./results-prototype/ResultsPrototype.svelte').then(({ default: Prototype }) => mount(Prototype, { target: document.getElementById('app')! }));
} else {
  void Promise.all([import('./App.svelte'), import('./Receive.svelte'), import('./style.css')]).then(([{default: App}, {default: Receive}]) => {
    const match = /^\/receive\/([A-Za-z0-9_-]{43})\/?$/.exec(location.pathname);
    if (match) mount(Receive, { target: document.getElementById('app')!, props: { token: match[1] } });
    else mount(App, { target: document.getElementById('app')! });
  });
}
