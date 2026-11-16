/** Module contract: Scenarios' read boundary for editor, catalog and session
 * snapshots. Snapshot is a new value containing concrete immutable media IDs;
 * no pin/version registry and no writes to Sessions. Only an explicit manual
 * test may snapshot a hidden slot and retain its private test-photo source.
 * Raw legacy records stay distinct from editor defaults. Source: docs/slot-setup/matrix.md. */
import type { DB } from '../db.js';
import { hasSlotSetup, normalizeSlotForEditor, recastId, slotSchema, type Slot } from '../../shared/scenarios.js';
import type { CatalogItem, SlotSnapshot } from '../../shared/capture.js';
import { buildPosePlan } from '../../shared/slot-setup.js';
import { HttpError } from '../errors.js';
import { readMedia, readTestPhoto } from './media.js';
import { readCaptureGuides } from './guides.js';

export function readSlot(db: DB, id: string): Slot {
  const row = db.prepare('SELECT config FROM slots WHERE id=?').get(id) as { config: string } | undefined;
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Сюжет не найден');
  return { simulateGeneration: false, ...JSON.parse(row.config), id };
}
export function visibleSlot(db: DB, id: string): Slot {
  const slot = readSlot(db, id);
  if (!slot.visible || !slotReady(slot)) throw new HttpError(404, 'NOT_FOUND', 'Сюжет не найден');
  return slot;
}
export function slotReady(slot: Slot): boolean { return slot.mode !== 'V2V' || !!slot.videoId; }
/** Projection only: never save inferred setup back into a legacy row here. */
export function editorSlot(db: DB, slot: Slot): Slot {
  if (hasSlotSetup(slot)) return slot;
  const video = slot.videoId ? readMedia(db, slot.videoId) : undefined;
  return normalizeSlotForEditor(slot, video && video.height > video.width ? 'portrait' : 'landscape');
}
export function catalogItem(slot: Slot): CatalogItem {
  const previewId = slot.mode === 'V2V' ? slot.videoId : slot.demoId;
  return { id: slot.id, description: slot.description, thumbnailId: slot.thumbnailId, mode: slot.mode, ...(previewId ? { previewId } : {}) };
}
export function snapshotSlot(db: DB, id: string, manualTest = false): SlotSnapshot {
  const slot = readSlot(db, id);
  if (!manualTest && !slot.visible) throw new HttpError(404, 'NOT_FOUND', 'Сюжет не найден');
  if (!slotReady(slot)) throw new HttpError(400, 'TEMPLATE_VIDEO_REQUIRED', 'Для запуска нужен шаблонный ролик слота');
  const configured = hasSlotSetup(slot);
  if (configured) { const { id: _id, ...input } = slot; slotSchema.parse(input); }
  const posePlan = configured ? buildPosePlan(slot, readCaptureGuides(db)) : undefined;
  const { id: slotId, description, thumbnailId, demoId, testPhotoId, testPhotoIds, visible: _visible, ...generation } = slot;
  if (manualTest) {
    if (posePlan) {
      if (!testPhotoIds || testPhotoIds.length !== posePlan.length) throw new HttpError(400, 'TEST_PHOTOS_REQUIRED', 'Добавьте отдельное тестовое фото для каждого кадра');
      testPhotoIds.forEach(id => readTestPhoto(db, id));
    } else {
      if (!testPhotoId) throw new HttpError(400, 'TEST_PHOTO_REQUIRED', 'Сохраните тестовую фотографию JPEG');
      readTestPhoto(db, testPhotoId);
    }
  }
  return {
    slotId, description, thumbnailId, ...(demoId ? { demoId } : {}), ...(manualTest ? posePlan ? { testPhotoIds: [...testPhotoIds!] } : { testPhotoId } : {}),
    expectedPhotos: posePlan?.length ?? (generation.model === recastId ? 1 : 4),
    ...(posePlan ? { posePlan } : {}),
    generation,
  };
}
