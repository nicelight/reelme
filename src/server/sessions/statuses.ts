import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Access } from '../access/index.js';
import type { DB } from '../db.js';
import { HttpError } from '../errors.js';
import { createBalanceReader } from './fal-balance.js';
import { eventDate } from './index.js';
import { isTestVideo } from '../../shared/scenarios.js';
import type { HistoryEntry, SessionHistory, SessionStatus, StatusPage } from '../../shared/statuses.js';

interface EntryRow {
  id: number; at: number; last_at: number; source: string; step: string; event: string;
  outcome: string; detail: string; repeats: number;
}
interface Row {
  id: string; event_date: string; number: number; state: string; created_at: number; snapshot: string;
  request_id: string | null; submitted_at: number | null; ready_at: number | null; error_code: string | null;
  opened_at: number | null; sent_at: number | null; email_state: string | null; email_error: string | null;
  photos: number;
}

const steps: Record<string, string> = {
  'capture.start': 'Присвоение номера', 'capture.photo': 'Приём фотографии', 'capture.finalize': 'Завершение приёма фото',
  'generation.inputs': 'Подготовка входов модели', 'template.cdn': 'Материалы в fal CDN',
  'fal.submit': 'Отправка задания в fal', 'fal.status': 'Опрос fal', 'fal.result': 'Получение результата fal',
  'video.download': 'Загрузка MP4', 'video.probe': 'Проверка видео', 'video.frame': 'Извлечение кадра',
  'delivery.publish': 'Подготовка QR и публикация', 'delivery.open': 'Открытие формы получения',
  'delivery.share': 'Поделиться', 'delivery.email': 'Запрос письма', 'delivery.download': 'Передача видео',
  'smtp.send': 'Отправка письма',
};
const outcomes: Record<string, string> = {
  started: 'начато', succeeded: 'выполнено', waiting: 'ожидание', failed: 'ошибка',
  retry: 'ожидается повтор', unknown: 'исход неизвестен', cancelled: 'отменено',
};
const failures: Record<string, string> = {
  TEST_PREPARATION_FAILED: 'Подготовка тестового фото', INPUT_PREPARATION_FAILED: 'Подготовка входов',
  FAL_NOT_CONFIGURED: 'fal не настроен', TEMPLATE_UPLOAD_FAILED: 'Загрузка материалов в fal CDN',
  FAL_REJECTED: 'fal отклонил задание', FAL_FAILED: 'Ошибка задания fal', RESULT_GONE: 'Результат fal недоступен',
  INVALID_RESULT: 'Проверка результата',
};
const join = `FROM capture_sessions s JOIN events e ON e.date=s.event_date AND e.deleting=0
  LEFT JOIN generation_jobs g ON g.session_id=s.id LEFT JOIN session_delivery d ON d.session_id=s.id`;
const selection = `SELECT s.id,s.event_date,s.number,s.state,s.created_at,s.snapshot,
  g.request_id,g.submitted_at,g.ready_at,g.error_code,d.opened_at,d.sent_at,d.email_state,d.email_error,
  (SELECT COUNT(*) FROM capture_photos WHERE session_id=s.id) photos ${join}`;
// Only an outstanding capture rejection belongs to the current capture phase.
const captureIssue = `(s.state='capturing' AND (SELECT h.outcome FROM session_history h
  WHERE h.session_id=s.id AND h.source='capture' ORDER BY h.id DESC LIMIT 1)='failed')`;
const businessIssue = `(s.state='failed' OR (s.state IN ('submit_pending','observing','preparing') AND g.error_code IS NOT NULL) OR d.email_state='failed')`;
const iso = (time: number | null) => time === null ? null : new Date(time).toISOString();

const eventLabels: Record<string, string> = {
  number_assigned: 'Присвоен номер посетителя', queued: 'Передано в очередь', prepared: 'Входные данные проверены',
  available: 'Материалы доступны в fal CDN', repair: 'Повторная подготовка материалов CDN',
  submit_started: 'Начата отправка задания', acknowledged: 'Получен идентификатор задания',
  ack_not_saved: 'fal принял задание, не удалось сохранить подтверждение',
  ack_missing: 'Отправка в fal · подтверждение не получено', retrieving: 'Запрашиваем результат модели',
  result_received: 'Ответ модели получен', validating: 'Проверяем файлы для выдачи', creating_qr: 'Создаём QR',
  ready: 'Видео и QR готовы', opened: 'Открыта форма получения',
  download_clicked: 'Посетитель нажал «Скачать»', share_started: 'Открываем меню «Поделиться»',
  share_cancelled: 'Посетитель отменил отправку', share_failed: 'Браузер сообщил об ошибке отправки',
  share_returned: 'Браузер завершил «Поделиться»', attachment_refused: 'Вложение отклонено, пробуем отправить ссылку',
  interrupted: 'Отправка письма прервана, исход неизвестен', history_truncated: 'Часть повторных событий пропущена',
};
const transfers: Record<string, string> = {
  share_preload: 'Подготовка файла для «Поделиться»', attachment: 'Выдача файла',
  player: 'Загрузка для плеера', head: 'Проверка заголовков файла',
};
const transferEvents: Record<string, string> = {
  response_finished: 'сервер завершил передачу', range_served: 'передан диапазон байтов',
  headers_served: 'переданы заголовки', transfer_aborted: 'соединение прервано', transfer_error: 'ошибка передачи',
};

