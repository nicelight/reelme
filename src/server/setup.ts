/** Module contract: local initial provisioning, never a user-management API.
 * Repeat setup preserves accounts, keys and all product data. Generated key is
 * written to a private file, never printed. Env passwords are used only here. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig } from './config.js';
import { openDatabase } from './db.js';
import { digest, hashPassword, token } from './access/credentials.js';
process.umask(0o077);
const config = readConfig();
const db = openDatabase(config.dataDir);
try {
  const missing = (['admin', 'operator'] as const).filter(role => !db.prepare('SELECT id FROM accounts WHERE role=?').get(role));
  for (const role of missing) {
    const password = process.env[`${role.toUpperCase()}_PASSWORD`];
    if (!password || password.length < 12 || password.length > 256) throw new Error(`${role.toUpperCase()}_PASSWORD: требуется 12–256 символов`);
  }
  const rows = await Promise.all(missing.map(async role => ({ role, hash: await hashPassword(process.env[`${role.toUpperCase()}_PASSWORD`]!) })));
  db.transaction(() => {
    for (const { role, hash } of rows) db.prepare('INSERT INTO accounts(username, role, password_hash) VALUES (?,?,?)').run(role, role, hash);
  })();
  if (!db.prepare('SELECT 1 FROM installation_keys').get()) {
    const key = token();
    writeFileSync(join(config.dataDir, 'installation-key.txt'), key + '\n', { mode: 0o600, flag: 'wx' });
    db.prepare('INSERT INTO installation_keys(token_hash) VALUES (?)').run(digest(key));
  }
  console.log('БД готова. Аккаунты: admin, operator. Ключ: DATA_DIR/installation-key.txt. Существующие данные сохранены.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Ошибка настройки'); process.exitCode = 1;
} finally { db.close(); }
