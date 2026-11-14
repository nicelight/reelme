/** Module contract: the durable event deletion marker closes every session
 * capability and new worker publication, including while local cleanup retries. */
import type { DB } from '../db.js';
export function sessionAvailable(db: DB, id: string): boolean {
  return !!db.prepare('SELECT 1 FROM capture_sessions s JOIN events e ON e.date=s.event_date WHERE s.id=? AND e.deleting=0').get(id);
}
