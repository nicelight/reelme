<script lang="ts">
  import { boothCamera } from './camera-context';
  let { onopen }: { onopen?: () => void } = $props();
  const usb = boothCamera()?.usb;
  let dialog = $state<HTMLDialogElement>();
  const label = $derived(usb?.state === 'ready' ? 'Canon OK' : usb?.state === 'connecting' ? 'Подключение…' : usb?.state === 'closing' ? 'Отключение…' : 'Камера не подключена');
</script>
{#if usb}
  <button class="camera-status" aria-haspopup="dialog" onclick={() => { onopen?.(); dialog?.showModal(); }}>{label}</button>
  <dialog bind:this={dialog} aria-label="Подключение камеры">
    <h2>Камера Canon · WebUSB</h2>
    <p role="status">{usb.support || (usb.state === 'connecting' ? usb.stage : label)}</p>
    {#if !usb.support && usb.state === 'idle'}<p>В Windows для подключения через WebUSB нужен драйвер WinUSB. Перед подключением закройте digiCamControl.</p>{/if}
    {#if usb.attempt}<small>Код подключения · {usb.attempt.slice(0, 8)}</small>{/if}
    {#if usb.detail}<p role="alert">{usb.detail}</p>{/if}
    <div class="actions">
      {#if usb.state === 'idle'}<button disabled={!!usb.support} onclick={() => usb.connect()}>Выбрать камеру</button>
      {:else}<button disabled={usb.state === 'closing'} onclick={() => void usb.release()}>Освободить USB-порт</button>{/if}
      <button onclick={() => dialog?.close()}>Закрыть</button>
    </div>
  </dialog>
{/if}
<style>
  .camera-status,dialog button { color:#fff4fb;background:#291b2a;border:1px solid #80637a;border-radius:8px;padding:7px 12px;font:600 14px/1.3 Manrope,sans-serif;cursor:pointer; }
  .camera-status { flex:none;position:relative;z-index:1; }
  dialog { margin:auto;width:min(420px,92vw);padding:24px;border:1px solid #80637a;border-radius:16px;background:#1d1423;color:#fff4fb; }
  dialog::backdrop { background:#100b13bd; } h2 {font-size:20px;margin:0 0 12px}
  .actions {display:flex;gap:10px;flex-wrap:wrap;margin-top:20px} button:disabled {opacity:.55}
</style>
