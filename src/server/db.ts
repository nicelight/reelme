/** Module contract: idempotent SQLite schema for Access, Scenarios and capture
 * sessions/photos and generation state. Metadata stays in SQLite; media bytes stay outside the build. Repeated
 * setup/start preserves rows. Session number and start-request uniqueness are DB
 * invariants. One accepted photo belongs to one session/pose. Generation records
 * preserve confirmed fal identity and verified files. Session issuance owns scoped
 * capabilities, first-open/confirmation times and the independent email state. */
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
      pose_index INTEGER NOT NULL CHECK(pose_index BETWEEN 0 AND 3),
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
    PRAGMA user_version = 5;
  `);
  return db;
}
export type DB = ReturnType<typeof openDatabase>;
