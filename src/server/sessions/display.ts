/** Module contract: read-only, operator-only projection of today's sessions and
 * their private media. First email confirmation owns the persisted hide deadline;
 * neither polling, QR rendering nor media requests mark a form opened or delete
 * records. Receive capability is encoded only into the QR; full email and provider
 * data never leave this module. See contracts/access.md and states/lifecycle-map.md. */
import QRCode from 'qrcode';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db.js';
import type { Access } from '../access/index.js';
import { HttpError } from '../errors.js';
import { eventDate } from './index.js';
import { readyCard } from './receive.js';
import { sendMedia } from '../scenarios/media.js';
import { stageLabels, type DisplaySession, type TodayDisplay } from '../../shared/display.js';

interface Row {
  id: string; number: number; state: string; email: string | null;
  email_state: string | null; opened_at: number | null; email_confirmed_at: number | null;
}
const selection = `SELECT s.id,s.number,s.state,d.email,d.email_state,d.opened_at,d.email_confirmed_at
  FROM capture_sessions s LEFT JOIN session_delivery d ON d.session_id=s.id
  WHERE s.event_date=? AND EXISTS (SELECT 1 FROM events e WHERE e.date=s.event_date AND e.deleting=0) AND (d.email_confirmed_at IS NULL OR d.email_confirmed_at+180000>?)`;
// Match the PRD's local-prefix***@***.suffix presentation, bounding long names.
export function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  const suffix = domain?.includes('.') ? `.${domain.split('.').at(-1)}` : '';
  return `${name.slice(0, 8)}***@***${suffix}`;
}
function projection(row: Row): DisplaySession {
  const stage = row.state === 'ready' ? (row.email_state === 'sent' ? 6 : row.opened_at !== null ? 5 : 4)
    : ({ submit_pending: 1, observing: 2, preparing: 3 }[row.state] ?? 0);
  return { id: row.id, number: row.number, stage,
    label: stage === 6 ? `Видео отправлено на ${maskEmail(row.email ?? '')}` : row.state === 'failed' ? 'Генерация не завершена' : stageLabels[stage as 0 | 1 | 2 | 3 | 4 | 5],
    error: row.state === 'failed' ? 'Не удалось создать видео. Обратитесь к сотруднику.'
      : row.email_state === 'failed' ? 'Письмо не подтверждено. Откройте форму и повторите отправку.' : null,
    hideAt: row.email_confirmed_at === null ? null : row.email_confirmed_at + 180_000,
    card: row.state === 'ready' ? { photoUrl: `/api/display/${row.id}/photo`, frameUrl: `/api/display/${row.id}/frame`, qrUrl: `/api/display/${row.id}/qr` } : null };
}
export function registerDisplay(app: FastifyInstance, db: DB, dataDir: string, origin: string, access: Access, now: () => number) {
  async function operator(request: FastifyRequest, reply: FastifyReply) {
    if (access.context(request, reply) !== 'operator') throw new HttpError(403, 'FORBIDDEN', 'Нужны права оператора');
  }
  app.get('/api/display/today', { preHandler: operator }, (): TodayDisplay => {
    const time = now(); const date = eventDate(time);
    const rows = db.prepare(`${selection} ORDER BY s.number,s.id`).all(date, time) as Row[];
    return { date, serverNow: time, sessions: rows.map(projection) };
  });
  for (const kind of ['photo', 'frame', 'qr'] as const) {
    app.get<{ Params: { id: string } }>(`/api/display/:id/${kind}`, { preHandler: operator }, async (request, reply) => {
      const time = now();
      const row = db.prepare(`${selection} AND s.id=? AND s.state='ready'`).get(eventDate(time), time, request.params.id) as Row | undefined;
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Результат недоступен на общем экране');
      if (kind === 'qr') {
        const card = readyCard(db, origin, row.id);
        if (!card) throw new HttpError(404, 'NOT_FOUND', 'Результат недоступен');
        return reply.type('image/png').send(await QRCode.toBuffer(card.receiveUrl, { errorCorrectionLevel: 'M', margin: 4, scale: 6 }));
      }
      const file = (kind === 'photo' ? db.prepare('SELECT path,size,width,height FROM capture_photos WHERE session_id=? AND pose_index=0')
        : db.prepare('SELECT frame_path AS path,frame_size AS size,width,height FROM generation_jobs WHERE session_id=?')).get(row.id) as { path: string; size: number; width: number; height: number } | undefined;
      if (!file) throw new HttpError(404, 'NOT_FOUND', 'Изображение недоступно');
      return sendMedia(dataDir, { ...file, id: row.id, kind: 'image', mime: 'image/jpeg' }, request, reply);
    });
  }
}
