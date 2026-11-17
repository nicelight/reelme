/** Module contract: public scenario DTOs and the finite, accepted model rules.
 * Shared by editor/server; no credentials, provider calls or storage. Materials
 * are immutable IDs; demo media is separate from generation inputs.
 * Simulation without an output is the legacy input-only check; output=video opts
 * a new session into local video delivery. Legacy snapshots keep their meaning.
 * Source: docs/slot-setup/matrix.md.
 */
import { z } from 'zod';
import { slotSetupMatrix } from './slot-prompt-selection.js';
import { defaultSlotSetup, getSlotSetup, type Orientation } from './slot-setup.js';

export type Mode = 'V2V' | 'P2V';
export interface Model {
  id: string; name: string; mode: Mode; resolutions: readonly string[];
  defaultResolution?: string; prompt: boolean; hint: string;
  minSeconds: number; maxSeconds: number; maxVideoMB?: number;
}
const klingHint = 'Посетитель: @Element1. Фото сюжета: @Image1, @Image2, @Image3.';
const legacyModels: readonly Model[] = [
  { id: 'minimax/h3-max/recast', name: 'MiniMax H3 Max Recast', mode: 'V2V', resolutions: ['768P', '1080P'], defaultResolution: '768P', prompt: false, hint: 'Один главный персонаж. Непрерывный кадр — не более 15 секунд.', minSeconds: 5, maxSeconds: 30 },
  { id: 'fal-ai/kling-video/o1/video-to-video/edit', name: 'Kling O1 Edit Pro', mode: 'V2V', resolutions: [], prompt: true, hint: klingHint, minSeconds: 3, maxSeconds: 10, maxVideoMB: 200 },
  { id: 'fal-ai/kling-video/o3/pro/video-to-video/edit', name: 'Kling O3 Edit Pro', mode: 'V2V', resolutions: [], prompt: true, hint: klingHint, minSeconds: 3, maxSeconds: 15, maxVideoMB: 200 },
  { id: 'kling/v4/video-to-video/edit', name: 'Kling 4 Editing', mode: 'V2V', resolutions: ['720p', '1080p'], defaultResolution: '720p', prompt: true, hint: klingHint, minSeconds: 3, maxSeconds: 30, maxVideoMB: 300 },
  { id: 'kling/v4/flash/video-to-video', name: 'Kling 4 Flash Editing', mode: 'V2V', resolutions: ['720p'], defaultResolution: '720p', prompt: true, hint: klingHint, minSeconds: 3, maxSeconds: 20, maxVideoMB: 300 },
  { id: 'kling/v4/reference-to-video', name: 'Kling 4 Reference', mode: 'P2V', resolutions: ['720p', '1080p'], defaultResolution: '720p', prompt: true, hint: klingHint, minSeconds: 3, maxSeconds: 30 },
  { id: 'fal-ai/kling-video/o3/pro/reference-to-video', name: 'Kling O3 Reference Pro', mode: 'P2V', resolutions: [], prompt: true, hint: klingHint, minSeconds: 3, maxSeconds: 15 },
  { id: 'kling/v4/flash/reference-to-video', name: 'Kling 4 Flash Reference', mode: 'P2V', resolutions: ['720p'], defaultResolution: '720p', prompt: true, hint: klingHint, minSeconds: 3, maxSeconds: 20 },
  { id: 'minimax/h3-max/reference-to-video', name: 'H3 Max Reference', mode: 'P2V', resolutions: ['480P', '768P', '1080P'], defaultResolution: '768P', prompt: true, hint: 'Фото посетителя: Image 1–4. Фото сюжета: Image 5–7. Расширение промпта отключено.', minSeconds: 0.92, maxSeconds: 15 },
  { id: 'fal-ai/vidu/q4/reference-to-video', name: 'Vidu Q4 Reference', mode: 'P2V', resolutions: ['540p', '720p', '1080p', '2K', '4K'], defaultResolution: '720p', prompt: true, hint: 'Фото посетителя: [@reference_image_1]–[@reference_image_4]. Фото сюжета: [@reference_image_5]–[@reference_image_7].', minSeconds: 3, maxSeconds: 16 },
  { id: 'google/gemini-omni-flash/v1.2/reference-to-video', name: 'Gemini Omni Flash 1.2', mode: 'P2V', resolutions: ['360p', '720p', '1080p', '4k'], defaultResolution: '720p', prompt: true, hint: 'Фото посетителя: <IMAGE_REF_0>–<IMAGE_REF_3>. Фото сюжета: <IMAGE_REF_4>–<IMAGE_REF_6>.', minSeconds: 3, maxSeconds: 15 },
];
export const models: readonly Model[] = legacyModels.map(model => ({ ...model,
  resolutions: slotSetupMatrix.models.find(item => item.id === model.id)!.resolutionOptions,
}));
export const recastId = models[0].id;
const id = z.string().uuid();
/** Read only: accepted snapshots and raw slots written before configurable plans. */
export const legacySlotSchema = z.object({
  description: z.string().trim().min(1, 'Добавьте описание').max(5000),
  visible: z.boolean(), thumbnailId: id, simulateGeneration: z.boolean().default(false), simulationOutput: z.literal('video').optional(), testPhotoId: id.optional(),
  mode: z.enum(['V2V', 'P2V']), model: z.string(),
  videoId: id.optional(), referenceIds: z.array(id).max(3).default([]), demoId: id.optional(),
  prompt: z.string().trim().max(10000).optional(),
  resolution: z.string().optional(), duration: z.number().finite().optional(),
  // Human attestation: automatic cut detection cannot prove a semantic shot boundary.
  recastShotsConfirmed: z.boolean().optional(),
  promptExpansionMode: z.literal('disabled').optional(),
}).strict().superRefine((slot, ctx) => {
  const fail = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (slot.simulationOutput && !slot.simulateGeneration) fail('simulationOutput', 'Тестовое видео требует режима эмуляции');
  const model = legacyModels.find(m => m.id === slot.model);
  if (!model || model.mode !== slot.mode) { fail('model', 'Модель не соответствует режиму'); return; }
  if (model.prompt && !slot.prompt) fail('prompt', 'Введите промпт');
  const promptLimit = model.id.startsWith('fal-ai/kling-video/') ? 2500 : model.id === 'fal-ai/vidu/q4/reference-to-video' ? 5000 : 10000;
  if (slot.prompt && slot.prompt.length > promptLimit) fail('prompt', `Промпт: не более ${promptLimit} символов`);
  if (!model.prompt && slot.prompt !== undefined) fail('prompt', 'Recast не принимает промпт');
  if (model.resolutions.length ? !model.resolutions.includes(slot.resolution ?? '') : slot.resolution !== undefined) fail('resolution', 'Недопустимое разрешение модели');
  if (slot.mode === 'V2V') {
    if (!slot.videoId) fail('videoId', 'Загрузите исходное видео');
    if (slot.referenceIds.length || slot.demoId) fail('referenceIds', 'V2V использует только исходное видео');
    if (slot.duration !== undefined) fail('duration', 'Длительность V2V определяется исходным видео');
  } else {
    if (slot.videoId) fail('videoId', 'В P2V нет исходного видео');
    if (slot.duration === undefined || slot.duration < model.minSeconds || slot.duration > model.maxSeconds || (model.id !== 'minimax/h3-max/reference-to-video' && !Number.isInteger(slot.duration))) fail('duration', `Длительность: ${model.minSeconds}–${model.maxSeconds} с`);
  }
  if (model.id === recastId && slot.recastShotsConfirmed !== true) fail('recastShotsConfirmed', 'Подтвердите: непрерывные кадры не длиннее 15 секунд');
  if (model.id !== recastId && slot.recastShotsConfirmed !== undefined) fail('recastShotsConfirmed', 'Подтверждение относится только к Recast');
  if (model.id === 'minimax/h3-max/reference-to-video' ? slot.promptExpansionMode !== 'disabled' : slot.promptExpansionMode !== undefined) fail('promptExpansionMode', 'Недопустимый режим расширения промпта');
});
/** New saves and new-plan input preparation share one strict contract. */
const slotFields = z.object({
  description: z.string().trim().min(1).max(5000), visible: z.boolean(), thumbnailId: id,
  simulateGeneration: z.boolean().default(false), simulationOutput: z.literal('video').optional(), testPhotoId: id.optional(), testPhotoIds: z.array(id).max(8).optional(),
  mode: z.enum(['V2V', 'P2V']), model: z.string(),
  participants: z.union([z.literal(1), z.literal(2), z.literal('group')]),
  photosPerParticipant: z.number().int().min(1).max(4),
  orientation: z.enum(['landscape', 'portrait']), aspectRatio: z.string().optional(),
  videoId: id.optional(), referenceIds: z.array(id).default([]), demoId: id.optional(),
  prompt: z.string().trim().optional(), resolution: z.string().optional(), duration: z.number().finite().optional(),
  recastShotsConfirmed: z.boolean().optional(), promptExpansionMode: z.literal('disabled').optional(),
}).strict();
export const slotSchema = slotFields.superRefine((slot, ctx) => {
  const fail = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (slot.simulationOutput && !slot.simulateGeneration) fail('simulationOutput', 'Тестовое видео требует режима эмуляции');
  const timing = models.find(model => model.id === slot.model && model.mode === slot.mode);
  if (!timing) { fail('model', 'Модель не соответствует режиму'); return; }
  let setup;
  try { setup = getSlotSetup(slot); }
  catch (error) { fail('photosPerParticipant', (error as Error).message); return; }
  const { model, variant } = setup;
  if (slot.testPhotoIds?.length && (slot.testPhotoIds.length !== variant.cameraPhotos || new Set(slot.testPhotoIds).size !== slot.testPhotoIds.length)) fail('testPhotoIds', 'Каждому кадру нужно отдельное тестовое фото JPEG; сохраните полный набор');
  if (slot.referenceIds.length > variant.additionalReferenceLimit) fail('referenceIds', `Дополнительные фото: не более ${variant.additionalReferenceLimit}`);
  if (slot.model !== recastId && !slot.prompt) fail('prompt', 'Введите промпт');
  if (slot.prompt && slot.prompt.length > model.promptMaxLength) fail('prompt', `Промпт: не более ${model.promptMaxLength} символов`);
  if (model.resolutionOptions.length ? !model.resolutionOptions.includes(slot.resolution ?? '') : slot.resolution !== undefined) fail('resolution', 'Недопустимое разрешение модели');
  if (model.orientationMode === 'source-video') {
    if (slot.aspectRatio !== undefined) fail('aspectRatio', 'Соотношение сторон определяется исходным видео');
  } else if (!model.aspectRatios[slot.orientation].includes(slot.aspectRatio ?? '')) fail('aspectRatio', 'Соотношение сторон не соответствует модели и ориентации');
  if (slot.mode === 'V2V') {
    if (slot.demoId) fail('demoId', 'В V2V показывается исходное видео');
    if (slot.duration !== undefined) fail('duration', 'Длительность V2V определяется исходным видео');
  } else {
    if (slot.videoId) fail('videoId', 'В P2V нет исходного видео');
    if (slot.duration === undefined || slot.duration < timing.minSeconds || slot.duration > timing.maxSeconds || (slot.model !== 'minimax/h3-max/reference-to-video' && !Number.isInteger(slot.duration))) fail('duration', `Длительность: ${timing.minSeconds}–${timing.maxSeconds} с`);
  }
  if (slot.model === recastId && slot.videoId && slot.recastShotsConfirmed !== true) fail('recastShotsConfirmed', 'Подтвердите: непрерывные кадры не длиннее 15 секунд');
  if (slot.model !== recastId && slot.recastShotsConfirmed !== undefined) fail('recastShotsConfirmed', 'Подтверждение относится только к Recast');
  if (slot.model === 'minimax/h3-max/reference-to-video' ? slot.promptExpansionMode !== 'disabled' : slot.promptExpansionMode !== undefined) fail('promptExpansionMode', 'Недопустимый режим расширения промпта');
});
export type ConfiguredSlotInput = z.infer<typeof slotSchema>;
/** Optional setup fields describe raw legacy records; every new save uses slotSchema. */
export type SlotInput = z.infer<typeof legacySlotSchema> & Partial<Pick<ConfiguredSlotInput, 'participants' | 'photosPerParticipant' | 'orientation' | 'aspectRatio' | 'testPhotoIds'>>;
export function hasSlotSetup(slot: SlotInput): slot is ConfiguredSlotInput { return slot.participants !== undefined; }
export function normalizeSlotForEditor<T extends SlotInput>(slot: T, orientation: Orientation = 'landscape'): T & ConfiguredSlotInput {
  return { ...defaultSlotSetup(slot.model, slot.mode, orientation), ...slot } as T & ConfiguredSlotInput;
}
export type Slot = SlotInput & { id: string };
export function isTestVideo(input: { simulateGeneration?: boolean; simulationOutput?: string }) {
  return input.simulateGeneration === true && input.simulationOutput === 'video';
}
/** Admin-only projection of a retained real result. Unknown legacy times stay null. */
export interface LastSlotVideo {
  sessionId: string; videoUrl: string; submittedAt: number | null; readyAt: number | null; elapsedMs: number | null;
}
export interface Media { id: string; kind: 'image' | 'video'; mime: string; size: number; duration?: number; width: number; height: number }
export const titleFrom = (description: string) => description.trim().split(/\s+/u).slice(0, 3).join(' ');
export function blankSlot(mode: Mode = 'V2V'): SlotInput {
  const model = models.find(m => m.mode === mode)!;
  return { ...defaultSlotSetup(model.id, mode), description: '', visible: true, simulateGeneration: false, thumbnailId: '', mode, model: model.id, referenceIds: [], resolution: model.defaultResolution, ...(mode === 'P2V' ? { duration: 10, prompt: '' } : { recastShotsConfirmed: false }) };
}
export function videoProblem(model: Model, media: Media): string | undefined {
  if (media.kind !== 'video') return 'Нужен видеофайл';
  if (!media.duration || media.duration < model.minSeconds || media.duration > model.maxSeconds) return `Исходное видео: ${model.minSeconds}–${model.maxSeconds} с`;
  if (model.maxVideoMB && media.size > model.maxVideoMB * 1_000_000) return `Исходное видео: не более ${model.maxVideoMB} MB`;
}
