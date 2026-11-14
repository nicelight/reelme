/** Module contract: Scenarios removes only candidate materials no longer referenced
 * by a current slot or another saved session. Sessions supplies the event being
 * deleted; this module reads snapshots but never writes session-owned records.
 * Synchronous unlink/check/delete prevents a slot save interleaving with unlink. */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from '../db.js';
import type { SlotSnapshot } from '../../shared/capture.js';
import type { Slot } from '../../shared/scenarios.js';
export function materialIds(value: Slot | SlotSnapshot): string[] {
  const generation = 'generation' in value ? value.generation : value;
  return [value.thumbnailId, value.demoId, generation.videoId, ...(generation.referenceIds ?? [])].filter((id): id is string => !!id);
}
export function removeUnusedMaterials(db: DB, dataDir: string, candidates: string[], deletingDate: string) {
  const used = new Set<string>();
  for (const row of db.prepare('SELECT config FROM slots').all() as { config: string }[]) {
    materialIds(JSON.parse(row.config)).forEach(id => used.add(id));
  }
  for (const row of db.prepare('SELECT snapshot FROM capture_sessions WHERE event_date<>?').all(deletingDate) as { snapshot: string }[]) {
    materialIds(JSON.parse(row.snapshot)).forEach(id => used.add(id));
  }
  for (const id of new Set(candidates)) {
    if (used.has(id)) continue;
    const row = db.prepare('SELECT path FROM slot_media WHERE id=?').get(id) as { path: string } | undefined;
    if (!row) continue;
    rmSync(join(dataDir, 'media', row.path), { force: true });
    db.prepare('DELETE FROM slot_media WHERE id=?').run(id);
  }
}
