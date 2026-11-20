import { z } from 'zod';

const count = z.number().int().nonnegative().safe();
const label = z.string().max(160);
const problem = z.strictObject({ name: label, message: label });
const steps = ['baseline', 'command', 'poll', 'wait', 'download', 'verify', 'decode', 'done'] as const;
const requestStats = z.strictObject({
  count, completed: count, firstMs: count, lastMs: count, maxMs: count,
  lastDurationMs: count.optional(), headersMs: count.optional(), bodyMs: count.optional(), status: count.optional(), type: label.optional(),
  expectedBytes: count.optional(), bytes: count.optional(), phase: z.enum(['request','headers','body','parse','complete']),
});
const listStats = z.strictObject({
  total: count, jpeg: count, duplicatePaths: count, raw: count, other: count, invalidPath: count,
  newPaths: count, removedPaths: count, freshJpeg: count,
  added: z.array(z.strictObject({ tag: count, extension: z.string().max(10),
    reason: z.enum(['accepted','reserved-character','unexpected-path','not-jpeg']) })).max(6),
});
const preview = z.strictObject({
  open: z.enum(['starting','accepted','failed']), openMs: count.optional(), openStatus: count.optional(),
  frames: count, lastFrameAgeMs: count.optional(), stop: z.enum(['none','operator','error','hidden','shutter','unmount']),
  error: problem.optional(), status: count.optional(),
});
const sample = z.strictObject({ atMs: count, list: listStats });
const base = z.strictObject({
  id: z.uuid(), caseId: z.uuid(), installation: z.uuid(), pose: count.max(7), attempt: count.min(1),
  at: z.iso.datetime(), offsetMinutes: z.number().int().min(-840).max(840),
});
const attempt = base.extend({
  kind: z.literal('attempt'), outcome: z.enum(['ok','error','aborted','pagehide']),
  elapsedMs: count, budgetMs: count, sinceCaseMs: count, sinceLastShutterMs: count.optional(),
  sinceLastSuccessMs: count.optional(), sessionAgeMs: count,
  mode: z.enum(['manual','automatic']), command: z.enum(['Capture','LiveView_Capture','resume']),
  stage: z.enum(steps), pending: z.boolean(), error: problem.optional(),
  abort: z.enum(['timeout','lifecycle']).optional(), build: label, browser: label, navigation: label,
  visibility: z.array(z.strictObject({ at: z.iso.datetime(), hidden: z.boolean() })).max(12),
  preview, requests: z.partialRecord(z.enum(['baseline','command','poll','download']), requestStats),
  baseline: listStats.optional(), changes: z.array(sample).max(12), listChanges: count,
  foundMs: count.optional(), remainingMs: count.optional(), fileTag: count.optional(),
  stageMs: z.partialRecord(z.enum(steps), count).optional(),
  shutterAt: z.iso.datetime().optional(), shutterToFoundMs: count.optional(), sinceShutterMs: count.optional(),
  retryDelayMs: count.optional(), countdownMs: count.optional(),
  signatureOk: z.boolean().optional(), decoded: z.boolean().optional(),
});
const dcc = base.extend({
  kind: z.literal('camera-settings'), trigger: z.enum(['start','error']), elapsedMs: count,
  values: z.strictObject({
    lastCaptured: label.optional(), sameSession: z.boolean().optional(), transfer: label.optional(),
    compression: label.optional(), shutterSpeed: label.optional(), focus: label.optional(),
    cameraModel: label.optional(), delay: label.optional(), captureCount: label.optional(), autofocus: label.optional(),
  }), unavailable: z.array(label).max(16),
});
export const captureReportSchema = z.discriminatedUnion('kind', [attempt, dcc]);
export type AttemptReport = z.infer<typeof attempt>;
export type CaptureReport = z.infer<typeof captureReportSchema>;
export type DccReport = z.infer<typeof dcc>;
export type ListStats = z.infer<typeof listStats>;
export type RequestStats = z.infer<typeof requestStats>;
