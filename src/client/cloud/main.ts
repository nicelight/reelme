import 'vite/modulepreload-polyfill';
import { mount } from 'svelte';
import App from './App.svelte';
import Receive from './Receive.svelte';
import './style.css';
const match = /^\/receive\/([A-Za-z0-9_-]{43})\/?$/.exec(location.pathname);
if (match) mount(Receive, { target: document.getElementById('app')!, props: { token: match[1] } });
else mount(App, { target: document.getElementById('app')! });
