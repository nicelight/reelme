/** Validates JPEG decoding without rewriting the source or calculating statistics.
 * Preserving every row prevents a small preview from hiding a damaged tail;
 * only one column reaches JS. The caller owns the input pixel limit. */
import sharp from 'sharp';

export async function inspectJpeg(path: string, limitInputPixels?: number) {
  const image = sharp(path, { limitInputPixels, failOn: 'warning' });
  const meta = await image.metadata();
  if (meta.format !== 'jpeg' || !meta.width || !meta.height || (meta.pages ?? 1) > 1) throw new Error('Invalid JPEG');
  // No vertical shrinking or cropping: all scanlines must decode, including the end.
  await image.resize({ width: 1, height: meta.height, fit: 'fill', kernel: 'linear' }).raw().toBuffer();
  return { width: meta.width, height: meta.height };
}
