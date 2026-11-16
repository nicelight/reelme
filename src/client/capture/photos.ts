/** Original camera bytes belong to a server-issued session and pose. The capture
 * owner retains these Blobs for upload retries; URLs/previews are not originals.
 * Ordered capture/transfer semantics: docs/slot-setup/matrix.md. */
export interface CapturedPhoto { sessionId: string; poseIndex: number; blob: Blob }
