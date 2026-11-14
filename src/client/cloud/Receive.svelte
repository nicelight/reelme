<script lang="ts">
  /** Module contract: anonymous session form. Opening and email confirmation are
   * separate server events. Polls the actual email state; never infers sent from
   * acceptance, preserves entered text on failure and clears it after acceptance. */
  import { onMount } from 'svelte';
  import { api } from './api';
  import type { ReceiveStatus } from '../../shared/receive';
  let { token }: { token: string } = $props();
  let view = $state<ReceiveStatus>();
  let email = $state('');
  let busy = $state(false);
  let error = $state('');
  const path = $derived(`/receive/${encodeURIComponent(token)}`);
  const messages = {
    not_requested: 'Оставьте email для получения видео.',
    pending: 'Email принят. Письмо ожидает отправки.',
    sending: 'Отправляем письмо. Статус обновится автоматически.',
    sent: 'Письмо отправлено. Проверьте входящие и папку «Спам».',
    failed: 'Не удалось подтвердить отправку. Письмо могло уже уйти. Проверьте почту или введите адрес и повторите.',
  };
  async function refresh() { view = await api<ReceiveStatus>(path); }
  async function load() {
    error = '';
    try { view = await api<ReceiveStatus>(`${path}/opened`, { method: 'POST' }); }
    catch (e) { error = e instanceof Error ? e.message : 'Не удалось открыть форму.'; }
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !view?.canSubmit) return;
    busy = true; error = '';
    try { view = await api<ReceiveStatus>(`${path}/email`, { method: 'POST', body: JSON.stringify({ email }) }); email = ''; }
    catch (e) {
      error = e instanceof Error ? e.message : 'Не удалось сохранить email. Повторите попытку.';
      // A lost response or a second tab may have already accepted this form.
      try { await refresh(); if (!view?.canSubmit) email = ''; } catch {}
    } finally { busy = false; }
  }
  onMount(() => {
    void load();
    const timer = setInterval(() => {
      if (view && !busy && ['pending', 'sending'].includes(view.emailState)) {
        void refresh().then(() => { error = ''; }).catch(() => { error = 'Не удалось обновить статус. Проверим соединение ещё раз.'; });
      }
    }, 3000);
    return () => clearInterval(timer);
  });
</script>

<header class="app-header receive-header"><span class="brand"><span>reel</span>me<span class="brand-caption">ВАША ВИДЕОИСТОРИЯ</span></span></header>
<main class="receive-layout">
  {#if view}
    <div class="receive-photo"><img src={view.photoUrl} alt={`Ваш исходный снимок, сессия № ${view.number}`} /></div>
    <section class="receive-content" aria-labelledby="receive-title">
      <p class="eyebrow">ВАШЕ ВИДЕО ГОТОВО</p>
      <h1 id="receive-title">История № {view.number}</h1>
      <p class:receive-failed={view.emailState === 'failed'} class="receive-status" role="status">{messages[view.emailState]}</p>
      {#if view.canSubmit}
        <form onsubmit={submit}>
          <label for="receive-email">Ваш email</label>
          <input id="receive-email" name="email" type="email" bind:value={email} autocomplete="email" inputmode="email" required maxlength="254" placeholder="you@example.com" disabled={busy} aria-describedby="email-hint" />
          <p class="hint" id="email-hint">Проверьте адрес перед отправкой.</p>
          <button class="primary" type="submit" disabled={busy}>{busy ? 'Сохраняем…' : view.emailState === 'failed' ? 'Повторить отправку' : 'Получить видео по email'}</button>
        </form>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </section>
  {:else}
    <section class="receive-content"><h1>Получить видео</h1>{#if error}<p class="error" role="alert">{error}</p><button onclick={load}>Попробовать снова</button>{:else}<p class="receive-status" role="status">Открываем вашу историю…</p>{/if}</section>
  {/if}
</main>

<style>
  .receive-header { justify-content:center; }
  .receive-layout { max-width:960px; margin:0 auto; padding:32px 24px 56px; display:grid; gap:28px; }
  .receive-photo { background:var(--soft); border-radius:8px; overflow:hidden; }
  .receive-photo img { display:block; width:100%; max-height:420px; object-fit:contain; }
  .receive-content { align-self:center; min-width:0; }
  h1 { font-size:clamp(32px,5vw,44px); }
  .receive-status { margin-top:20px; color:var(--muted); max-width:42ch; }
  .receive-failed { color:var(--error); }
  form .primary { margin-top:24px; width:100%; }
  @media(min-width:720px) { .receive-layout { padding-top:72px; grid-template-columns:1fr 1fr; gap:48px; } .receive-photo img { max-height:520px; } }
</style>
