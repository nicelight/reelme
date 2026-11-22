<script lang="ts">
  import type { Snippet } from 'svelte';
  import { createEditorFeedback } from './editor-feedback';

  let { children, onsubmit, disabled, saving, notice, error, validation, hint }: {
    children: Snippet; onsubmit: (event: SubmitEvent) => void; disabled: boolean;
    saving: boolean; notice: string; error: string; validation: string[]; hint: string;
  } = $props();
  const fields = createEditorFeedback();
  const issues = $derived([...new Set([error, ...validation, ...[...fields].flatMap(read => read())].filter(Boolean))]);
</script>

<form {onsubmit} novalidate>
  {@render children()}
  <div class="editor-footer">
    <div>
      {#if issues.length}
        <div class="editor-issues" role="alert">
          <strong>Проверьте сюжет</strong>
          <ul>{#each issues as issue}<li>{issue}</li>{/each}</ul>
        </div>
      {/if}
      {#if notice}<p class="success" role="status">{notice}</p>{/if}
      {#if hint}<p class="hint">{hint}</p>{/if}
    </div>
    <button class="primary" type="submit" {disabled}>{saving ? 'Сохраняем…' : 'Сохранить сюжет'}</button>
  </div>
</form>
