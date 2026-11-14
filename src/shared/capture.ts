/** Module contract: installation-facing catalog/capture DTOs and the fixed photo
 * plan. Catalog exposes visitor content, never editor prompts/provider settings.
 * Start identity/date/number/plan survive retries; state reflects current progress.
 * The number is displayed only after finalized confirmation (FT-002).
 * This module performs no camera operations. */
import type { Mode, SlotInput } from './scenarios.js';
export interface CatalogItem {
  id: string;
  description: string;
  thumbnailId: string;
  mode: Mode;
  previewId?: string;
}
export interface CatalogPage {
  items: CatalogItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface Pose {
  index: number;
  key: 'front' | 'up-left' | 'down-right' | 'profile-left';
  instruction: string;
}
export const photoPoses: readonly Pose[] = [
  { index: 0, key: 'front', instruction: 'Смотрите прямо в объектив' },
  { index: 1, key: 'up-left', instruction: 'Поднимите голову немного вверх и влево' },
  { index: 2, key: 'down-right', instruction: 'Наклоните голову немного вниз и вправо' },
  { index: 3, key: 'profile-left', instruction: 'Поверните голову влево, в профиль' },
];
export interface StartReceipt {
  sessionId: string;
  date: string;
  number: number;
  state: SessionState;
  posePlan: Pose[];
}
export type SessionState = 'capturing' | 'submit_pending' | 'observing' | 'preparing' | 'ready' | 'failed';
/** complete means every position is stored; finalized additionally confirms
 * handoff for processing. Only finalized permits displaying the visitor number. */
export interface CaptureStatus extends StartReceipt {
  acceptedPoseIndices: number[];
  complete: boolean;
  finalized: boolean;
  error?: { code: string; message: string };
}
/** The saved description/thumbnail/demo are display material. Only generation
 * contains future model inputs; a P2V demo is never a generation input. */
export interface SlotSnapshot {
  slotId: string;
  description: string;
  thumbnailId: string;
  demoId?: string;
  expectedPhotos: 1 | 4;
  generation: Omit<SlotInput, 'description' | 'thumbnailId' | 'visible' | 'demoId'>;
}
