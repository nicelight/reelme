import type { DisplaySession } from '../../../shared/display';
const preparing = (item: DisplaySession) => item.stage >= 1 && item.stage <= 3 || item.simulation?.status === 'pending';
/** Eight stable header positions: ready entries stay in place until a waiting
 * preparing session replaces them. Changes never compact/reorder other slots. */
export class ProgressSlots {
  slots: (string | null)[] = Array(8).fill(null);
  waiting: string[] = [];
  sync(items: DisplaySession[]): (DisplaySession | null)[] {
    const byId = new Map(items.map(item => [item.id, item]));
    this.slots = this.slots.map(id => {
      const item = id ? byId.get(id) : undefined;
      return item && (preparing(item) || item.card) ? id : null;
    });
    const displayed = new Set(this.slots);
    this.waiting = this.waiting.filter(id => { const item = byId.get(id); return item && preparing(item) && !displayed.has(id); });
    for (const item of items) if (preparing(item) && !displayed.has(item.id) && !this.waiting.includes(item.id)) this.waiting.push(item.id);
    for (let index = 0; index < this.slots.length && this.waiting.length; index++) {
      const current = this.slots[index];
      if (current === null || byId.get(current)?.card) this.slots[index] = this.waiting.shift()!;
    }
    return this.slots.map(id => id ? byId.get(id) ?? null : null);
  }
}
