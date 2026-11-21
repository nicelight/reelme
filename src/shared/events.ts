/** Events share a calendar-day visitor counter. Archive URLs keep the original date for the first event. Archive sizes count
 * session-owned files once; media URLs require an operator/admin account. */
export const participantRanges = ['0–50', '50–100', '100–300', '300–1000'] as const;
export type ParticipantRange = typeof participantRanges[number];
export type EventSetup = { action: 'check' } | { action: 'skip' }
  | { action: 'save'; name: string; participantRange: ParticipantRange; location: string };
export function eventKey(date: string, eventNo = 1) { return eventNo === 1 ? date : `${date}~${eventNo}`; }
export interface CurrentEvent { key: string; name: string }
export interface EventDetails { date: string; eventNo?: number; name: string; participantRange: ParticipantRange | null; location: string }
export interface ArchiveEvent extends EventDetails { closedToday?: boolean; photoBytes: number; videoBytes: number }
export interface ArchiveSession {
  id: string; number: number; description: string; thumbnailUrl: string;
  videoUrl: string | null;
  testVideo?: true;
}
export interface EventGallery extends EventDetails { sessions: ArchiveSession[] }
export interface PreparationProgress {
  running: boolean; total: number; deleted: number; failed: number; remoteErrors: number;
}
export interface EventPreparation {
  through: string; eligibleCount: number; operation: PreparationProgress | null;
}
