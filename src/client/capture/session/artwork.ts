import type { StartReceipt } from '../../../shared/capture';
import { ApiError, request } from '../api';

export function guideImagePath(mediaId: string) {
  return `/api/capture/guides/${encodeURIComponent(mediaId)}`;
}

// A hidden story or reassigned guide can still belong to a running session.
export async function requestArtwork(path: string, sessionPath: string | undefined, key: string, options: RequestInit) {
  try {
    return await request(path, key, options);
  } catch (error) {
    if (!sessionPath || !(error instanceof ApiError) || error.status !== 404) throw error;
    return request(sessionPath, key, options);
  }
}

export function sessionGuidePath(sessionId: string, number: number) {
  return `/api/capture/sessions/${encodeURIComponent(sessionId)}/guides/${number}`;
}

export async function warmPoseGuides(receipt: StartReceipt, key: string, signal: AbortSignal) {
  const seen = new Set([receipt.posePlan[0]?.guideMediaId]);
  for (const { guideMediaId, guideNumber } of receipt.posePlan) {
    if (signal.aborted) return;
    if (!guideNumber || !guideMediaId || seen.has(guideMediaId)) continue;
    seen.add(guideMediaId);
    try {
      const response = await requestArtwork(guideImagePath(guideMediaId), sessionGuidePath(receipt.sessionId, guideNumber), key, {
        cache: 'force-cache', priority: 'low', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
      await response.blob();
    } catch { /* The visible guide retries normally if background loading failed. */ }
  }
}
