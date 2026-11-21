/** Guest messages are fixed. Staff history can include a bounded fal explanation. */
export const generationMessages = {
  INPUT_PREPARATION_FAILED: 'Не удалось подготовить фотографии или материалы сюжета. Обратитесь к сотруднику.',
  TEMPLATE_UPLOAD_FAILED: 'Не удалось загрузить материал сюжета в сервис генерации после нескольких попыток. Обратитесь к сотруднику.',
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

type ProviderBody = { detail?: unknown; error?: unknown; message?: unknown };
type ValidationIssue = { msg?: unknown; loc?: unknown; input?: unknown };

// A validation location may contain user-supplied keys. Only expose model parameter names.
const modelFields = new Set(['video_url', 'reference_image_urls', 'image_urls', 'elements', 'prompt',
  'resolution', 'duration', 'aspect_ratio', 'prompt_expansion_mode', 'frontal_image_url']);

export function falHistoryReason(error: unknown, secret?: string, prompt?: string) {
  const cause = error instanceof GenerationFailure ? error.cause : error;
  if (!cause || typeof cause !== 'object') return {};
  // SDK HTTP errors carry the decoded response in body. A failed queue status
  // or an unsuccessful result may itself be the provider response.
  const body = ('body' in cause ? cause.body : cause) as ProviderBody | undefined;
  if (body instanceof Error) return {};
  if (!body || typeof body !== 'object') return {};
  const detail = body.detail;
  const issue: ValidationIssue | undefined = Array.isArray(detail) ? detail[0] : undefined;
  const reason = issue?.msg ?? (typeof detail === 'string' ? detail : body.error ?? body.message);
  if (typeof reason !== 'string') return {};
  const text = reason.trim();
  // Keep short diagnostic prose; discard messages containing echoed input,
  // credentials, addresses, structured dumps, paths or multiple lines.
  if (!text || text.length > 320 || [secret, prompt, issue?.input].some(value => typeof value === 'string' && value && text.includes(value))) return {};
  const hasDumpOrPath = /[\p{Cc}\p{Cf}@\\{}<>=`]|:\/\/|(?:^|[\s('"=:])\/|\b(?:data|file):|\bMozilla\/\d/iu;
  const hasAddress = /\b(?:[\w-]+\.)+[a-z]{2,}\b|\b(?:\d{1,3}\.){3}\d{1,3}\b|::|(?:[\da-f]+:){3}/i;
  const hasCredential = /\bBearer\s+\S+|\bKey\s+(?!is\b|was\b)\S+|\b(?:Authorization|Cookie|api[_ -]?key|token|secret|password)\s*[:=]|[\w-]{32}/i;
  if (hasDumpOrPath.test(text) || hasAddress.test(text) || hasCredential.test(text)) return {};
  const field = Array.isArray(issue?.loc) && issue.loc[0] === 'body' ? issue.loc[1] : undefined;
  return { providerReason: text, providerField: typeof field === 'string' && modelFields.has(field) ? field : undefined };
}
