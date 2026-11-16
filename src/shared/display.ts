/** Safe operator display projection. Server times own visibility; no email address,
 * provider details or download capability may cross this boundary. */
export interface DisplaySession {
  id: string;
  number: number;
  stage: number;
  label: string;
  error: string | null;
  hideAt: number | null;
  readyAt: number | null;
  simulation: { status: 'pending' | 'passed' | 'failed'; message: string; detail: string | null } | null;
  card: { photoUrl: string; frameUrl: string; qrUrl: string } | null;
}
export const pageDurationOptions = [10, 20, 30, 40, 50, 60] as const;
export type PageDurationSeconds = typeof pageDurationOptions[number];
export interface DisplaySettings { pageDurationSeconds: PageDurationSeconds }
export interface TodayDisplay extends DisplaySettings { date: string; serverNow: number; sessions: DisplaySession[] }
export const stageLabels = [
  'Съёмка', 'Отправка на генерацию', 'Генерация', 'Подготовка для скачивания',
  'Видео ждёт скачивания', 'Видео в процессе получения клиентом',
] as const;
