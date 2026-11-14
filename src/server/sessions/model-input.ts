/** Module contract: map the saved scenario and ordered photo URLs to one of the
 * eleven accepted fal inputs. Kling views describe one person; other P2V lists
 * put that person's four views before slot references. Demo/thumbnail never
 * enter a payload. No network, storage, endpoint substitution or prompt rewriting. */
import type { SlotSnapshot } from '../../shared/capture.js';
import { recastId, slotSchema } from '../../shared/scenarios.js';

export interface GenerationMedia { photos: string[]; video?: string; references: string[] }
export function buildModelInput(snapshot: SlotSnapshot, media: GenerationMedia): Record<string, unknown> {
  const input = slotSchema.parse({ ...snapshot.generation, description: snapshot.description,
    thumbnailId: snapshot.thumbnailId, demoId: snapshot.demoId, visible: true });
  const expected = input.model === recastId ? 1 : 4;
  if (snapshot.expectedPhotos !== expected || media.photos.length !== expected ||
      media.references.length !== input.referenceIds.length || (input.mode === 'V2V' && !media.video)) {
    throw new Error('Invalid generation media');
  }
  if (input.model === recastId) return { video_url: media.video, reference_image_urls: media.photos, resolution: input.resolution };
  const prompt = input.prompt!;
  const elements = [{ frontal_image_url: media.photos[0], reference_image_urls: media.photos.slice(1) }];
  const kling = { prompt, elements, image_urls: media.references };
  const referenceImages = [...media.photos, ...media.references];
  switch (input.model) {
    case 'fal-ai/kling-video/o1/video-to-video/edit':
    case 'fal-ai/kling-video/o3/pro/video-to-video/edit':
      return { ...kling, video_url: media.video };
    case 'kling/v4/video-to-video/edit':
    case 'kling/v4/flash/video-to-video':
      return { ...kling, video_url: media.video, resolution: input.resolution };
    case 'fal-ai/kling-video/o3/pro/reference-to-video':
      return { ...kling, duration: String(input.duration) };
    case 'kling/v4/reference-to-video':
    case 'kling/v4/flash/reference-to-video':
      return { ...kling, duration: input.duration, resolution: input.resolution };
    case 'minimax/h3-max/reference-to-video':
      return { prompt, reference_image_urls: referenceImages, duration: input.duration,
        resolution: input.resolution, prompt_expansion_mode: input.promptExpansionMode };
    case 'fal-ai/vidu/q4/reference-to-video':
      return { prompt, reference_image_urls: referenceImages, duration: input.duration, resolution: input.resolution };
    case 'google/gemini-omni-flash/v1.2/reference-to-video':
      return { prompt, image_urls: referenceImages, duration: input.duration, resolution: input.resolution };
    default: throw new Error('Unsupported generation model');
  }
}
