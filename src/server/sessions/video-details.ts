/** Staff player details come from the session snapshot. The caller scopes the row
 * to an accessible ready video before requesting any missing billing data. */
import type { SlotSnapshot } from '../../shared/capture.js';
import type { ResultVideoDetails } from '../../shared/display.js';
import { isTestVideo } from '../../shared/scenarios.js';
import { isBillableRequest, type CostReader } from './fal-costs.js';

export const videoDetailsColumns = `s.id, s.number, s.snapshot, g.request_id, g.cost_usd,
  COALESCE(g.submitted_at,s.created_at) AS submittedAt`;
export interface VideoDetailsRow {
  id: string; number: number; snapshot: string; request_id: string | null; cost_usd: number | null; submittedAt: number;
}
export function videoDetails(row: VideoDetailsRow, costs: CostReader): ResultVideoDetails {
  const snapshot: Partial<SlotSnapshot> = JSON.parse(row.snapshot);
  const generation: Partial<SlotSnapshot['generation']> = snapshot.generation ?? {};
  const billable = isBillableRequest(row.request_id, generation.simulateGeneration);
  if (billable && row.cost_usd === null) costs.refresh([{ id: row.id, requestId: row.request_id!, submittedAt: row.submittedAt }]);
  return {
    number: row.number, model: generation.model ?? null, testVideo: isTestVideo(generation),
    costUsd: billable ? row.cost_usd : undefined, comment: snapshot.comment,
    prompt: generation.simulateGeneration ? null : (generation.prompt?.trim() || null),
  };
}
