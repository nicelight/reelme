/** Event setup belongs to the Novosibirsk calendar day. Archive sizes count
 * session-owned files once; media URLs require an operator/admin account. */
export const participantRanges = ['0–50', '50–100', '100–300', '300–1000'] as const;
export type ParticipantRange = typeof participantRanges[number];
export type EventSetup = { action: 'check' } | { action: 'skip' }
  | { action: 'save'; name: string; participantRange: ParticipantRange; location: string };
export interface EventDetails { date: string; name: string; participantRange: ParticipantRange | null; location: string }
export interface ArchiveEvent extends EventDetails { photoBytes: number; videoBytes: number }
export interface ArchiveSession {
  id: string; number: number; description: string; thumbnailUrl: string;
  videoUrl: string | null;
  testVideo?: true;
}
export interface EventGallery extends EventDetails { sessions: ArchiveSession[] }
