<script lang="ts">
  let { label, accept, disabled = false, describedBy, onchange }: {
    label: string; accept: string; disabled?: boolean; describedBy?: string; onchange: (event: Event) => void;
  } = $props();
  let input: HTMLInputElement;
</script>

<input hidden bind:this={input} type="file" {accept} {disabled} {onchange} />
<button type="button" class="file-button" {disabled} aria-describedby={describedBy} onclick={() => input.click()}>{label}</button>

<style>
  .file-button { max-width:100%; border-color:var(--muted); background:var(--input); font-size:14px; }
</style>
