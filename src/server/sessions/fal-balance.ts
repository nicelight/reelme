/** On-demand account balance for the staff status page. All tabs share one
 * billing request per minute, including when the provider is unavailable. */
import { balanceIntervalMs, type FalBalance } from '../../shared/statuses.js';

export function createBalanceReader(key?: string, transport = fetch, now = Date.now) {
  let credits: FalBalance['credits'] = null;
  let cached: Promise<FalBalance> | undefined;
  let nextRefresh = 0;

  async function refresh(): Promise<FalBalance> {
    if (!key) return { credits, error: 'Ключ для проверки баланса не настроен' };
    try {
      const response = await transport('https://api.fal.ai/v1/account/billing?expand=credits', {
        headers: { Authorization: 'Key ' + key }, redirect: 'error', signal: AbortSignal.timeout(8000),
      });
      if (response.status === 401 || response.status === 403) return { credits, error: 'Нет доступа к балансу fal' };
      if (!response.ok) throw new Error();
      const data = (await response.json()).credits;
      if (!Number.isFinite(data?.current_balance) || typeof data.currency !== 'string' || !/^[A-Z]{3}$/.test(data.currency)) throw new Error();
      credits = { amount: data.current_balance, currency: data.currency, checkedAt: now() };
      return { credits, error: null };
    } catch {
      return { credits, error: 'Не удалось обновить баланс' };
    }
  }
  return () => {
    const time = now();
    if (!cached || time >= nextRefresh) {
      nextRefresh = time + balanceIntervalMs;
      cached = refresh();
    }
    return cached;
  };
}
