/** Module contract: streams a provider result into private session storage, then
 * validates a complete video decode and extracts a JPEG. Publishes metadata only
 * after both files succeed; failures remove partial outputs. No SQL or submit.
 * FFmpeg can read only the local MP4/MOV container, never referenced network URLs. */
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
export class InvalidVideo extends Error {}
export interface PreparedVideo { video_path: string; frame_path: string; video_size: number; frame_size: number; width: number; height: number; duration: number }
export async function prepareVideo(dataDir: string, sessionId: string, resultUrl: string, transport: typeof fetch = fetch): Promise<PreparedVideo> {
  const relative = `sessions/${sessionId}/result.mp4`;
  const frameRelative = `sessions/${sessionId}/result.jpg`;
  const video = join(dataDir, 'media', relative); const frame = join(dataDir, 'media', frameRelative);
  await mkdir(join(dataDir, 'media', 'sessions', sessionId), { recursive: true, mode: 0o700 });
  try {
    const response = await transport(resultUrl, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error(`Download HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(video, { mode: 0o600 }));
    const size = (await stat(video)).size;
    if (!size) throw new InvalidVideo('Empty result');
    try {
      const input = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov'];
      const { stdout } = await run('ffprobe', ['-v', 'error', ...input, '-show_streams', '-show_format', '-of', 'json', video], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
      const probe = JSON.parse(stdout);
      const stream = probe.streams.find((s: { codec_type: string; disposition?: { attached_pic: number } }) => s.codec_type === 'video' && !s.disposition?.attached_pic);
      const duration = Number(probe.format.duration);
      if (!stream?.width || !stream.height || !Number.isFinite(duration) || duration <= 0) throw new Error('Missing video track');
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-xerror', ...input, '-i', video, '-map', '0:v:0', '-f', 'null', '-'], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...input, '-i', video, '-frames:v', '1', '-q:v', '3', '-y', frame], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
      const frameSize = (await stat(frame)).size;
      if (!frameSize) throw new Error('Empty frame');
      return { video_path: relative, frame_path: frameRelative, video_size: size, frame_size: frameSize, width: stream.width, height: stream.height, duration };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error; // Missing tool is retryable after installation.
      throw new InvalidVideo('Unplayable result', { cause: error });
    }
  } catch (error) {
    await Promise.all([rm(video, { force: true }), rm(frame, { force: true })]);
    throw error;
  }
}
