/** Module contract: server-only environment configuration. Data never lives in
 * build/static directories; origin is explicit, never taken from request headers. */
import { resolve, sep } from 'node:path';
export interface Config { origin: string; host: string; port: number; dataDir: string; clientDir: string; falKey?: string }
export function readConfig(): Config {
  const origin = process.env.APP_ORIGIN || 'http://localhost:3000';
  const url = new URL(origin);
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('APP_ORIGIN должен быть origin без пути');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Для внешнего APP_ORIGIN требуется HTTPS');
  const falKey = process.env.FAL_KEY?.trim() || undefined;
  if (falKey && url.protocol !== 'https:') throw new Error('Для fal требуется доступный извне HTTPS APP_ORIGIN');
  const dataDir = resolve(process.env.DATA_DIR || 'var');
  const buildDir = resolve('dist');
  if (dataDir === buildDir || dataDir.startsWith(buildDir + sep) || buildDir.startsWith(dataDir + sep)) throw new Error('DATA_DIR должен находиться отдельно от dist');
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Недопустимый PORT');
  return { falKey, origin, host: process.env.HOST || '127.0.0.1', port, dataDir, clientDir: resolve('dist/client') };
}
