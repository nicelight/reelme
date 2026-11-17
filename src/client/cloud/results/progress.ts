import type { DisplaySession } from '../../../shared/display';
const preparing = (item: DisplaySession) => item.stage >= 1 && item.stage <= 3 || item.simulation?.status === 'pending';
/** Eight stable status positions. Local card failures enter once and replace the
 * same session's ready label; later waiting sessions may reuse terminal slots. */
export class ProgressSlots {
  slots: (string | null)[] = Array(8).fill(null);
  waiting: string[] = [];
  private reportedFailures = new Set<string>();
  sync(items: DisplaySession[], failed: ReadonlySet<string> = new Set()): (DisplaySession | null)[] {
    const byId = new Map(items.map(item => [item.id, item]));
    this.slots = this.slots.map(id => {
      const item = id ? byId.get(id) : undefined;
      return item && (preparing(item) || item.card) ? id : null;
    });
    const displayed = new Set(this.slots);
    this.waiting = this.waiting.filter(id => { const item = byId.get(id); return item && (preparing(item) || failed.has(id)) && !displayed.has(id); });
    for (const item of items) {
      if ((preparing(item) || failed.has(item.id) && !this.reportedFailures.has(item.id)) && !displayed.has(item.id) && !this.waiting.includes(item.id)) this.waiting.push(item.id);
      if (failed.has(item.id)) this.reportedFailures.add(item.id);
    }
    for (let index = 0; index < this.slots.length && this.waiting.length; index++) {
      const current = this.slots[index];
      if (current === null || byId.get(current)?.card) this.slots[index] = this.waiting.shift()!;
    }
    return this.slots.map(id => id ? byId.get(id) ?? null : null);
  }
}
