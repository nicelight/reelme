/** Module contract: Scenarios' read boundary for editor, catalog and session
 * snapshots. Snapshot is a new value containing concrete immutable media IDs;
 * no pin/version registry and no writes to Sessions. Hidden slots cannot start. */
import type { DB } from '../db.js';
import { recastId, type Slot } from '../../shared/scenarios.js';
import type { CatalogItem, SlotSnapshot } from '../../shared/capture.js';
import { HttpError } from '../errors.js';

export function readSlot(db: DB, id: string): Slot {
  const row = db.prepare('SELECT config FROM slots WHERE id=?').get(id) as { config: string } | undefined;
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Сюжет не найден');
  return { ...JSON.parse(row.config), id };
}
export function visibleSlot(db: DB, id: string): Slot {
  const slot = readSlot(db, id);
  if (!slot.visible) throw new HttpError(404, 'NOT_FOUND', 'Сюжет не найден');
  return slot;
}
export function catalogItem(slot: Slot): CatalogItem {
  const previewId = slot.mode === 'V2V' ? slot.videoId : slot.demoId;
  return { id: slot.id, description: slot.description, thumbnailId: slot.thumbnailId, mode: slot.mode, ...(previewId ? { previewId } : {}) };
}
export function snapshotSlot(db: DB, id: string): SlotSnapshot {
  const { id: slotId, description, thumbnailId, demoId, visible: _visible, ...generation } = visibleSlot(db, id);
  return {
    slotId, description, thumbnailId, ...(demoId ? { demoId } : {}),
    expectedPhotos: generation.model === recastId ? 1 : 4,
    generation,
  };
}
