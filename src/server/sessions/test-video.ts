/** Module contract: offline replacement of the generation transport for a session
 * explicitly snapshotted as test-video. IDs/queue age survive process restarts;
 * only the two bundled MP4s may be read. No fetch, fal calls or remote deletion.
 * The ordinary worker still prepares, validates and publishes the local result. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FalTransport } from './fal.js';

export function testVideoTransport(sessionId: string, directory: string, portrait: boolean, submittedAt: number | null, now: () => number) {
  const requestId = `test-video:${sessionId}`;
  const resultUrl = `https://test-video.invalid/${sessionId}.mp4`;
  function requireOwnRequest(id: string) {
    if (id !== requestId) throw new Error('Test video request does not belong to this session');
  }
  const client: FalTransport = {
    async submit() { return { request_id: requestId, status_url: resultUrl, response_url: resultUrl }; },
    async status(_endpoint, id) {
      requireOwnRequest(id);
      if (submittedAt === null) throw new Error('Test video submission time is missing');
      return { status: now() - submittedAt >= 3000 ? 'COMPLETED' : 'IN_PROGRESS' };
    },
    async result(_endpoint, id) { requireOwnRequest(id); return { video: { url: resultUrl } }; },
  };
  const download: typeof fetch = async url => {
    if (String(url) !== resultUrl) throw new Error('Unexpected test video URL');
    return new Response(await readFile(join(directory, portrait ? 'portrait.mp4' : 'landscape.mp4')), { headers: { 'content-type': 'video/mp4' } });
  };
  return { client, download };
}
