import 'vite/modulepreload-polyfill';
import { mount } from 'svelte';
if (import.meta.env.DEV && new URLSearchParams(location.search).get('prototype') === 'results') {
  void import('./results-prototype/ResultsPrototype.svelte').then(({ default: Prototype }) => mount(Prototype, { target: document.getElementById('app')! }));
} else {
  const receive = /^\/receive\/([A-Za-z0-9_-]{43})\/?$/.exec(location.pathname);
  if (location.pathname === '/' && new URLSearchParams(location.search).get('screen') === 'results') location.replace('/results');
  else if (location.pathname === '/') void import('./Promo.svelte').then(({default: Promo}) => mount(Promo, {target: document.getElementById('app')!}));
  else if (receive) void import('./Receive.svelte').then(({ default: Receive }) => {
    mount(Receive, { target: document.getElementById('app')!, props: { token: receive[1] } });
  });
  else void Promise.all([import('./App.svelte'), import('./style.css')]).then(([{ default: App }]) => {
    mount(App, { target: document.getElementById('app')! });
  });
}
