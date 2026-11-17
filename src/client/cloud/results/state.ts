/** Owns page order and hatch timing, not media or server visibility. Late resources
 * from the opening snapshot join as ordinary cards, never replayed hatches.
 * A late ordinary card waits for the active centre move/hatch: it cannot occupy
 * the move's destination or enable paging before that move finishes.
 * Supplied times are monotonic; this class starts no timers. */
export const perimeter = [0, 1, 2, 3, 5, 6, 7, 8] as const;
export type ResultPhase = 'egg' | 'shake' | 'bloom' | 'reveal' | 'result';
export const hatchTiming = { shake: 1400, bloom: 2450, reveal: 2850, done: 4850 } as const;
export class ResultsQueue {
  cells: (string | null)[] = Array(9).fill(null);
  pending: string[] = [];
  circular: string[] = [];
  seen = new Set<string>();
  valid = new Set<string>();
  hatched = new Set<string>();
  phase: ResultPhase = 'result';
  hatch: { id: string; started: number } | null = null;
  completedAt: number | null = null;
  movingUntil: number | null = null;
  leavingUntil: number | null = null;
  enteringUntil: number | null = null;
  pageDue: number | null = null;
  pageVersion = 0;
  page = 0;
  paged = false;
  duration = 10000;
  reduced = false;

  get pageCount() { return Math.max(1, Math.ceil((this.circular.length + this.pending.length + (this.hatch ? 1 : 0)) / 9)); }
  /** Existing ready results at reload are ordinary cards, never replayed eggs. */
  bootstrap(ids: string[], now: number) {
    this.seen = new Set(ids); this.valid = new Set(ids); this.hatched = new Set(ids); this.circular = [...ids];
    if (ids.length >= 9) { this.paged = true; this.openPage(now); }
    else {
      const shown = ids.slice(0, 9);
      shown.slice(0, -1).forEach((id, index) => this.cells[perimeter[index]] = id);
      this.cells[4] = shown.at(-1) ?? null;
      this.completedAt = now - 2000;
    }
  }
  sync(ids: string[], now: number, animate = true, initialIds: ReadonlySet<string> = new Set()) {
    const valid = new Set(ids); this.valid = valid;
    this.pending = this.pending.filter(id => valid.has(id));
    this.circular = this.circular.filter(id => valid.has(id));
    // Current page is a snapshot: expiry changes future eligibility only.
    for (const id of ids) if (!this.seen.has(id)) {
      this.seen.add(id);
      if (!initialIds.has(id)) { this.pending.push(id); continue; }
      this.hatched.add(id); this.circular.push(id);
    }
    if (animate) this.advance(now);
  }
  private placeOrdinary(now: number) {
    // A moving centre owns the next free position until its hatch completes.
    if (this.paged || this.movingUntil !== null || this.hatch) return;
    for (const id of this.circular) if (!this.cells.includes(id)) {
      const position = this.cells[4] === null ? 4 : perimeter.find(index => this.cells[index] === null);
      if (position === undefined) break;
      this.cells[position] = id; this.completedAt ??= now - 2000;
    }
    if (this.cells.every(Boolean)) { this.paged = true; this.pageDue = now + this.duration; }
  }
  private rotate(id: string) { if (this.valid.has(id)) this.circular = [...this.circular.filter(value => value !== id), id]; }
  private beginHatch(now: number) {
    const id = this.pending.shift(); if (!id) return;
    this.cells[4] = id; this.hatch = { id, started: now }; this.phase = 'egg'; this.completedAt = null;
  }
  private openPage(now: number) {
    this.cells = Array(9).fill(null); this.pageVersion++;
    const upcoming = this.pending[0];
    const ordinary = this.circular.filter(id => id !== upcoming).slice(0, upcoming ? 8 : 9);
    ordinary.forEach((id, index) => { this.cells[upcoming ? perimeter[index] : index] = id; this.rotate(id); });
    this.phase = 'result'; this.hatch = null; this.completedAt = null;
    if (upcoming) this.beginHatch(now);
    if (!this.cells.some(Boolean)) { this.paged = false; this.pageDue = null; }
    else this.pageDue = now + this.duration;
    this.enteringUntil = now + (this.reduced ? 200 : 700);
  }
  advance(now: number) {
    if (this.enteringUntil !== null && now >= this.enteringUntil) this.enteringUntil = null;
    if (this.leavingUntil !== null) {
      if (now < this.leavingUntil) return;
      this.leavingUntil = null; this.page = (this.page + 1) % this.pageCount; this.openPage(now);
    }
    if (this.hatch) {
      const elapsed = now - this.hatch.started;
      const done = this.reduced ? 1850 : hatchTiming.done;
      if (elapsed >= done) {
        const id = this.hatch.id; this.hatched.add(id);
        if (this.valid.has(id)) this.circular = [id, ...this.circular.filter(value => value !== id)];
        this.hatch = null; this.phase = 'result'; this.completedAt = now;
        if (!this.paged && this.cells.every(Boolean)) { this.paged = true; this.pageDue = now + this.duration; }
      } else {
        this.phase = this.reduced ? (elapsed >= 1400 ? 'reveal' : 'egg')
          : elapsed >= hatchTiming.reveal ? 'reveal' : elapsed >= hatchTiming.bloom ? 'bloom' : elapsed >= hatchTiming.shake ? 'shake' : 'egg';
      }
    }
    this.placeOrdinary(now);
    if (this.paged) {
      if (this.pageDue !== null && now >= this.pageDue && !this.hatch) {
        this.pageDue = null; this.leavingUntil = now + (this.reduced ? 160 : 280);
      }
      return;
    }
    if (this.hatch) return;
    if (this.movingUntil !== null) {
      if (now < this.movingUntil) return;
      this.movingUntil = null;
      const id = this.cells[4]; const free = perimeter.find(index => !this.cells[index]);
      if (id && free !== undefined) { this.cells[free] = id; this.cells[4] = null; this.rotate(id); }
      this.beginHatch(now); return;
    }
    if (!this.pending.length) return;
    if (!this.cells[4]) this.beginHatch(now);
    else if (perimeter.some(index => !this.cells[index]) && this.completedAt !== null && now >= this.completedAt + 2000) this.movingUntil = now + (this.reduced ? 160 : 280);
  }
  nextWake(now: number): number | null {
    const deadlines = [this.pageDue, this.movingUntil, this.leavingUntil, this.enteringUntil];
    if (this.hatch) {
      const times = this.reduced ? [1400, 1850] : Object.values(hatchTiming);
      deadlines.push(...times.map(value => this.hatch!.started + value).filter(value => value > now));
    } else if (!this.paged && this.pending.length && this.completedAt !== null && this.movingUntil === null) deadlines.push(this.completedAt + 2000);
    const next = deadlines.filter((value): value is number => value !== null && value > now);
    return next.length ? Math.min(...next) : null;
  }
  /** Suspend decorative choreography, not server-owned expiration, while hidden. */
  shiftTime(by: number) {
    if (this.hatch) this.hatch.started += by;
    for (const key of ['completedAt', 'movingUntil', 'leavingUntil', 'enteringUntil', 'pageDue'] as const) if (this[key] !== null) this[key]! += by;
  }
}
