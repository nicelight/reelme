/** Admin/operator projection of today's visible sessions and private media.
 * Serves the QR saved before ready; older results without a file render it on demand.
 * Polling/media reads never confirm email or open a receive form. Authenticated
 * card-load failures produce one warning per request, without changing session state.
 * The player caption uses the same access window as its video and reads generation
 * parameters from that session's snapshot.
 * Manual hiding belongs to the display alone and survives reloads on every screen. */
import { createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { generationMessages } from './generation-errors.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db.js';
import type { Access } from '../access/index.js';
import { HttpError } from '../errors.js';
import { eventKey } from '../../shared/events.js';
import type { SlotSnapshot } from '../../shared/capture.js';
import { eventDate } from './index.js';
import { makeDisplayCover } from './jpeg.js';
import { readyCard } from './receive.js';
import { matchesPrivateCache, sendMedia } from '../scenarios/media.js';
import { pageDurationOptions, stageLabels, type DisplaySettings, type DisplaySession, type TodayDisplay, type ResultVideoDetails } from '../../shared/display.js';
import { isBillableRequest, type CostReader } from './fal-costs.js';
import { isTestVideo } from '../../shared/scenarios.js';

interface Row {
  id: string; number: number; state: string; snapshot: string; error_code: string | null; email: string | null;
  email_state: string | null; opened_at: number | null; email_confirmed_at: number | null; ready_at: number | null;
}
const currentEvent = 's.event_date=? AND EXISTS (SELECT 1 FROM events e WHERE e.date=s.event_date AND e.event_no=s.event_no AND e.deleting=0 AND e.closed_at IS NULL)';
const selection = `SELECT s.id,s.number,s.state,s.snapshot,g.error_code,g.ready_at,d.email,d.email_state,d.opened_at,d.email_confirmed_at
  FROM capture_sessions s LEFT JOIN session_delivery d ON d.session_id=s.id LEFT JOIN generation_jobs g ON g.session_id=s.id
  WHERE ${currentEvent} AND s.display_hidden=0 AND (d.email_confirmed_at IS NULL OR d.email_confirmed_at+180000>?)`;
// Match the PRD's local-prefix***@***.suffix presentation, bounding long names.
export function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  const suffix = domain?.includes('.') ? `.${domain.split('.').at(-1)}` : '';
  return `${name.slice(0, 8)}***@***${suffix}`;
}
function projection(row: Row): DisplaySession {
  const stage = row.state === 'ready' ? (row.email_state === 'sent' ? 6 : row.opened_at !== null ? 5 : 4)
    : ({ submit_pending: 1, observing: 2, preparing: 3 }[row.state] ?? 0);
  const failure = row.error_code === 'TEST_PREPARATION_FAILED' ? 'Не удалось подготовить тестовую фотографию. Сохраните JPEG и запустите новый тест.'
    : row.error_code === 'INPUT_PREPARATION_FAILED' || row.error_code === 'TEMPLATE_UPLOAD_FAILED' || row.error_code === 'FAL_NOT_CONFIGURED' || row.error_code === 'RESULT_GONE'
      ? generationMessages[row.error_code] : generationMessages.FAL_FAILED;
  const generation = JSON.parse(row.snapshot).generation ?? {};
  const testVideo = isTestVideo(generation);
  const simulation: DisplaySession['simulation'] = generation.simulateGeneration === true && row.state !== 'capturing' && row.state !== 'cancelled'
    ? { status: row.state === 'simulated' || row.state === 'ready' ? 'passed' : row.state === 'failed' ? 'failed' : 'pending',
      message: testVideo ? row.state === 'ready' ? 'Тестовое видео готово' : row.state === 'failed' ? 'Тестовое видео не подготовлено' : 'Подготовка тестового видео'
        : row.state === 'simulated' ? 'Проверка входных данных пройдена' : row.state === 'failed' ? 'Проверка входных данных не пройдена' : 'Проверка входных данных',
      detail: row.state === 'failed' ? failure : 'Тестовый режим: fal не вызывался' } : null;
  return { id: row.id, number: row.number, stage, simulation, readyAt: row.state === 'ready' ? row.ready_at : null,
    label: row.state === 'cancelled' ? 'отменено оператором' : stage === 6 ? `Видео отправлено на ${maskEmail(row.email ?? '')}` : row.state === 'failed' ? 'Генерация не завершена'
      : testVideo && (stage === 1 || stage === 2) ? 'Подготовка тестового видео' : stageLabels[stage as 0 | 1 | 2 | 3 | 4 | 5],
    error: row.state === 'failed' ? failure
      : row.email_state === 'failed' ? 'Письмо не подтверждено. Откройте форму и повторите отправку.' : null,
    hideAt: row.email_confirmed_at === null ? null : row.email_confirmed_at + 180_000,
    card: row.state === 'ready' ? { photoUrl: `/api/display/${row.id}/photo`, frameUrl: `/api/display/${row.id}/cover`, qrUrl: `/api/display/${row.id}/qr`, videoUrl: `/api/display/${row.id}/video` } : null };
}
export function registerDisplay(app: FastifyInstance, db: DB, dataDir: string, origin: string, access: Access, now: () => number, costs: CostReader) {
  const settings = () => db.prepare('SELECT page_duration_seconds AS pageDurationSeconds FROM display_settings WHERE id=1').get() as DisplaySettings;
  const settingsSchema = z.object({ pageDurationSeconds: z.union(pageDurationOptions.map(value => z.literal(value))) }).strict();
  app.get('/api/admin/display-settings', { preHandler: access.requireAdmin }, settings);
  app.put('/api/admin/display-settings', { preHandler: [access.requireOrigin, access.requireAdmin] }, request => {
    const value = settingsSchema.parse(request.body);
    db.prepare('UPDATE display_settings SET page_duration_seconds=? WHERE id=1').run(value.pageDurationSeconds);
    return settings();
  });
  async function account(request: FastifyRequest, reply: FastifyReply) {
    const role = access.context(request, reply);
    if (role !== 'operator' && role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Нужен аккаунт оператора или администратора');
  }
  app.get('/api/display/today', { preHandler: account }, (): TodayDisplay => {
    const time = now(); const date = eventDate(time);
    const rows = db.prepare(`${selection} ORDER BY s.number,s.id`).all(date, time) as Row[];
    const hidden = db.prepare(`SELECT s.id FROM capture_sessions s WHERE ${currentEvent} AND s.display_hidden=1`).all(date) as { id: string }[];
    const current = db.prepare('SELECT event_no FROM events WHERE date=? AND closed_at IS NULL AND deleting=0').get(date) as {event_no: number} | undefined;
    return { date, eventKey: current ? eventKey(date,current.event_no) : null, serverNow: time, ...settings(), sessions: rows.map(projection), hiddenIds: hidden.map(row => row.id) };
  });
  app.post<{ Params: { id: string } }>('/api/display/:id/hide', { preHandler: [access.requireOrigin, account] }, (request, reply) => {
    const result = db.prepare(`UPDATE capture_sessions AS s SET display_hidden=1 WHERE ${currentEvent} AND s.id=? AND s.state='ready'`)
      .run(eventDate(now()), request.params.id);
    if (!result.changes) throw new HttpError(404, 'NOT_FOUND', 'Результат недоступен на общем экране');
    return reply.code(204).send();
  });
  const availableVideo = `FROM capture_sessions s JOIN generation_jobs g ON g.session_id=s.id
      WHERE ${currentEvent} AND s.id=? AND s.state='ready' AND s.display_hidden=0 AND g.video_path IS NOT NULL`;
  app.get<{ Params: { id: string } }>('/api/display/:id/video-details', { preHandler: account }, (request): ResultVideoDetails => {
    const id = request.params.id;
    const row = db.prepare(`SELECT s.number, s.snapshot, g.request_id, g.cost_usd, COALESCE(g.submitted_at,s.created_at) AS submittedAt
      ${availableVideo}`).get(eventDate(now()), id) as {
      number: number; snapshot: string; request_id: string | null; cost_usd: number | null; submittedAt: number;
    } | undefined;
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Результат недоступен на общем экране');
    const generation: Partial<SlotSnapshot['generation']> = JSON.parse(row.snapshot).generation ?? {};
    const billable = isBillableRequest(row.request_id, generation.simulateGeneration);
    if (billable && row.cost_usd === null) costs.refresh([{ id, requestId: row.request_id!, submittedAt: row.submittedAt }]);
    return { number: row.number, model: generation.model ?? null, testVideo: isTestVideo(generation),
      costUsd: billable ? row.cost_usd : undefined,
      prompt: generation.simulateGeneration ? null : (generation.prompt?.trim() || null) };
  });
  app.get<{ Params: { id: string } }>('/api/display/:id/video', { preHandler: account }, (request, reply) => {
    // A card already on the active page is still actionable after its email deadline.
    const file = db.prepare(`SELECT g.video_path AS path,g.video_size AS size,g.width,g.height
      ${availableVideo}`)
      .get(eventDate(now()), request.params.id) as { path: string; size: number; width: number; height: number } | undefined;
    if (!file) throw new HttpError(404, 'NOT_FOUND', 'Результат недоступен на общем экране');
    return sendMedia(dataDir, { ...file, id: request.params.id, kind: 'video', mime: 'video/mp4' }, request, reply, 'inline', 'Cookie');
  });
  const loadFailure = z.object({ attempts: z.literal(4), reason: z.enum(['timeout', 'image']) }).strict();
  app.post<{ Params: { id: string } }>('/api/display/:id/load-failure', { preHandler: [access.requireOrigin, account] }, (request, reply) => {
    const failure = loadFailure.parse(request.body);
    const time = now();
    const row = db.prepare(`${selection} AND s.id=? AND s.state='ready'`).get(eventDate(time), time, request.params.id) as Row | undefined;
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Результат недоступен на общем экране');
    app.log.warn({ code: 'DISPLAY_CARD_DEPRECATED', sessionId: row.id, number: row.number, ...failure }, 'Карточка не загрузилась на экране результатов');
    return reply.code(204).send();
  });
  for (const kind of ['photo', 'cover', 'frame', 'qr'] as const) {
    app.get<{ Params: { id: string } }>(`/api/display/:id/${kind}`, { preHandler: account }, async (request, reply) => {
      const time = now();
      const row = db.prepare(`${selection} AND s.id=? AND s.state='ready'`).get(eventDate(time), time, request.params.id) as Row | undefined;
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Результат недоступен на общем экране');
      if (kind === 'cover') {
        // A ready session's first pose is immutable. Revalidate only after checking display access.
        if (matchesPrivateCache(request, reply, `"${row.id}-cover-v1"`, 'Cookie')) return reply.code(304).send();
        let cover: Buffer;
        try { cover = await readFile(join(dataDir, 'media', 'sessions', row.id, 'cover.jpg')); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          const photo = db.prepare('SELECT path FROM capture_photos WHERE session_id=? AND pose_index=0').get(row.id) as { path: string } | undefined;
          if (!photo) throw new HttpError(404, 'NOT_FOUND', 'Первый снимок недоступен');
          cover = await makeDisplayCover(join(dataDir, 'media', photo.path));
        }
        return reply.type('image/jpeg').send(cover);
      }
      if (kind === 'qr') {
        let png: Buffer;
        try { png = await readFile(join(dataDir, 'media', 'sessions', row.id, 'qr.png')); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          // Older ready sessions predate stored QR files.
          const card = readyCard(db, origin, row.id);
          if (!card) throw new HttpError(404, 'NOT_FOUND', 'Результат недоступен');
          png = await QRCode.toBuffer(card.receiveUrl, { errorCorrectionLevel: 'M', margin: 4, scale: 6 });
        }
        const etag = `"${createHash('sha256').update(png).digest('base64url')}"`;
        if (matchesPrivateCache(request, reply, etag, 'Cookie')) return reply.code(304).send();
        return reply.type('image/png').send(png);
      }
      const file = (kind === 'photo' ? db.prepare('SELECT path,size,width,height FROM capture_photos WHERE session_id=? AND pose_index=0')
        : db.prepare('SELECT frame_path AS path,frame_size AS size,width,height FROM generation_jobs WHERE session_id=?')).get(row.id) as { path: string; size: number; width: number; height: number } | undefined;
      if (!file) throw new HttpError(404, 'NOT_FOUND', 'Изображение недоступно');
      return sendMedia(dataDir, { ...file, id: row.id, kind: 'image', mime: 'image/jpeg' }, request, reply, 'inline', 'Cookie');
    });
  }
}
