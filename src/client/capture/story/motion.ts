// Native motion-path animations: JS only schedules a pass or recomputes geometry on resize.
// No requestAnimationFrame loop and no per-frame Svelte state updates.
const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

export function ribbonLight(node: SVGGElement, route: { path: string; from: number; to: number }) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let animation: Animation | undefined;
  let stopped = false;
  node.style.offsetPath = `path('${route.path}')`;
  node.dataset.from = String(route.from); node.dataset.to = String(route.to);
  node.style.offsetRotate = 'auto';
  const run = () => {
    if (stopped || motion.matches) return;
    if (animation) { animation.onfinish = null; animation.cancel(); }
    const duration = randomBetween(7000, 15000);
    node.dataset.duration = String(Math.round(duration));
    const fade = 3000 / duration;
    const distanceAt = (offset: number) => `${route.from + (route.to - route.from) * offset}%`;
    animation = node.animate([
      { offset: 0, offsetDistance: distanceAt(0), opacity: 0 },
      { offset: fade, offsetDistance: distanceAt(fade), opacity: 1 },
      { offset: 1 - fade, offsetDistance: distanceAt(1 - fade), opacity: 1 },
      { offset: 1, offsetDistance: distanceAt(1), opacity: 0 },
    ], { duration, easing: 'linear', fill: 'forwards' });
    animation.onfinish = run;
    if (document.hidden) animation.pause();
  };
  const visibility = () => { if (document.hidden) animation?.pause(); else if (!motion.matches) animation?.play(); };
  const preference = () => {
    if (animation) { animation.onfinish = null; animation.cancel(); }
    node.style.offsetDistance = `${(route.from + route.to) / 2}%`;
    if (!motion.matches) run();
  };
  preference();
  motion.addEventListener('change', preference);
  document.addEventListener('visibilitychange', visibility);
  return { destroy() {
    stopped = true;
    if (animation) { animation.onfinish = null; animation.cancel(); }
    motion.removeEventListener('change', preference);
    document.removeEventListener('visibilitychange', visibility);
  } };
}

