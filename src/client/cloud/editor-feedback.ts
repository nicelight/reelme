// Fields contribute their current messages for as long as they belong to this form.
import { getContext, onDestroy, setContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';

type ReadIssues = () => (string | undefined)[];
const key = Symbol('slot editor feedback');

export function createEditorFeedback() {
  return setContext(key, new SvelteSet<ReadIssues>());
}

export function reportEditorIssues(read: ReadIssues) {
  const fields = getContext<SvelteSet<ReadIssues> | undefined>(key);
  fields?.add(read);
  onDestroy(() => fields?.delete(read));
  return !!fields;
}
