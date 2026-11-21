/** Aggregate of unique files in the current server-side CDN upload batch. */
export interface TemplateUploadStatus {
  batch: string;
  totalFiles: number;
  readyFiles: number;
  totalBytes: number;
  sentBytes: number;
  pending: boolean;
  error: string | null;
}
