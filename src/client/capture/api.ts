/** Installation-only client: module origin is the cloud API, document origin is
 * the local camera host. Credentials never enter URLs or cloud cookies. */
export const cloudOrigin = new URL(import.meta.url).origin;
export const installationKeyStorage = 'reelme.installationKey';
export const startStorage = 'reelme.captureStart';
export class ApiError extends Error {
  constructor(public status: number, public code?: string) { super(`HTTP ${status}`); }
}
export async function request(path: string, key: string, init: RequestInit = {}) {
  const response = await fetch(new URL(path, cloudOrigin), {
    ...init, credentials: 'omit',
    headers: { ...init.headers, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { code?: string } | null;
    throw new ApiError(response.status, body?.code);
  }
  return response;
}
