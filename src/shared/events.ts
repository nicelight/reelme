/** Read-only archive projection. Sizes count session-owned images/videos once;
 * URLs are authenticated archive media, never visitor or provider capabilities. */
export interface ArchiveEvent { date: string; photoBytes: number; videoBytes: number }
export interface ArchiveSession {
  id: string; number: number; description: string; thumbnailUrl: string;
  videoUrl: string | null;
}
export interface EventGallery { date: string; sessions: ArchiveSession[] }
