import sharp from 'sharp';

/** Late-body damage retains a readable JPEG header, so metadata alone cannot reject it. */
export async function jpegFixtures(progressive = false) {
  const width = 2048; const height = 1536;
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 13 + (i >>> 8)) & 255;
  const valid = await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 88, progressive }).toBuffer();
  const cut = Math.floor(valid.length * 0.98);
  const truncated = valid.subarray(0, cut);
  const earlyEnd = Buffer.concat([truncated, Buffer.from([0xff, 0xd9])]);
  const damaged = Buffer.from(valid); damaged.fill(0xff, cut, Math.min(cut + 64, valid.length - 2));
  return { width, height, valid, broken: { truncated, earlyEnd, damaged } };
}
