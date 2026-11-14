/** Installation-only client: module origin is the cloud API, document origin is
 * the local camera host. Credentials never enter URLs or cloud cookies. */
export const cloudOrigin = new URL(import.meta.url).origin;
export const installationKeyStorage = 'reelme.installationKey';
export const startStorage = 'reelme.captureStart';
export class ApiError extends Error {
  constructor(public status: number) { super(`HTTP ${status}`); }
}
export async function request(path: string, key: string, init: RequestInit = {}) {
  const response = await fetch(new URL(path, cloudOrigin), {
    ...init, credentials: 'omit',
    headers: { ...init.headers, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new ApiError(response.status);
  return response;
}
