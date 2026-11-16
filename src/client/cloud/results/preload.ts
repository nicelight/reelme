import egg from '../results-prototype/assets/egg.png';
/** Keep decoded images alive until their page/queue is released, rather than rely
 * on cache heuristics during the first hatch or after server visibility expires. */
export async function decodeImage(url: string): Promise<HTMLImageElement> {
  const image = new Image(); image.loading = 'eager'; image.decoding = 'async'; image.src = url;
  await image.decode();
  if (!image.naturalWidth) throw new Error('Image is empty');
  return image;
}
export async function preloadStage() {
  const [image] = await Promise.all([
    decodeImage(egg),
    ...[400, 600, 700, 800].map(weight => document.fonts.load(`${weight} 24px Manrope`, 'Ваши видео № 0123456789')),
  ]);
  return image;
}
