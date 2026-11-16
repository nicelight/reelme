/** Module contract: pure lookup and capture planning from the accepted matrix.
 * A plan owns ordered camera positions, never media uploads or prompt text.
 * Saved session plans are read verbatim, not rebuilt from current settings.
 * Source: docs/slot-setup/matrix.md.
 */
import { slotSetupMatrix, type SlotParticipants } from './slot-prompt-selection.js';
import type { Pose } from './capture.js';

export interface SlotSetup {
  model: string;
  mode: 'V2V' | 'P2V';
  participants: SlotParticipants;
  photosPerParticipant: number;
}
export type Orientation = 'landscape' | 'portrait';
export type GuideNumber = 1 | 2 | 3 | 4 | 5;
export const unequalPhotoMessage = 'выберите меньшее количество фотографий во время фотосессии.';
export interface CaptureGuide { number: GuideNumber; instruction: string; mediaId?: string }

export const captureGuides: readonly CaptureGuide[] = [
  { number: 1, instruction: 'Смотрите прямо в объектив' },
  { number: 2, instruction: 'Улыбнитесь и наклонитесь к камере одним плечом' },
  { number: 3, instruction: 'Повернитесь в профиль' },
  { number: 4, instruction: 'Посмотрите вниз на обувь оператора' },
  { number: 5, instruction: 'Групповое фото: все участники смотрят в камеру' },
];
const guideKeys = ['front', 'smile', 'profile-left', 'look-down', 'group'] as const;

/** Flat ordinary-image budgets only; photos inside Elements do not use this path. */
export function allocatePhotoBudget(total: number, participants: SlotParticipants, requested: number) {
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(requested) || requested < 1) throw new Error('Invalid photo budget');
  const first = Math.min(requested, total);
  const photos = participants === 2 ? [first, Math.min(requested, Math.max(0, total - first))] : [first];
  return { photos, additionalReferences: total - photos.reduce((sum, count) => sum + count, 0),
    error: participants === 2 && photos[0] !== photos[1] ? unequalPhotoMessage
      : photos.some(count => count !== requested) ? `Доступно не более ${total} фотографий` : undefined };
}

export function getSlotSetup(input: SlotSetup) {
  const model = slotSetupMatrix.models.find(item => item.id === input.model && item.mode === input.mode);
  if (!model) throw new Error('Модель не соответствует режиму');
  const variant = model.captureVariants.find(item => item.participants === input.participants && item.photosPerParticipant === input.photosPerParticipant);
  if (!variant) throw new Error('Этот набор персонажей и кадров недоступен для модели');
  return { model, variant };
}

/** Guides are copied into the plan so their later replacement cannot change it. */
export function buildPosePlan(input: SlotSetup, guides: readonly CaptureGuide[] = captureGuides): Pose[] {
  const { variant } = getSlotSetup(input);
  const people: SlotParticipants[] = input.participants === 'group' ? ['group'] : input.participants === 2 ? [1, 2] : [1];
  return people.flatMap(participant => Array.from({ length: variant.photosPerParticipant }, (_, offset) => {
    const guideNumber = (participant === 'group' ? 5 : offset + 1) as GuideNumber;
    const guide = guides.find(item => item.number === guideNumber) ?? captureGuides[guideNumber - 1];
    return { index: (participant === 2 ? variant.photosPerParticipant : 0) + offset, participant,
      guideNumber, key: guideKeys[guideNumber - 1], instruction: guide.instruction,
      ...(guide.mediaId ? { guideMediaId: guide.mediaId } : {}) };
  }));
}

/** UI defaults for a legacy slot; this does not migrate the persisted slot. */
export function defaultSlotSetup(modelId: string, mode: 'V2V' | 'P2V', orientation: Orientation = 'landscape') {
  const model = slotSetupMatrix.models.find(item => item.id === modelId && item.mode === mode);
  if (!model) throw new Error('Модель не соответствует режиму');
  return { participants: 1 as const, photosPerParticipant: model.referenceStrategy === 'recast' ? 1 : 4, orientation,
    ...(model.orientationMode === 'aspect-ratio' ? { aspectRatio: model.aspectRatios[orientation][0] } : {}) };
}
