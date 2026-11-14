/** Module contract: server-only fal queue transport. Uses the chosen endpoint,
 * leaves provider retries enabled, disables fallback and retains no IO history.
 * No storage or lifecycle decisions; callers persist the accepted request before
 * observing it. Network calls have a bounded deadline; no subscribe/cancel loop. */
import { createFalClient } from '@fal-ai/client';
export interface FalReceipt { request_id: string; status_url: string; response_url: string; cancel_url?: string }
export interface FalTransport {
  submit(endpoint: string, input: Record<string, unknown>): Promise<FalReceipt>;
  status(endpoint: string, requestId: string): Promise<{ status: string; error?: unknown }>;
  result(endpoint: string, requestId: string): Promise<unknown>;
}
export const falHeaders = {
  'x-app-fal-disable-fallback': 'true',
  'X-Fal-Store-IO': '0',
  'X-Fal-Object-Lifecycle-Preference': JSON.stringify({ expiration_duration_seconds: 86400 }),
};
export function createFalTransport(key: string, transport?: typeof fetch): FalTransport {
  const fal = createFalClient({ credentials: key, ...(transport ? { fetch: transport } : {}) });
  return {
    submit: (endpoint, input) => fal.queue.submit(endpoint, { input, headers: falHeaders, abortSignal: AbortSignal.timeout(30_000) }),
    status: (endpoint, requestId) => fal.queue.status(endpoint, { requestId, logs: false, abortSignal: AbortSignal.timeout(30_000) }),
    result: async (endpoint, requestId) => (await fal.queue.result(endpoint, { requestId, abortSignal: AbortSignal.timeout(30_000) })).data,
  };
}
