/** Safe operator display projection. Server times own visibility; no email address,
 * provider details or download capability may cross this boundary. */
export interface DisplaySession {
  id: string;
  number: number;
  stage: number;
  label: string;
  error: string | null;
  hideAt: number | null;
  card: { photoUrl: string; frameUrl: string; qrUrl: string } | null;
}
export interface TodayDisplay { date: string; serverNow: number; sessions: DisplaySession[] }
export const stageLabels = [
  'Съёмка', 'Отправка на генерацию', 'Генерация', 'Подготовка для скачивания',
  'Видео ждёт скачивания', 'Видео в процессе получения клиентом',
] as const;