function describe(entry: EntryRow, detail: HistoryEntry['detail']) {
  const prefix = steps[entry.step] ?? entry.step;
  if (detail.mode === 'test_video' && entry.step.startsWith('fal.')) return `Тестовое видео · ${outcomes[entry.outcome]}`;
  if (entry.step === 'fal.status' && detail.providerStatus === 'IN_QUEUE') return 'fal принял задание, в очереди';
  if (entry.step === 'fal.status' && detail.providerStatus === 'IN_PROGRESS') return 'fal выполняет задание';
  if (entry.step === 'delivery.download' && transferEvents[entry.event]) {
    return `${transfers[detail.method] ?? prefix} · ${transferEvents[entry.event]}`;
  }
  if (entry.step === 'smtp.send') {
    const method = detail.method === 'link' ? 'ссылка' : 'вложение';
    if (entry.event === 'accepted') return `Письмо принято SMTP · ${method}`;
    if (entry.event === 'sending') return `Отправляем письмо · ${method}`;
  }
  if (entry.step === 'delivery.email' && entry.event === 'queued') return 'Запрос на письмо принят';
  if (entry.step === 'capture.photo' && entry.event === 'replaced') return `Фото № ${Number(detail.pose) + 1} заменено`;
  if (eventLabels[entry.event]) {
    const label = eventLabels[entry.event];
    return entry.outcome === 'failed' && entry.event !== 'share_failed' ? label + ' · ошибка' : label;
  }
  if (entry.step === 'capture.photo' && typeof detail.pose === 'number') return `Фото № ${detail.pose + 1} · ${outcomes[entry.outcome]}`;
  return `${prefix} · ${outcomes[entry.outcome] ?? entry.outcome}`;
}

function entryView(entry: EntryRow): HistoryEntry {
  const detail = JSON.parse(entry.detail) as HistoryEntry['detail'];
  return { id: entry.id, at: iso(entry.at)!, lastAt: iso(entry.last_at)!, source: entry.source, step: entry.step,
    event: entry.event, outcome: entry.outcome, detail, repeats: entry.repeats, label: describe(entry, detail) };
}

function status(row: Row, latest?: EntryRow): SessionStatus {
  const snapshot = JSON.parse(row.snapshot);
  const inputs = snapshot.generation ?? {};
  const mode = isTestVideo(inputs) ? 'Тестовое видео' : inputs.simulateGeneration ? 'Эмуляция' :
    snapshot.testPhotoId || snapshot.testPhotoIds ? 'Ручной тест' : '';
  const ready = row.state === 'ready';
  const stage = ready ? row.email_state === 'sent' ? 6 : row.opened_at !== null ? 5 : 4 :
    ({ submit_pending: 1, observing: 2, preparing: 3, simulated: 4 }[row.state] ?? 0);
  const issue: SessionStatus['issue'] = row.state === 'failed' || row.email_state === 'failed' || (row.state === 'capturing' && latest?.outcome === 'failed') ? 'error' :
    stage >= 1 && stage <= 3 && row.error_code ? 'retry' : null;
  const last = latest && entryView(latest);
  const detailFits = latest && ({
    submit_pending: ['generation.inputs','template.cdn','fal.submit'], observing: ['fal.status','fal.result'],
    preparing: ['video.download','video.probe','video.frame','delivery.publish'],
  }[row.state]?.includes(latest.step));
  let label = ['Приём фото', 'Ожидает отправки', 'fal принял задание', 'Подготовка видео', 'Видео готово', 'Открыта форма получения', 'Письмо принято SMTP'][stage];
  if (stage === 2 && isTestVideo(inputs)) label = 'Подготовка тестового видео';
  if (row.state === 'capturing') label = `Принято ${row.photos} из ${snapshot.expectedPhotos ?? '?'} фото`;
  if (row.state === 'capturing' && issue && last) label = last.label;
  if (detailFits && last) label = last.label;
  if (row.state === 'failed') label = last && last.detail.code === row.error_code && ['failed','unknown'].includes(last.outcome) ? last.label : failures[row.error_code ?? ''] ?? 'Обработка остановлена';
  if (row.state === 'simulated') label = 'Проверка входных данных завершена';
  if (ready && row.email_state === 'failed') label = row.email_error === 'EMAIL_UNCERTAIN' ? 'Видео готово · исход отправки письма неизвестен' : 'Видео готово · ошибка отправки письма';
  if (ready && row.email_state === 'pending') label = 'Видео готово · письмо в очереди';
  if (ready && row.email_state === 'sending') label = 'Видео готово · отправляем письмо';
  if (ready && ['delivery.download','delivery.share'].includes(last?.step ?? '') && row.email_state === 'not_requested') label = 'Видео готово · ' + last!.label;
  return { id: row.id, date: row.event_date, number: row.number, state: row.state, mode, stage, issue, label,
    updatedAt: Math.max(row.created_at, latest?.last_at ?? 0, row.ready_at ?? 0, row.opened_at ?? 0, row.sent_at ?? 0, row.submitted_at ?? 0) };
}

