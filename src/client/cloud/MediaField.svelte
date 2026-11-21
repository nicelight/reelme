<script lang="ts">
  /** Module contract: uploads a new immutable material and previews protected
   * media. Replacing/removing a selection never deletes an existing file.
   * Source: docs/slot-setup/matrix.md. Each test position uploads its own material. */
  import ServerUploadStatus from './ServerUploadStatus.svelte';
  import FileButton from './FileButton.svelte';
  import { api, mediaUrl } from './api';
  import { MAX_PHOTO_BYTES } from '../../shared/capture';
  import { MAX_VIDEO_UPLOAD_MB, MAX_VIDEO_UPLOAD_BYTES, videoUploadLimitMessage, type Media } from '../../shared/scenarios';
  let { label, buttonLabel, kind, id, hint = '', optional = false, jpegOnly = false, onUploaded, onRemove, onError, onBusy }: {
    label: string; buttonLabel?: string; kind: 'image' | 'video'; id?: string; hint?: string; optional?: boolean; jpegOnly?: boolean;
    onUploaded: (media: Media) => void; onRemove?: () => void;
    onError: (error: unknown) => void; onBusy: (busy: boolean) => void;
  } = $props();
  let uploading = $state(false);
  let sizeError = $state('');
  const inputId = $props.id();
  const accept = $derived(jpegOnly ? 'image/jpeg,.jpg,.jpeg' : kind === 'image' ? 'image/jpeg,image/png,image/webp' : 'video/mp4,video/quicktime,.mov');
  const uploadHint = $derived(kind === 'image' && !jpegOnly
    ? `${hint ? `${hint} ` : ''}JPEG, PNG или WebP.`
    : kind === 'video' ? `${hint} До ${MAX_VIDEO_UPLOAD_MB} МБ.`.trim() : hint);
  async function upload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    sizeError = '';
    if (kind === 'video' && file.size > MAX_VIDEO_UPLOAD_BYTES) {
      sizeError = videoUploadLimitMessage; input.value = ''; return;
    }
    uploading = true; onBusy(true);
    try {
      if (jpegOnly && (file.type !== 'image/jpeg' || file.size > MAX_PHOTO_BYTES)) throw new Error('Выберите JPEG до 20 MiB.');
      const body = new FormData(); body.append('file', file);
      const media = await api<Media>('/admin/slot-media', { method: 'POST', body });
      if (media.kind !== kind) throw new Error(kind === 'image' ? 'Выберите изображение.' : 'Выберите видео.');
      onUploaded(media);
    } catch (error) { onError(error); }
    finally { uploading = false; onBusy(false); input.value = ''; }
  }
</script>

<div class="media-field">
  {#if !buttonLabel}<label for={inputId} class="field-label">{label}{#if optional}<span class="optional">необязательно</span>{/if}</label>{/if}
  {#if !buttonLabel && uploadHint}<p class="hint" id={`${inputId}-hint`}>{uploadHint}</p>{/if}
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
    {#if buttonLabel}
      <FileButton label={buttonLabel} {accept} disabled={uploading} onchange={upload} />
    {:else}
      <input id={inputId} type="file" {accept} disabled={uploading} onchange={upload} aria-describedby={uploadHint ? `${inputId}-hint` : undefined} aria-label={id ? `Заменить: ${label}` : label} />
    {/if}
    {#if id && onRemove}<button type="button" class="quiet small" onclick={onRemove} disabled={uploading}>Убрать</button>{/if}
  </div>
  {#if uploading}<ServerUploadStatus />{/if}
  {#if sizeError}<p class="error" role="alert">{sizeError}</p>{/if}
</div>
