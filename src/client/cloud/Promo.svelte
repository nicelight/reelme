<script lang="ts">
  /** Public, read-only story gallery. No account/installation credentials,
   * capture actions or history mutations; only current visible promo media. */
  import { onMount } from 'svelte';
  import type { CatalogItem, CatalogPage } from '../../shared/capture';
  import StoryCatalog from '../capture/story/StoryCatalog.svelte';
  let items = $state<CatalogItem[]>([]);
  let activeId = $state<string>();
  let loading = $state(true);
  let error = $state('');
  let controller: AbortController | undefined;
  async function load() {
    controller?.abort();
    const request = new AbortController(); controller = request;
    loading = true; error = '';
    async function page(number: number): Promise<CatalogPage> {
      const response = await fetch(`/api/public/catalog?page=${number}`, { credentials: 'omit', signal: request.signal });
      if (!response.ok) throw new Error('Не удалось загрузить сюжеты. Попробуйте ещё раз.');
      return response.json();
    }
    try {
      const first = await page(1);
      const rest = await Promise.all(Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) => page(index + 2)));
      if (!request.signal.aborted) items = [...first.items, ...rest.flatMap(result => result.items)];
    } catch (cause) {
      if (!request.signal.aborted) error = cause instanceof Error ? cause.message : 'Не удалось загрузить сюжеты.';
    } finally { if (!request.signal.aborted) loading = false; }
  }
  onMount(() => { void load(); return () => controller?.abort(); });
</script>
<svelte:head><title>ReelMe — Ваша киноистория</title><meta name="description" content="Сюжеты ReelMe: посмотрите, каким может стать ваше фото." /></svelte:head>
<StoryCatalog {items} {activeId} installationKey="" {loading} {error} busy={false} previewOnly
  onbrowse={item => activeId = item.id} onbegin={() => {}} onback={() => activeId = items[0]?.id} onrefresh={load} />
<style>
  :global(body) { margin:0; background:#0d0a13; }
  :global(*),:global(*::before),:global(*::after) { box-sizing:border-box; }
  :global(::selection) { color:#231122; background:#f5a4df; }
</style>
