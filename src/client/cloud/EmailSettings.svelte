<script lang="ts">
  import { onMount } from 'svelte';
  import { mailProviders, mailServers, type MailProvider, type MailProfile, type MailSettings } from '../../shared/email-settings';
  import { api, ApiError } from './api';
  let { onunauthorized }: { onunauthorized: () => void } = $props();
  const endpoint = '/admin/email-settings';
  const draftFor = (provider: MailProvider, saved?: MailProfile) => ({
    host: mailServers[provider] as string, port: 465, user: '', from: '', ...saved, password: '',
  });
  let drafts = $state({ mailru: draftFor('mailru'), smtpbz: draftFor('smtpbz') });
  let selected = $state<MailProvider>('mailru');
  let settings = $state<MailSettings>();
  let draft = $derived(drafts[selected]);
  let previous = $derived(settings?.profiles[selected]);
  let keepPassword = $derived(previous?.hasPassword && previous.user === draft.user && previous.host === draft.host);
  let to = $state('');
  let busy = $state<'save' | 'test' | null>(null);
  let error = $state('');
  let notice = $state('');
  let profileForm: HTMLFormElement;
  function clearFeedback() { error = ''; notice = ''; }
  function fail(cause: unknown) {
    error = cause instanceof Error ? cause.message : 'Не удалось выполнить запрос.';
    if (cause instanceof ApiError && cause.status === 401) onunauthorized();
  }
  onMount(() => {
    const controller = new AbortController();
    void api<MailSettings>(endpoint, { signal: controller.signal }).then(value => {
      settings = value;
      drafts = { mailru: draftFor('mailru', value.profiles.mailru), smtpbz: draftFor('smtpbz', value.profiles.smtpbz) };
      if (value.active === 'smtpbz') selected = value.active;
    }).catch(cause => { if (!controller.signal.aborted) fail(cause); });
    return () => controller.abort();
  });
  async function submit(event: SubmitEvent, action: 'save' | 'test') {
    event.preventDefault();
    if (busy || !profileForm.reportValidity()) return;
    clearFeedback(); busy = action;
    const profile = { provider: selected, user: draft.user, password: draft.password || undefined,
      ...(selected === 'smtpbz' && { host: draft.host, port: draft.port, from: draft.from }) };
    try {
      if (action === 'test') {
        await api(endpoint + '/test', { method: 'POST', body: JSON.stringify({ profile, to }) });
        notice = 'Почтовый сервис принял тестовое письмо. Проверьте ящик получателя.';
      } else {
        settings = await api<MailSettings>(endpoint, { method: 'PUT', body: JSON.stringify(profile) });
        drafts[selected] = draftFor(selected, settings.profiles[selected]);
        notice = 'Настройки почты сохранены.';
      }
    } catch (cause) { fail(cause); }
    finally { busy = null; }
  }
</script>
<section aria-labelledby="email-settings-heading">
  <h2 id="email-settings-heading">Электронная почта</h2>
  <div class="mail-card" oninput={clearFeedback}>
    {#if settings}
      <p class="hint active">{settings.active === 'environment' ? 'Отправка через настройки сервера.'
        : settings.active ? 'Отправка через ' + mailProviders[settings.active] + '.' : 'Отправка почты ещё не настроена.'}</p>
    {/if}
    <form bind:this={profileForm} onsubmit={event => submit(event, 'save')}>
      <fieldset disabled={!settings || !!busy}>
        <label>Почтовый сервис
          <select bind:value={selected}><option value="mailru">Mail.ru</option><option value="smtpbz">SMTP.BZ</option></select>
        </label>
        {#if selected === 'mailru'}
          <label>Адрес ящика Mail.ru<input type="email" required bind:value={draft.user} autocomplete="off" /></label>
        {:else}
          <div class="connection">
            <label>SMTP-сервер<input required bind:value={draft.host} /></label>
            <label>Порт<input type="number" min="1" max="65535" required bind:value={draft.port} /></label>
          </div>
          <label>Логин SMTP.BZ<input required bind:value={draft.user} autocomplete="off" /></label>
          <label>Адрес отправителя<input type="email" required bind:value={draft.from} /></label>
        {/if}
        <label>{selected === 'mailru' ? 'Пароль приложения' : 'Пароль SMTP.BZ'}
          <input type="password" autocomplete="new-password" bind:value={draft.password} required={!keepPassword}
            placeholder={keepPassword ? 'Пароль сохранён' : undefined} />
        </label>
        {#if selected === 'mailru'}
          <p class="hint">Используйте пароль для внешнего приложения. <a href="https://help.mail.ru/mail/faq/password/external/" target="_blank" rel="noopener noreferrer">Как создать пароль в Mail.ru</a></p>
        {/if}
        <button class="primary">{busy === 'save' ? 'Сохраняем…' : 'Сохранить и использовать'}</button>
      </fieldset>
    </form>
    <form class="test" onsubmit={event => submit(event, 'test')}>
      <fieldset disabled={!settings || !!busy}>
        <legend>Тестовое письмо</legend>
        <label>Адрес получателя<input type="email" required bind:value={to} /></label>
        <button>{busy === 'test' ? 'Отправляем…' : 'Отправить тестовое письмо'}</button>
      </fieldset>
    </form>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if notice}<p class="success" role="status">{notice}</p>{/if}
  </div>
</section>
<style>
  .mail-card { margin-top:16px; padding:clamp(16px,3vw,28px); border:1px solid var(--line); border-radius:16px; background:var(--surface); }
  form { max-width:540px; }
  fieldset { min-width:0; }
  label { display:grid; gap:6px; margin:0 0 16px; }
  input, select { width:100%; }
  .active { margin:0 0 18px; }
  .connection { display:grid; grid-template-columns:minmax(0,1fr) 6em; gap:12px; }
  .test { margin-top:24px; padding-top:20px; border-top:1px solid var(--line); }
  .hint { color:var(--muted); }
</style>
