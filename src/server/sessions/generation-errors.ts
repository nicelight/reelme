/** Public generation messages are fixed; provider details stay in server logs. */
export const generationMessages = {
  INPUT_PREPARATION_FAILED: 'Не удалось подготовить фотографии или материалы сюжета. Обратитесь к сотруднику.',
  FAL_NOT_CONFIGURED: 'Сервис генерации не настроен. Обратитесь к сотруднику.',
  FAL_REJECTED: 'Сервис отклонил запрос генерации. Обратитесь к сотруднику.',
  FAL_FAILED: 'Не удалось создать видео. Обратитесь к сотруднику.',
  INVALID_RESULT: 'Сервис вернул непригодное видео. Обратитесь к сотруднику.',
  RESULT_GONE: 'Готовое видео больше недоступно у сервиса генерации. Обратитесь к сотруднику.',
  GENERATION_RETRY: 'Обработка временно недоступна. Сервер повторит текущий шаг.',
};

export class GenerationFailure extends Error {
  constructor(readonly code: keyof typeof generationMessages, message: string, options?: ErrorOptions) { super(message, options); }
}
