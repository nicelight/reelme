/** Module contract: same-origin, cookie-authenticated cloud requests only.
 * Reports safe API messages; never stores passwords or tokens in the client. */
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin', ...init,
    headers: { ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.message || (response.status === 401 ? 'Войдите в аккаунт ещё раз.' : 'Не удалось выполнить запрос. Повторите попытку.'), response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const mediaUrl = (id: string) => `/api/admin/slot-media/${encodeURIComponent(id)}`;
