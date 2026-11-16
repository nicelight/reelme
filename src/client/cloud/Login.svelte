<script lang="ts">
  import './results-prototype/assets/fonts.css';
  let { username = $bindable(''), password = $bindable(''), busy, error, onsubmit }: {
    username: string; password: string; busy: boolean; error: string; onsubmit: (event: SubmitEvent) => void;
  } = $props();
</script>

<main class="login-page">
  <div class="login-content">
    <h1>Reel<span>Me</span></h1>
    <form class="login-card" aria-label="Войти в аккаунт" {onsubmit}>
      <div class="login-light" aria-hidden="true"><i class="login-halo"></i><i class="login-hotspot"></i></div>
      <label for="username">Логин</label>
      <input id="username" name="username" autocomplete="username" bind:value={username} required disabled={busy} />
      <label for="password">Пароль</label>
      <input id="password" name="password" type="password" autocomplete="current-password" bind:value={password} required disabled={busy} />
      {#if error}<p class="login-error" role="alert">{error}</p>{/if}
      <button class="login-submit" type="submit" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>
    </form>
  </div>
</main>

<style>
  .login-page { color-scheme:dark; min-height:100svh; display:grid; place-items:center; padding:40px 24px; font-family:Manrope,sans-serif; color:#fff4fb; background:radial-gradient(ellipse at 6% 0%,#3d1b39 0%,transparent 40%),radial-gradient(ellipse at 97% 100%,#27112f 0%,transparent 43%),#0d0a13; }
  .login-content { width:min(100%,420px); }
  h1 { margin:0 0 32px; text-align:center; color:#fff4fb; font-size:48px; font-weight:800; line-height:1.1; letter-spacing:-.035em; }
  h1 span { color:#f5a4df; }
  .login-card { position:relative; isolation:isolate; padding:36px; border:1px solid transparent; border-radius:26px; background:linear-gradient(125deg,rgba(46,23,48,.8),#130e1bea 68%) padding-box,linear-gradient(145deg,#ac59967d,#7b406b70) border-box; box-shadow:0 10px 36px #0005,0 0 12px #f573c014,inset 0 6px 24px #ed65be16; }
  .login-light { --corner-light:radial-gradient(ellipse 38% 85% at 8% 0%,#ffbbe0 0%,#fb7dbf 24%,#e969bda8 43%,transparent 78%),radial-gradient(ellipse 22% 58% at 100% 100%,#ffe5ef 0%,#ff9cd0 20%,#ed71bfab 45%,transparent 88%); position:absolute; inset:-1px; border-radius:inherit; pointer-events:none; }
  .login-light::before,.login-halo::before { content:''; position:absolute; inset:0; border-radius:inherit; background:var(--corner-light); padding:1.15px; mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0); mask-composite:exclude; }
  .login-halo { position:absolute; inset:0; border-radius:inherit; filter:blur(6px); opacity:.95; }
  .login-halo::before { padding:7px; }
  .login-hotspot { position:absolute; top:-.4px; left:8%; width:14%; height:2px; background:linear-gradient(90deg,transparent,#ffb0da 18%,#fffaf4 38%,#fffaf4 57%,#ffc3e3 72%,transparent); filter:drop-shadow(0 0 2.5px #ffe5f2) drop-shadow(0 0 5px #ff7fcaa6); }
  label { position:relative; display:block; margin:22px 0 8px; color:#ede0ec; font-size:13px; font-weight:600; }
  label:first-of-type { margin-top:0; }
  .login-page .login-card input { position:relative; width:100%; min-height:50px; margin:0; padding:12px 14px; border:1px solid #78506d; border-radius:10px; background:#140e1bd9; color:#fff4fb; font:500 16px/1.4 Manrope,sans-serif; caret-color:#f5a4df; }
  .login-page .login-card input:focus-visible { outline:2px solid #f5a4df; outline-offset:3px; border-color:#f5a4df; }
  .login-page .login-card input:disabled { opacity:.6; }
  .login-submit { position:relative; display:block; width:100%; min-height:50px; margin:28px 0 0; padding:12px 20px; border:1px solid #f1a9d5; border-radius:12px; background:#f5a4df; color:#231122; font:800 15px/1.4 Manrope,sans-serif; cursor:pointer; transition:background 150ms ease; }
  .login-submit:disabled { opacity:.6; cursor:wait; }
  .login-submit:focus-visible { outline:2px solid #fff4fb; outline-offset:4px; }
  .login-error { position:relative; margin:16px 0 0; color:#ffb6ca; font-size:13px; line-height:1.5; overflow-wrap:anywhere; }
  ::selection { background:#854569; color:#fff; }
  @media(hover:hover) and (pointer:fine) { .login-submit:hover:not(:disabled) { background:#ffd0ee; border-color:#ffd0ee; } }
  @media(max-width:480px) { .login-page { padding:32px 20px; } .login-card { padding:28px 24px; } h1 { font-size:42px; margin-bottom:28px; } }
  @media(prefers-reduced-motion:reduce) { .login-submit { transition:none; } }
</style>