export function registerStatuses(app: FastifyInstance, db: DB, access: Access, now: () => number, billingKey?: string) {
  async function account(request: FastifyRequest, reply: FastifyReply) {
    const role = access.context(request, reply);
    if (role !== 'admin' && role !== 'operator') throw new HttpError(403, 'FORBIDDEN', 'Нужен аккаунт сотрудника');
  }
  const readBalance = createBalanceReader(billingKey);
  app.get('/api/statuses/fal-balance', { preHandler: account }, () => readBalance());
  let latestQuery: ReturnType<typeof db.prepare<[string], EntryRow>>;
  const latest = (id: string) => (latestQuery ??= db.prepare<[string], EntryRow>("SELECT * FROM session_history WHERE session_id=? AND step<>'history' ORDER BY id DESC LIMIT 1")).get(id);
  // A missing diagnostics table can coexist with healthy capture/generation after a failed migration.
  const hasHistory = () => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_history'").get();
  const list = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), number: z.coerce.number().int().positive().optional(),
    before: z.coerce.number().int().positive().optional(), issues: z.literal('1').optional() }).strict();
  app.get('/api/statuses', { preHandler: account }, (request): StatusPage => {
    const q = list.parse(request.query);
    const time = now(), date = q.date ?? eventDate(time);
    const available = hasHistory();
    const issue = available ? `(${businessIssue} OR ${captureIssue})` : businessIssue;
    const where = ['s.event_date=?'];
    const values: (string | number)[] = [date];
    if (q.issues) where.push(issue);
    if (q.number) { where.push('s.number=?'); values.push(q.number); }
    if (q.before) { where.push('s.number<?'); values.push(q.before); }
    const rows = db.prepare(`${selection} WHERE ${where.join(' AND ')} ORDER BY s.number DESC LIMIT 31`).all(...values) as Row[];
    const count = db.prepare(`SELECT COUNT(*) n ${join} WHERE s.event_date=? AND ${issue}`).get(date) as { n: number };
    return { date, serverNow: time, issues: count.n, sessions: rows.slice(0,30).map(row => status(row, available ? latest(row.id) : undefined)), nextBefore: rows.length > 30 ? rows[29].number : null };
  });
  app.get<{ Params: { id: string } }>('/api/statuses/:id', { preHandler: account }, (request): SessionHistory => {
    const { after } = z.object({ after: z.coerce.number().int().nonnegative().default(0) }).strict().parse(request.query);
    const row = db.prepare(`${selection} WHERE s.id=?`).get(request.params.id) as Row | undefined;
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Сессия недоступна');
    const available = hasHistory();
    const rows = available ? db.prepare<[string,number], EntryRow>('SELECT * FROM session_history WHERE session_id=? AND id>? ORDER BY id LIMIT 101').all(row.id, after) : [];
    const partial = !available || !db.prepare("SELECT 1 FROM session_history WHERE session_id=? AND step='capture.start' AND outcome='succeeded' LIMIT 1").get(row.id);
    return { version: 1, session: status(row, available ? latest(row.id) : undefined), partial,
      facts: { createdAt: iso(row.created_at)!, model: JSON.parse(row.snapshot).generation?.model ?? null,
        requestId: row.request_id && /^[a-zA-Z0-9_.:-]{1,160}$/.test(row.request_id) ? row.request_id : null, submittedAt: iso(row.submitted_at), readyAt: iso(row.ready_at), openedAt: iso(row.opened_at),
        emailState: row.email_state, sentAt: iso(row.sent_at), errorCode: row.error_code ?? row.email_error },
      entries: rows.slice(0,100).map(entryView), nextAfter: rows.length > 100 ? rows[99].id : null };
  });
}
