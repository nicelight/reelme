/** Module contract: map a saved scenario and ordered photo URLs to its fal input.
 * New plans keep individual Elements separate from ordinary group/reference images;
 * legacy snapshots retain their original one-person 1/4-photo contract. No network,
 * storage, endpoint substitution or prompt rewriting. A saved plan is never rebuilt
 * from the current capability matrix. Source: docs/slot-setup/matrix.md.
 */
import { snapshotPosePlan, type SlotSnapshot } from '../../shared/capture.js';
import { legacySlotSchema, recastId, wanEditId, slotSchema, retiredKlingEditIds, savedKlingEditSchema } from '../../shared/scenarios.js';

export interface GenerationMedia { photos: string[]; video?: string; videoDuration?: number; references: string[] }
export function buildModelInput(snapshot: SlotSnapshot, media: GenerationMedia): Record<string, unknown> {
  const value = { ...snapshot.generation, description: snapshot.description,
    thumbnailId: snapshot.thumbnailId, demoId: snapshot.demoId, visible: true };
  const schema = retiredKlingEditIds.includes(value.model) ? savedKlingEditSchema : slotSchema;
  const configured = snapshot.posePlan === undefined ? undefined : schema.parse(value);
  const input = configured ?? legacySlotSchema.parse(value);
  const plan = snapshotPosePlan(snapshot);
  const expected = configured
    ? (configured.participants === 2 ? 2 : 1) * configured.photosPerParticipant
    : input.model === recastId ? 1 : 4;
  if (snapshot.expectedPhotos !== expected || plan.length !== expected || media.photos.length !== expected ||
      media.references.length !== input.referenceIds.length || (input.mode === 'V2V' && !media.video)) {
    throw new Error('Invalid generation media');
  }
  if (configured && plan.some((pose, index) =>
    pose.participant !== (configured.participants === 'group' ? 'group' : Math.floor(index / configured.photosPerParticipant) + 1) ||
    pose.guideNumber !== (configured.participants === 'group' ? 5 : index % configured.photosPerParticipant + 1))) {
    throw new Error('Invalid saved participant/pose order');
  }
  if (input.model === recastId) return { video_url: media.video, reference_image_urls: media.photos,
    resolution: input.resolution, ...(configured?.prompt ? { prompt: configured.prompt } : {}) };
  const prompt = input.prompt!;
  if (input.model === wanEditId) {
    const seconds = media.videoDuration;
    if (seconds === undefined || !Number.isFinite(seconds) || seconds < 1 || seconds > 15) throw new Error('Invalid Wan source duration');
    return { prompt, reference_video_urls: [media.video], reference_image_urls: [...media.photos, ...media.references],
      resolution: input.resolution, aspect_ratio: 'adaptive', duration: Math.max(2, Math.round(seconds)), enable_prompt_expansion: false };
  }
  const group = configured?.participants === 'group';
  const perPerson = configured?.photosPerParticipant ?? 4;
  const elements = Array.from({ length: configured?.participants === 2 ? 2 : 1 }, (_, person) => ({
    frontal_image_url: media.photos[person * perPerson],
    reference_image_urls: media.photos.slice(person * perPerson + 1, (person + 1) * perPerson),
  }));
  const kling = group ? { prompt, image_urls: [...media.photos, ...media.references] }
    : { prompt, elements, image_urls: media.references };
  const referenceImages = [...media.photos, ...media.references];
  const editDuration = input.duration === undefined ? {} : { duration: input.duration };
  const aspect = configured?.aspectRatio ? { aspect_ratio: configured.aspectRatio } : {};
  switch (input.model) {
    case 'fal-ai/kling-video/o1/video-to-video/edit':
    case 'fal-ai/kling-video/o3/pro/video-to-video/edit':
    case 'fal-ai/kling-video/o3/standard/video-to-video/edit':
      return { ...kling, video_url: media.video };
    case 'kling/v4/video-to-video/edit':
      return { ...kling, video_url: media.video, resolution: input.resolution, ...editDuration, ...aspect };
    case 'kling/v4/flash/video-to-video':
      return { ...kling, video_url: media.video, resolution: input.resolution, ...editDuration };
    case 'fal-ai/kling-video/o3/pro/reference-to-video':
      return { ...kling, duration: String(input.duration), ...aspect };
    case 'kling/v4/reference-to-video':
    case 'kling/v4/flash/reference-to-video':
      return { ...kling, duration: input.duration, resolution: input.resolution, ...aspect };
    case 'minimax/h3-max/reference-to-video':
      return { prompt, reference_image_urls: referenceImages, duration: input.duration,
        resolution: input.resolution, prompt_expansion_mode: input.promptExpansionMode, ...aspect };
    case 'fal-ai/vidu/q4/reference-to-video':
      return { prompt, reference_image_urls: referenceImages, duration: input.duration, resolution: input.resolution, ...aspect };
    case 'google/gemini-omni-flash/v1.2/reference-to-video':
      return { prompt, image_urls: referenceImages, duration: input.duration, resolution: input.resolution, ...aspect };
    default: throw new Error('Unsupported generation model');
  }
}
