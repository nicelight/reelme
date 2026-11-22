/** Original camera bytes belong to a server-issued session and pose. The capture
 * owner retains these Blobs for upload retries; URLs/previews are not originals.
 * Ordered capture/transfer semantics: docs/slot-setup/matrix.md. */
export interface CapturedPhoto { sessionId: string; poseIndex: number; blob: Blob }

/** Apply the session rotation after EXIF orientation, resizing the upload copy in the same pass. */
export async function prepareUploadPhoto(original: Blob, maxEdge: number, rotate180: boolean): Promise<Blob> {
  if (!maxEdge && !rotate180) return original;
  const image = await createImageBitmap(original, { imageOrientation: 'from-image' });
  try {
    const longest = Math.max(image.width, image.height);
    const scale = maxEdge && longest > maxEdge ? maxEdge / longest : 1;
    if (scale === 1 && !rotate180) return original;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить фото к отправке.');
    context.imageSmoothingQuality = 'high';
    if (rotate180) context.setTransform(-1, 0, 0, -1, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!jpeg) throw new Error('Не удалось подготовить JPEG для отправки.');
    return jpeg;
  } finally {
    image.close();
  }
}
