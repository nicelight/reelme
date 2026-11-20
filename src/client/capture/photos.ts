/** Original camera bytes belong to a server-issued session and pose. The capture
 * owner retains these Blobs for upload retries; URLs/previews are not originals.
 * Ordered capture/transfer semantics: docs/slot-setup/matrix.md. */
export interface CapturedPhoto { sessionId: string; poseIndex: number; blob: Blob }

/** Apply the session's long-edge limit to the upload copy, preserving EXIF orientation. */
export async function prepareUploadPhoto(original: Blob, maxEdge: number): Promise<Blob> {
  if (!maxEdge) return original;
  const image = await createImageBitmap(original, { imageOrientation: 'from-image' });
  try {
    const longest = Math.max(image.width, image.height);
    if (longest <= maxEdge) return original;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * maxEdge / longest));
    canvas.height = Math.max(1, Math.round(image.height * maxEdge / longest));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить фото к отправке.');
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!jpeg) throw new Error('Не удалось уменьшить фото.');
    return jpeg;
  } finally {
    image.close();
  }
}
