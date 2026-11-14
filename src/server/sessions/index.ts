/** Module contract: Sessions owns persistent session start and daily numbering.
 * A single SQLite transaction fixes Novosibirsk date, unique number and a value
 * snapshot from Scenarios. Repeated startRequestId returns the saved receipt,
 * including across edits, hidden slots and midnight. No camera/fal side effects. */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db.js';
import type { Access } from '../access/index.js';
import { snapshotSlot } from '../scenarios/store.js';
import { photoPoses, type StartReceipt, type SlotSnapshot } from '../../shared/capture.js';
import { HttpError } from '../errors.js';

interface SessionRow {
  id: string; start_request_id: string; event_date: string; number: number;
  slot_id: string; snapshot: string; state: 'capturing'; created_at: number;
}
const startSchema = z.object({ startRequestId: z.string().uuid(), slotId: z.string().uuid() }).strict();
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Novosibirsk', year: 'numeric', month: '2-digit', day: '2-digit' });
export function eventDate(timestamp: number): string {
  const fields = Object.fromEntries(dateFormatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}
function receipt(row: SessionRow): StartReceipt {
  const snapshot = JSON.parse(row.snapshot) as SlotSnapshot;
  return { sessionId: row.id, date: row.event_date, number: row.number, state: row.state, posePlan: photoPoses.slice(0, snapshot.expectedPhotos).map(pose => ({ ...pose })) };
}
export function readSession(db: DB, sessionId: string) {
  const row = db.prepare('SELECT * FROM capture_sessions WHERE id=?').get(sessionId) as SessionRow | undefined;
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Сессия не найдена');
  return { ...row, snapshot: JSON.parse(row.snapshot) as SlotSnapshot };
}
export function registerSessions(app: FastifyInstance, db: DB, access: Access, now: () => number) {
  const start = db.transaction((startRequestId: string, slotId: string) => {
    const previous = db.prepare('SELECT * FROM capture_sessions WHERE start_request_id=?').get(startRequestId) as SessionRow | undefined;
    if (previous) {
      if (previous.slot_id !== slotId) throw new HttpError(409, 'START_CONFLICT', 'Этот запрос уже относится к другому сюжету');
      return { created: false, value: receipt(previous) };
    }
    // Read the current visibility/config under the same write transaction as numbering.
    const snapshot = snapshotSlot(db, slotId);
    const createdAt = now(); const date = eventDate(createdAt);
    db.prepare('INSERT INTO events(date,next_number) VALUES (?,1) ON CONFLICT(date) DO NOTHING').run(date);
    const { number } = db.prepare('UPDATE events SET next_number=next_number+1 WHERE date=? RETURNING next_number-1 AS number').get(date) as { number: number };
    const row: SessionRow = {
      id: randomUUID(), start_request_id: startRequestId, event_date: date, number,
      slot_id: slotId, snapshot: JSON.stringify(snapshot), state: 'capturing', created_at: createdAt,
    };
    db.prepare('INSERT INTO capture_sessions(id,start_request_id,event_date,number,slot_id,snapshot,state,created_at) VALUES (@id,@start_request_id,@event_date,@number,@slot_id,@snapshot,@state,@created_at)').run(row);
    return { created: true, value: receipt(row) };
  });
  app.post('/api/capture/sessions', { preHandler: access.requireInstallation }, (request, reply) => {
    const { startRequestId, slotId } = startSchema.parse(request.body);
    const result = start.immediate(startRequestId, slotId);
    return reply.code(result.created ? 201 : 200).send(result.value);
  });
}
