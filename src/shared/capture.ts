/** Module contract: installation-facing catalog/capture DTOs and saved photo
 * plan. Catalog exposes visitor content, never editor prompts/provider settings.
 * Start identity/date/number/plan survive retries; state reflects current progress.
 * The number is displayed only after finalized confirmation (FT-002).
 * This module performs no camera operations. Source: docs/slot-setup/matrix.md. */
import type { Mode, SlotInput } from './scenarios.js';
import type { SlotParticipants } from './slot-prompt-selection.js';
import type { GuideNumber } from './slot-setup.js';
export interface CatalogItem {
  id: string;
  description: string;
  thumbnailId: string;
  mode: Mode;
  previewId?: string;
  previewOrientation?: 'portrait' | 'landscape';
}
export function compactStoryTitle(description: string): string {
  return description.trim().split(/\s+/u, 2).join(' ');
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
  key: 'front' | 'up-left' | 'down-right' | 'profile-left' | 'smile' | 'look-down' | 'group';
  instruction: string;
  /** Absent only on legacy session positions. */
  participant?: SlotParticipants;
  guideNumber?: GuideNumber;
  guideMediaId?: string;
  caption?: string;
}
export const photoPoses: readonly Pose[] = [
  { index: 0, key: 'front', instruction: 'Смотрите прямо в объектив' },
  { index: 1, key: 'up-left', instruction: 'Поднимите голову немного вверх и влево' },
  { index: 2, key: 'down-right', instruction: 'Наклоните голову немного вниз и вправо' },
  { index: 3, key: 'profile-left', instruction: 'Поверните голову влево, в профиль' },
];
export interface CaptureSettings {
  photoMaxEdge: 0 | 1024 | 2048;
  sendCaptureLogs: boolean;
  startMode: 'manual' | 'automatic';
  countdownSeconds: number;
  reviewSeconds: number;
  receiptSeconds: number;
}
export const defaultCaptureSettings: CaptureSettings = {
  photoMaxEdge: 0,
  sendCaptureLogs: false, startMode: 'manual', countdownSeconds: 5, reviewSeconds: 3, receiptSeconds: 5,
};

export const captureHeartbeatIntervalMs = 15_000;
export const captureHeartbeatTimeoutMs = 60_000;

export interface StartReceipt {
  captureSettings?: CaptureSettings;
  sessionId: string;
  date: string;
  number: number;
  state: SessionState;
  posePlan: Pose[];
  /** Session-pinned visitor artwork; optional for receipts saved by older clients. */
  story?: { description: string; thumbnailId: string; slotId?: string };
}
export type SessionState = 'capturing' | 'submit_pending' | 'observing' | 'preparing' | 'ready' | 'failed' | 'simulated';
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
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
export interface SlotSnapshot {
  captureSettings?: CaptureSettings;
  /** Only manual tests retain their immutable source for retry; never a model input. */
  testPhotoId?: string;
  /** New manual tests keep one source per saved pose, in the same order. */
  testPhotoIds?: string[];
  slotId: string;
  description: string;
  thumbnailId: string;
  demoId?: string;
  expectedPhotos: number;
  /** Absence identifies a legacy snapshot; do not normalize it on read. */
  posePlan?: Pose[];
  generation: Omit<SlotInput, 'description' | 'thumbnailId' | 'visible' | 'demoId' | 'testPhotoId' | 'testPhotoIds'>;
}
/** Always return a copy; saved plans never follow later guide/catalog edits. */
export function snapshotPosePlan(snapshot: SlotSnapshot): Pose[] {
  if (snapshot.posePlan !== undefined) {
    if (!Array.isArray(snapshot.posePlan) || snapshot.posePlan.length !== snapshot.expectedPhotos || snapshot.posePlan.length < 1 || snapshot.posePlan.length > 8 || snapshot.posePlan.some((pose, index) => pose.index !== index)) throw new Error('Invalid saved capture plan');
    return snapshot.posePlan.map(pose => ({ ...pose }));
  }
  if (snapshot.expectedPhotos !== 1 && snapshot.expectedPhotos !== 4) throw new Error('Invalid legacy photo count');
  return photoPoses.slice(0, snapshot.expectedPhotos).map(pose => ({ ...pose }));
}
