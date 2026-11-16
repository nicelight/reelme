/** Module contract: select an already materialized prompt file for one supported
 * capture setup and the actual count of extra references. No prompt composition,
 * I/O, slot mutation, output-video validation or fallback to another setup.
 * Sources: docs/slot-setup/matrix.md and ./slot-setup-matrix.json.
 */
import matrix from './slot-setup-matrix.json' with { type: 'json' };

export type SlotParticipants = 1 | 2 | 'group';
export interface CaptureVariant {
  participants: SlotParticipants;
  photosPerParticipant: number;
  cameraPhotos: number;
  elementsCount: number;
  additionalReferenceLimit: number;
  /** Index is the actual number of additional reference images, including zero. */
  promptFiles: string[];
}
export interface SlotSetupModel {
  key: string;
  id: string;
  mode: 'V2V' | 'P2V';
  referenceStrategy: 'recast' | 'elements' | 'flat';
  resolutionOptions: string[];
  orientationMode: 'source-video' | 'aspect-ratio';
  aspectRatios: { landscape: string[]; portrait: string[] };
  promptMaxLength: number;
  captureVariants: CaptureVariant[];
}
export interface SlotSetupMatrix {
  version: number;
  source: string;
  promptBaseUrl: string;
  models: SlotSetupModel[];
}
export const slotSetupMatrix = matrix as SlotSetupMatrix;

export interface SlotPromptSelection {
  model: string;
  mode: 'V2V' | 'P2V';
  participants: SlotParticipants;
  photosPerParticipant: number;
  additionalReferenceCount: number;
}

/** Returns a path relative to public/slot-prompts and its future serving URL.
 * Callers load the file verbatim, including Recast's intentionally empty file.
 * Register the asset-serving route when integrating with the editor; this lookup
 * does not assert that the current server already serves promptBaseUrl.
 */
export function selectSlotPrompt(input: SlotPromptSelection): { file: string; url: string } {
  const model = slotSetupMatrix.models.find(item => item.id === input.model && item.mode === input.mode);
  if (!model) throw new Error('Модель не соответствует режиму');
  const variant = model.captureVariants.find(item => item.participants === input.participants && item.photosPerParticipant === input.photosPerParticipant);
  if (!variant) throw new Error('Этот набор персонажей и кадров недоступен для модели');
  const count = input.additionalReferenceCount;
  if (!Number.isInteger(count) || count < 0 || count > variant.additionalReferenceLimit) {
    throw new Error('Количество дополнительных референсов превышает возможности выбранного набора');
  }
  const file = variant.promptFiles[count];
  if (typeof file !== 'string') throw new Error('Для выбранного набора отсутствует файл промпта');
  return { file, url: `${slotSetupMatrix.promptBaseUrl}${file}` };
}
