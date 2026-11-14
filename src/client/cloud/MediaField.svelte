<script lang="ts">
  /** Module contract: uploads a new immutable material and previews protected
   * media. Replacing/removing a selection never deletes an existing file. */
  import { api, mediaUrl } from './api';
  import type { Media } from '../../shared/scenarios';
  let { label, kind, id, hint = '', optional = false, onUploaded, onRemove, onError, onBusy }: {
    label: string; kind: 'image' | 'video'; id?: string; hint?: string; optional?: boolean;
    onUploaded: (media: Media) => void; onRemove?: () => void;
    onError: (error: unknown) => void; onBusy: (busy: boolean) => void;
  } = $props();
  let uploading = $state(false);
  const inputId = $props.id();
  async function upload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploading = true; onBusy(true);
    try {
      const body = new FormData(); body.append('file', file);
      const media = await api<Media>('/admin/slot-media', { method: 'POST', body });
      if (media.kind !== kind) throw new Error(kind === 'image' ? 'Выберите изображение.' : 'Выберите видео.');
      onUploaded(media);
    } catch (error) { onError(error); }
    finally { uploading = false; onBusy(false); input.value = ''; }
  }
</script>

<div class="media-field">
  <label for={inputId} class="field-label">{label}{#if optional}<span class="optional">необязательно</span>{/if}</label>
  {#if hint}<p class="hint" id={`${inputId}-hint`}>{hint}</p>{/if}
  {#if id}
    <div class:video-preview={kind === 'video'} class="media-preview">
      {#if kind === 'image'}
        <img src={mediaUrl(id)} alt={label} />
      {:else}
        <video src={mediaUrl(id)} controls preload="metadata"><track kind="captions" /></video>
      {/if}
    </div>
  {/if}
  <div class="upload-row">
    <input id={inputId} type="file" accept={kind === 'image' ? 'image/jpeg,image/png,image/webp' : 'video/mp4,video/quicktime,.mov'} disabled={uploading} onchange={upload} aria-describedby={hint ? `${inputId}-hint` : undefined} aria-label={id ? `Заменить: ${label}` : label} />
    {#if id && onRemove}<button type="button" class="quiet small" onclick={onRemove} disabled={uploading}>Убрать</button>{/if}
  </div>
  {#if uploading}<p class="hint" role="status">Загружаем и проверяем файл…</p>{/if}
</div>
