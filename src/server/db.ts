/** Module contract: idempotent SQLite schema for Access, Scenarios and capture
 * sessions/photos and generation state. Metadata stays in SQLite; media bytes stay outside the build. Repeated
 * setup/start preserves rows. Session number and start-request uniqueness are DB
 * invariants. One accepted photo belongs to one session/pose. Generation records
 * preserve confirmed fal identity and verified files. Nullable submit/ready times
 * preserve unknown history; migrations never invent historical timestamps. Session issuance owns scoped
 * capabilities, first-open/confirmation times and the independent email state.
 * Private mail profiles retain both sets of credentials with one active sender.
 * Events retain a deletion marker until restartable local cleanup finishes.
 * Event names/metadata persist independently of browser state; a durable counter
 * never reuses an automatic Session_N number after an event is deleted.
 * Capture positions follow docs/slot-setup/matrix.md; migrations retain provider capabilities. */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
export function openDatabase(dataDir: string) {
  mkdirSync(join(dataDir, 'media'), { recursive: true, mode: 0o700 });
  const db = new Database(join(dataDir, 'reelme.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,
      role TEXT UNIQUE NOT NULL CHECK(role IN ('admin','operator')), password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id),
      expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS installation_keys (token_hash TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS slot_media (
      id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, kind TEXT NOT NULL,
      mime TEXT NOT NULL, size INTEGER NOT NULL, duration REAL, width INTEGER NOT NULL,
      height INTEGER NOT NULL, owner TEXT NOT NULL DEFAULT 'scenarios'
    );
    CREATE TABLE IF NOT EXISTS fal_template_cache (
      media_id TEXT PRIMARY KEY REFERENCES slot_media(id) ON DELETE CASCADE,
      url TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fal_template_pending (
      media_id TEXT PRIMARY KEY REFERENCES slot_media(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS slots (id TEXT PRIMARY KEY, config TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (
      date TEXT PRIMARY KEY, next_number INTEGER NOT NULL CHECK(next_number >= 1)
    );
    CREATE TABLE IF NOT EXISTS capture_sessions (
      id TEXT PRIMARY KEY, start_request_id TEXT UNIQUE NOT NULL,
      event_date TEXT NOT NULL REFERENCES events(date), number INTEGER NOT NULL,
      slot_id TEXT NOT NULL REFERENCES slots(id), snapshot TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'capturing', created_at INTEGER NOT NULL,
      UNIQUE(event_date, number)
    );
    CREATE TABLE IF NOT EXISTS capture_photos (
      session_id TEXT NOT NULL REFERENCES capture_sessions(id) ON DELETE CASCADE,
      pose_index INTEGER NOT NULL CHECK(pose_index BETWEEN 0 AND 7),
      path TEXT UNIQUE NOT NULL, size INTEGER NOT NULL,
      width INTEGER NOT NULL, height INTEGER NOT NULL,
      PRIMARY KEY(session_id, pose_index)
    );
    CREATE TABLE IF NOT EXISTS generation_jobs (
      session_id TEXT PRIMARY KEY REFERENCES capture_sessions(id) ON DELETE CASCADE,
      request_id TEXT, status_url TEXT, response_url TEXT, cancel_url TEXT,
      result_url TEXT, video_path TEXT, frame_path TEXT,
      video_size INTEGER, frame_size INTEGER, width INTEGER, height INTEGER, duration REAL,
      error_code TEXT, error_message TEXT
    );
    CREATE TABLE IF NOT EXISTS provider_media (
      token TEXT PRIMARY KEY,
      slot_media_id TEXT UNIQUE REFERENCES slot_media(id) ON DELETE CASCADE,
      session_id TEXT, pose_index INTEGER,
      UNIQUE(session_id,pose_index),
      FOREIGN KEY(session_id,pose_index) REFERENCES capture_photos(session_id,pose_index) ON DELETE CASCADE,
      CHECK ((slot_media_id IS NOT NULL AND session_id IS NULL AND pose_index IS NULL)
        OR (slot_media_id IS NULL AND session_id IS NOT NULL AND pose_index IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS session_delivery (
      session_id TEXT PRIMARY KEY REFERENCES capture_sessions(id) ON DELETE CASCADE,
      receive_token TEXT UNIQUE NOT NULL, download_token TEXT UNIQUE NOT NULL,
      opened_at INTEGER, email_confirmed_at INTEGER, email TEXT,
      email_state TEXT NOT NULL DEFAULT 'not_requested'
        CHECK(email_state IN ('not_requested','pending','sending','sent','failed')),
      email_error TEXT, sent_at INTEGER
    );
  `);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('slots') WHERE name='deleted'").get()) {
    db.exec('ALTER TABLE slots ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
  }
  const photosSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='capture_photos'").get() as { sql: string }).sql;
  if (/BETWEEN\s+0\s+AND\s+3/i.test(photosSql)) {
    // Keep the original table name in dependent FK definitions. Renaming the old
    // table first would redirect provider_media; dropping with FK on would delete tokens.
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(`CREATE TABLE capture_photos_next (
          session_id TEXT NOT NULL REFERENCES capture_sessions(id) ON DELETE CASCADE,
          pose_index INTEGER NOT NULL CHECK(pose_index BETWEEN 0 AND 7),
          path TEXT UNIQUE NOT NULL, size INTEGER NOT NULL,
          width INTEGER NOT NULL, height INTEGER NOT NULL,
          PRIMARY KEY(session_id, pose_index)
        );
        INSERT INTO capture_photos_next SELECT * FROM capture_photos;
        DROP TABLE capture_photos;
        ALTER TABLE capture_photos_next RENAME TO capture_photos;`);
        if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('Capture photo migration violates foreign keys');
      }).immediate();
    } finally { db.pragma('foreign_keys = ON'); }
  }
  if (!(db.prepare('PRAGMA table_info(events)').all() as { name: string }[]).some(column => column.name === 'deleting')) {
    db.exec('ALTER TABLE events ADD COLUMN deleting INTEGER NOT NULL DEFAULT 0 CHECK(deleting IN (0,1))');
  }
  const eventColumns = new Set((db.prepare('PRAGMA table_info(events)').all() as { name: string }[]).map(column => column.name));
  db.transaction(() => {
    if (!eventColumns.has('name')) db.exec('ALTER TABLE events ADD COLUMN name TEXT');
    if (!eventColumns.has('participant_range')) db.exec('ALTER TABLE events ADD COLUMN participant_range TEXT');
    if (!eventColumns.has('location')) db.exec("ALTER TABLE events ADD COLUMN location TEXT NOT NULL DEFAULT 'Новосибирск'");
    if (!eventColumns.has('setup_complete')) db.exec('ALTER TABLE events ADD COLUMN setup_complete INTEGER NOT NULL DEFAULT 0 CHECK(setup_complete IN (0,1))');
    db.exec(`CREATE TABLE IF NOT EXISTS event_name_counter (
      id INTEGER PRIMARY KEY CHECK(id=1), next_number INTEGER NOT NULL CHECK(next_number>=1)
    ); INSERT OR IGNORE INTO event_name_counter(id,next_number) VALUES(1,1);`);
    // Existing ordinary capture has already begun: never ask for its event retroactively.
    // Admin-only test days remain available for setup before the first visitor.
    const unnamed = db.prepare('SELECT date FROM events WHERE name IS NULL ORDER BY date').all() as { date: string }[];
    for (const { date } of unnamed) {
      const { number } = db.prepare('UPDATE event_name_counter SET next_number=next_number+1 WHERE id=1 RETURNING next_number-1 AS number').get() as { number: number };
      db.prepare(`UPDATE events SET name=?,setup_complete=EXISTS (
        SELECT 1 FROM capture_sessions s WHERE s.event_date=events.date
          AND json_type(s.snapshot,'$.testPhotoId') IS NULL AND json_type(s.snapshot,'$.testPhotoIds') IS NULL
      ) WHERE date=?`).run(`Session_${number}`, date);
    }
  }).immediate();
  // Older sessions have no observation of page contact.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('capture_sessions') WHERE name='page_seen_at'").get()) {
    db.exec('ALTER TABLE capture_sessions ADD COLUMN page_seen_at INTEGER');
  }
  const jobColumns = new Set((db.prepare('PRAGMA table_info(generation_jobs)').all() as { name: string }[]).map(column => column.name));
  for (const column of ['submitted_at', 'ready_at']) {
    if (!jobColumns.has(column)) db.exec(`ALTER TABLE generation_jobs ADD COLUMN ${column} INTEGER`);
  }
  if (!jobColumns.has('cost_usd')) db.exec('ALTER TABLE generation_jobs ADD COLUMN cost_usd REAL');
  if (!jobColumns.has('template_repaired')) db.exec('ALTER TABLE generation_jobs ADD COLUMN template_repaired INTEGER NOT NULL DEFAULT 0');
  const mediaColumns = new Set((db.prepare('PRAGMA table_info(slot_media)').all() as { name: string }[]).map(column => column.name));
  for (const column of ['template_slot_id', 'template_orientation']) {
    if (!mediaColumns.has(column)) db.exec(`ALTER TABLE slot_media ADD COLUMN ${column} TEXT`);
  }
  db.transaction(() => {
    const columns = db.prepare('PRAGMA table_info(capture_guides)').all() as { name: string }[];
    if (columns.some(column => column.name === 'caption')) return;
    if (columns.length) db.exec('ALTER TABLE capture_guides RENAME TO capture_guides_previous');
    db.exec(`CREATE TABLE capture_guides (
      number INTEGER PRIMARY KEY CHECK(number BETWEEN 1 AND 5),
      media_id TEXT REFERENCES slot_media(id), caption TEXT
    )`);
    if (columns.length) db.exec(`INSERT INTO capture_guides(number,media_id) SELECT number,media_id FROM capture_guides_previous;
      DROP TABLE capture_guides_previous;`);
  }).immediate();
  db.exec(`CREATE TABLE IF NOT EXISTS display_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    page_duration_seconds INTEGER NOT NULL CHECK(page_duration_seconds IN (10,20,30,40,50,60))
  );
  INSERT OR IGNORE INTO display_settings(id,page_duration_seconds) VALUES(1,10);`);
  db.exec(`CREATE TABLE IF NOT EXISTS capture_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), settings TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS capture_reports (
    session_id TEXT NOT NULL REFERENCES capture_sessions(id) ON DELETE CASCADE,
    report_id TEXT NOT NULL, case_id TEXT NOT NULL, received_at INTEGER NOT NULL, report TEXT NOT NULL,
    PRIMARY KEY(session_id,report_id)
  );
  CREATE INDEX IF NOT EXISTS capture_reports_case ON capture_reports(case_id);`);
  db.exec(`CREATE TABLE IF NOT EXISTS mail_profiles (
    provider TEXT PRIMARY KEY CHECK(provider IN ('mailru','smtpbz')),
    host TEXT NOT NULL, port INTEGER NOT NULL, user TEXT NOT NULL, password TEXT NOT NULL,
    "from" TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS mail_active_profile ON mail_profiles(active) WHERE active=1;`);
  // History is observational. A diagnostic schema failure must not prevent startup.
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS session_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES capture_sessions(id) ON DELETE CASCADE,
      at INTEGER NOT NULL, last_at INTEGER NOT NULL, source TEXT NOT NULL, step TEXT NOT NULL,
      event TEXT NOT NULL, outcome TEXT NOT NULL, detail TEXT NOT NULL, repeats INTEGER NOT NULL DEFAULT 1,
      bucket TEXT NOT NULL, report_key TEXT, UNIQUE(session_id, report_key)
    );
    CREATE INDEX IF NOT EXISTS session_history_session ON session_history(session_id,id);
    CREATE INDEX IF NOT EXISTS session_history_bucket ON session_history(session_id,bucket,id);`);
  } catch { console.warn('SESSION_HISTORY_SCHEMA_UNAVAILABLE'); }
  db.pragma('user_version = 18');
  return db;
}
export type DB = ReturnType<typeof openDatabase>;
