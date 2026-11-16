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

export function rimWave(node: HTMLDivElement, initial: { pageVersion: number; gain: number; previewVersion: number }) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let params = initial;
  let animations: Animation[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let due = 0;
  let remaining = 0;
  let stopped = false;
  const clear = () => {
    clearTimeout(timer); timer = undefined;
    animations.forEach(animation => animation.cancel()); animations = [];
  };
  function schedule(delay: number) {
    remaining = delay;
    if (document.hidden || stopped || motion.matches) return;
    due = performance.now() + delay;
    timer = setTimeout(wave, delay);
  }
  function scheduleNext() {
    const interval = randomBetween(5000, 7000);
    node.dataset.waveInterval = String(Math.round(interval));
    schedule(interval);
  }
  function wave() {
    clear();
    if (stopped || motion.matches) return;
    const origin = document.timeline.currentTime;
    const lights = Array.from(node.querySelectorAll<HTMLElement>('.rim-breath'));
    animations = lights.map((light, index) => {
      const position = Number(light.closest('[data-position]')?.getAttribute('data-position') ?? index);
      const delay = (Math.floor(position / 3) + position % 3) * 200;
      const animation = light.animate([{ opacity: 0 }, { opacity: Math.min(1, Math.max(0, params.gain)), offset: .5 }, { opacity: 0 }], { duration: 1000, delay, easing: 'ease-in-out' });
      if (typeof origin === 'number') animation.startTime = origin;
      return animation;
    });
    node.dataset.waveCount = String(Number(node.dataset.waveCount ?? 0) + 1);
    scheduleNext(); // One grid-wide start-to-start cycle; replay replaces this same timer.
  }
  const preference = () => { clear(); if (!motion.matches) scheduleNext(); };
  const visibility = () => {
    if (document.hidden) {
      if (timer !== undefined) { remaining = Math.max(0, due - performance.now()); clearTimeout(timer); timer = undefined; }
      animations.forEach(animation => { if (animation.playState === 'running') animation.pause(); });
    } else if (!motion.matches) {
      animations.forEach(animation => { if (animation.playState === 'paused') animation.play(); });
      schedule(remaining);
    }
  };
  preference();
  motion.addEventListener('change', preference);
  document.addEventListener('visibilitychange', visibility);
  return {
    update(next: typeof initial) {
      const pageChanged = next.pageVersion !== params.pageVersion;
      const previewRequested = next.previewVersion !== params.previewVersion;
      params = next;
      if (pageChanged) preference();
      else if (previewRequested) wave();
    },
    destroy() { stopped = true; clear(); motion.removeEventListener('change', preference); document.removeEventListener('visibilitychange', visibility); },
  };
}

export function revealSize(node: HTMLDivElement) {
  const measure = () => {
    const { width, height } = node.getBoundingClientRect();
    const farthestCorner = Math.hypot(width * .62, height / 2);
    // Keep the accepted wide radial shape; opacity now fades during its expansion.
    // The feather is 1.5 card heights (three times the earlier half-height zone).
    const core = farthestCorner + 2;
    const radius = core + height * 1.5;
    node.style.setProperty('--bloom-diameter', `${radius * 2}px`);
    node.style.setProperty('--bloom-core', `${core / radius * 100}%`);

  };
  const resize = new ResizeObserver(measure); resize.observe(node); measure();
  return { destroy() { resize.disconnect(); } };
}
