// In the browser, use the same-origin proxy (/api-proxy) to avoid CORS
// and cross-origin cookie issues. On the server (SSR), call the API directly.
const API_URL =
  typeof window !== 'undefined'
    ? '/api-proxy'
    : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface AuthResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    lastName?: string | null;
    phone?: string | null;
    role: 'admin' | 'student';
    mustChangePassword: boolean;
    avatarUrl?: string | null;
    questionnaireCompleted?: boolean;
    // Только у студента: недостающие ОБЯЗАТЕЛЬНЫЕ согласия (зарегистрирован до
    // их появления). Пусто/нет поля = всё дано, гейт /consents не нужен.
    pendingConsents?: ConsentType[];
  };
}

function translateNetworkError(err: unknown): string {
  if (!(err instanceof Error)) return 'Неизвестная ошибка';
  const msg = err.message.toLowerCase();
  if (msg.includes('failed to fetch') || msg.includes('networkerror'))
    return 'Не удалось подключиться к серверу. Проверьте интернет-соединение или попробуйте позже.';
  if (msg.includes('timeout') || msg.includes('aborted'))
    return 'Превышено время ожидания ответа от сервера. Попробуйте позже.';
  if (msg.includes('json'))
    return 'Сервер вернул некорректный ответ. Попробуйте позже или обратитесь в поддержку.';
  return err.message;
}

// Ошибка API с HTTP-статусом: когда вызывающему коду важно различать причины
// (например, 404 «нет такого документа» против сетевой ошибки с ретраем).
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const HTTP_STATUS_MESSAGES: Record<number, string> = {
  400: 'Некорректный запрос',
  401: 'Необходима авторизация',
  403: 'Доступ запрещён',
  404: 'Ресурс не найден',
  409: 'Конфликт данных',
  422: 'Ошибка валидации данных',
  429: 'Слишком много запросов. Подождите немного.',
  500: 'Внутренняя ошибка сервера',
  502: 'Сервер временно недоступен',
  503: 'Сервис временно недоступен',
};

// --- Авто-обновление access-токена при 401 -----------------------------------
// AuthProvider регистрирует колбэки: onToken — сохранить новый токен в контексте,
// onFail — разлогинить (refresh не удался).
type AuthHandlers = { onToken: (token: string) => void; onFail: () => void };
let authHandlers: AuthHandlers | null = null;
export function registerAuthHandlers(handlers: AuthHandlers | null): void {
  authHandlers = handlers;
}

// Общий промис обновления — чтобы параллельные 401 не дёргали refresh многократно.
let refreshInFlight: Promise<string | null> | null = null;
function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { accessToken?: string };
        const token = data?.accessToken ?? null;
        if (token) authHandlers?.onToken(token);
        return token;
      } catch {
        return null;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retryOn401 = true,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  } catch (err) {
    throw new Error(translateNetworkError(err));
  }

  // Истёк access-токен → тихо обновляем его и повторяем запрос один раз.
  // Сами /auth/* не ретраим, чтобы не зациклить refresh/логин.
  if (res.status === 401 && retryOn401 && !path.startsWith('/auth/')) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return request<T>(
        path,
        { ...options, headers: { ...options.headers, Authorization: `Bearer ${newToken}` } },
        false,
      );
    }
    authHandlers?.onFail();
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error(HTTP_STATUS_MESSAGES[res.status] || `Ошибка сервера (${res.status})`);
  }

  if (!res.ok) {
    // Серверный гейт согласий (issue #119): студент с недоданными обязательными
    // согласиями получает 403 CONSENTS_REQUIRED на любой «рабочий» запрос.
    // Ловит старые вкладки, где user в контексте ещё без pendingConsents:
    // уводим на /consents жёсткой навигацией (страница сама перечитает user
    // через /auth/refresh). Ошибку всё равно бросаем — вызывающий код не должен
    // получить undefined вместо данных.
    if (
      res.status === 403 &&
      data.code === 'CONSENTS_REQUIRED' &&
      typeof window !== 'undefined' &&
      !window.location.pathname.startsWith('/consents') &&
      !window.location.pathname.startsWith('/login')
    ) {
      window.location.assign('/consents');
    }
    const serverMsg = typeof data.error === 'string' ? data.error : null;
    const fallback = HTTP_STATUS_MESSAGES[res.status] || `Ошибка запроса (${res.status})`;
    throw new ApiError(serverMsg || fallback, res.status);
  }
  return data as T;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function refresh(): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/refresh', { method: 'POST' });
}

export async function logout(): Promise<void> {
  await request('/auth/logout', { method: 'POST' });
}

export async function changePassword(
  accessToken: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ accessToken: string; message: string }> {
  return request('/auth/change-password', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export interface MeUser {
  id: string;
  email: string;
  name: string;
  lastName: string | null;
  phone: string | null;
  role: 'admin' | 'student';
  isActive: boolean;
  mustChangePassword: boolean;
  avatarUrl?: string | null;
  createdAt: string;
}

// Самостоятельное обновление профиля текущего пользователя.
// При смене пароля сервер возвращает новый accessToken (старые сессии инвалидируются).
// lastName/phone — nullable: пустая строка очищает поле.
export async function updateMe(
  accessToken: string,
  data: {
    name?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    currentPassword?: string;
    newPassword?: string;
  },
): Promise<{ user: MeUser; accessToken?: string }> {
  return request('/users/me', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

// Загрузка аватара текущего пользователя (PNG/JPEG/WebP). Возвращает подписанный
// временный URL загруженного аватара.
export async function uploadMyAvatar(
  accessToken: string,
  file: File,
): Promise<{ avatarUrl: string }> {
  const formData = new FormData();
  formData.append('file', file);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/users/me/avatar`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
  } catch (err) {
    throw new Error(translateNetworkError(err));
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error(HTTP_STATUS_MESSAGES[res.status] || `Ошибка загрузки файла (${res.status})`);
  }

  if (!res.ok) {
    const serverMsg = typeof data.error === 'string' ? data.error : null;
    throw new Error(serverMsg || 'Ошибка загрузки файла');
  }
  return data as { avatarUrl: string };
}

// Удаление аватара текущего пользователя.
export async function deleteMyAvatar(
  accessToken: string,
): Promise<{ avatarUrl: null }> {
  return request('/users/me/avatar', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function resetPassword(
  token: string,
  password: string,
): Promise<{ message: string }> {
  return request('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

// Активация аккаунта по инвайту. Вместе с паролем участник передаёт фамилию,
// телефон и юридические согласия (фиксируются на сервере с IP и версией документа).
export async function acceptInvite(
  token: string,
  password: string,
  data?: { lastName?: string; phone?: string; consents?: ConsentType[] },
): Promise<{ message: string }> {
  return request('/auth/accept-invite', {
    method: 'POST',
    body: JSON.stringify({ token, password, ...data }),
  });
}

export async function verifyEmail(token: string): Promise<{ message: string }> {
  return request('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

// --- Публичные юридические документы (без авторизации) -----------------------

export interface PublicLegalDocumentSummary {
  slug: string;
  title: string;
  // null — версии ещё не опубликованы (документ «готовится к публикации»).
  currentVersion: { versionNumber: number; publishedAt: string } | null;
}

export interface PublicLegalDocument {
  slug: string;
  title: string;
  versionNumber: number | null;
  publishedAt: string | null;
  // markdown-текст актуальной версии; null — версий ещё нет.
  body: string | null;
}

export async function getPublicLegalDocuments(): Promise<{
  documents: PublicLegalDocumentSummary[];
}> {
  return request('/public/legal');
}

export async function getPublicLegalDocument(
  slug: string,
): Promise<{ document: PublicLegalDocument }> {
  return request(`/public/legal/${encodeURIComponent(slug)}`);
}

// --- Юридические согласия пользователя ---------------------------------------

// Тип согласия — зеркало enum ConsentType бэкенда.
export type ConsentType =
  | 'offer'
  | 'personalData'
  | 'personalDataPolicy'
  | 'serviceNotifications'
  | 'marketing';
export type ConsentAction = 'granted' | 'revoked';

export const CONSENT_TYPE_LABELS: Record<ConsentType, string> = {
  offer: 'Условия оферты',
  personalData: 'Обработка персональных данных',
  personalDataPolicy: 'Политика обработки персональных данных',
  serviceNotifications: 'Сервисные уведомления',
  marketing: 'Рекламно-информационные материалы',
};

export const CONSENT_ACTION_LABELS: Record<ConsentAction, string> = {
  granted: 'Дано',
  revoked: 'Отозвано',
};

// Запись append-only журнала согласий (новые сверху).
export interface UserConsent {
  id: string;
  consentType: ConsentType;
  action: ConsentAction;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  // Документ и номер его версии, к которым привязано согласие.
  document: { slug: string; title: string; versionNumber: number };
}

// История СВОИХ согласий (любой аутентифицированный пользователь).
export async function getMyConsents(
  accessToken: string,
): Promise<{ consents: UserConsent[] }> {
  return request('/users/me/consents', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Дать/отозвать согласие на рекламные рассылки (append-запись;
// 409, если документ marketing-consent ещё не опубликован).
export async function setMarketingConsent(
  accessToken: string,
  granted: boolean,
): Promise<{ consent: { id: string; consentType: ConsentType; action: ConsentAction; createdAt: string } }> {
  return request('/users/me/consents/marketing', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ granted }),
  });
}

// Зафиксировать согласия текущего пользователя (гейт /consents для студентов,
// зарегистрированных до появления согласий; можно включить опциональный marketing).
// Возвращает список оставшихся недоданных обязательных согласий (в норме []).
export async function grantMyConsents(
  accessToken: string,
  consents: ConsentType[],
): Promise<{ pendingConsents: ConsentType[] }> {
  return request('/users/me/consents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ consents }),
  });
}

// История согласий ученика (admin).
export async function getUserConsents(
  accessToken: string,
  userId: string,
): Promise<{ consents: UserConsent[] }> {
  return request(`/users/${userId}/consents`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Очистка журнала согласий ДЕМО-аккаунта (admin): при следующем входе студент
// снова пройдёт экран обязательных согласий. Для реальных аккаунтов бэкенд
// отвечает 403, для несуществующих — 404.
export async function deleteUserConsents(
  accessToken: string,
  userId: string,
): Promise<{ deleted: number }> {
  return request(`/users/${userId}/consents`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Streams API

// Тип оплаты группы: разовая (priceKopecks) или ежемесячная менторская
// (monthlyPriceKopecks + billingDayOfMonth). По умолчанию на бэке — one_time.
export type StreamBillingType = 'one_time' | 'monthly';

export const BILLING_TYPE_LABELS: Record<StreamBillingType, string> = {
  one_time: 'Разовая',
  monthly: 'Ежемесячная',
};

export interface Stream {
  id: string;
  name: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  teachers?: { id: string; name: string }[];
  shared?: boolean;
  // Платёжный план группы: стоимость участия в КОПЕЙКАХ (UI показывает рубли).
  // null = план не задан (начисления по группе не делаются).
  priceKopecks?: number | null;
  // Тип оплаты группы. Для 'monthly' значимы monthlyPriceKopecks и billingDayOfMonth.
  billingType?: StreamBillingType;
  // Ежемесячная сумма списания (КОПЕЙКИ, целое ≥0) для менторских групп или null.
  monthlyPriceKopecks?: number | null;
  // День месяца списания (1..28) для менторских групп или null.
  billingDayOfMonth?: number | null;
  // Внешняя ссылка на оплату (вставляет админ вручную). null/нет = ссылка не задана.
  // Студент видит кнопку «Оплатить» по этой ссылке для своих активных групп.
  paymentUrl?: string | null;
  // Ведущий потока (явный владелец): питает фильтр «мои» и атрибуцию.
  ownerId?: string | null;
  owner?: { id: string; name: string } | null;
  // Программа потока (новая модель): поток — это набор сессий по программе.
  programId?: string | null;
  program?: { id: string; name: string; type: string } | null;
}

export async function getStreams(
  accessToken: string,
  options?: { mine?: boolean },
): Promise<{ streams: StreamWithCounts[] }> {
  const qs = options?.mine ? '?mine=true' : '';
  return request(`/streams${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function createStream(
  accessToken: string,
  name: string,
  // Опционально: платёжный план группы. Разовая — priceKopecks; ежемесячная —
  // billingType: 'monthly' + monthlyPriceKopecks + billingDayOfMonth (1..28).
  billing?: {
    priceKopecks?: number | null;
    billingType?: StreamBillingType;
    monthlyPriceKopecks?: number | null;
    billingDayOfMonth?: number | null;
    // Внешняя ссылка на оплату (http/https) или null/'' = очистить.
    paymentUrl?: string | null;
  },
): Promise<{ stream: Stream }> {
  return request('/streams', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name, ...billing }),
  });
}

export async function updateStream(
  accessToken: string,
  id: string,
  data: {
    name?: string;
    ownerId?: string | null;
    programId?: string | null;
    // Платёжный план группы в копейках (целое ≥0) или null = снять план (разовая).
    priceKopecks?: number | null;
    // Тип оплаты группы: разовая или ежемесячная (менторская).
    billingType?: StreamBillingType;
    // Ежемесячная сумма списания (КОПЕЙКИ, целое ≥0) или null = снять.
    monthlyPriceKopecks?: number | null;
    // День месяца списания (1..28) или null = снять.
    billingDayOfMonth?: number | null;
    // Внешняя ссылка на оплату (http/https) или null/'' = очистить ссылку.
    paymentUrl?: string | null;
  },
): Promise<{ stream: Stream }> {
  return request(`/streams/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

export async function archiveStream(
  accessToken: string,
  id: string,
): Promise<{ stream: Stream }> {
  return request(`/streams/${id}/archive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Полное удаление потока (необратимо): зачисления, расписание занятий и чаты
// потока удаляются каскадом на стороне БД. Уроки-блоки (Lesson) сохраняются.
export async function deleteStream(
  accessToken: string,
  id: string,
): Promise<{ message: string }> {
  return request(`/streams/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export interface StreamWithCounts extends Stream {
  studentsCount: number;
  lessonsCount: number;
}

export async function getStream(
  accessToken: string,
  id: string,
): Promise<{ stream: StreamWithCounts }> {
  return request(`/streams/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function getStreamStudents(
  accessToken: string,
  streamId: string,
): Promise<{ students: Student[] }> {
  return request(`/streams/${streamId}/students`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function enrollStudents(
  accessToken: string,
  streamId: string,
  studentIds: string[],
): Promise<{ students: Student[] }> {
  return request(`/streams/${streamId}/students`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ studentIds }),
  });
}

export async function unenrollStudent(
  accessToken: string,
  streamId: string,
  studentId: string,
): Promise<{ success: boolean }> {
  return request(`/streams/${streamId}/students/${studentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// --- Инвайт-ссылка в поток ---------------------------------------------------

export interface StreamJoinLink {
  token: string;
  joinUrl: string;
}

// Получить инвайт-ссылку потока. Идемпотентно: если ссылка уже есть — вернёт её,
// иначе сгенерирует и вернёт (POST).
export async function getStreamJoinLink(
  accessToken: string,
  streamId: string,
): Promise<StreamJoinLink> {
  return request(`/streams/${streamId}/join-link`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Перевыпустить инвайт-ссылку: старая ссылка инвалидируется, возвращается новая (DELETE).
export async function regenerateStreamJoinLink(
  accessToken: string,
  streamId: string,
): Promise<StreamJoinLink> {
  return request(`/streams/${streamId}/join-link`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// --- Публичное вступление по ссылке (без авторизации) ------------------------

export interface PublicJoinStream {
  // Имя потока и флаг закрытого набора (true для архивного потока).
  name: string;
  closed: boolean;
}

// Превью потока по инвайт-токену (публично, без авторизации).
export async function getPublicJoinStream(
  token: string,
): Promise<{ stream: PublicJoinStream }> {
  return request(`/public/streams/join/${token}`);
}

// Регистрация участника по инвайт-ссылке (публично, без авторизации).
// Создаёт аккаунт, зачисляет на поток и сразу выдаёт сессию (accessToken + cookie).
// consents — юридические согласия; фиксируются на сервере с IP и версией документа.
export async function joinStreamByToken(
  token: string,
  data: {
    email: string;
    name: string;
    password: string;
    lastName?: string;
    phone?: string;
    consents?: ConsentType[];
  },
): Promise<AuthResponse> {
  return request<AuthResponse>(`/public/streams/join/${token}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Users (Students) API

export interface Student {
  id: string;
  email: string;
  name: string;
  lastName?: string | null;
  phone?: string | null;
  role: 'student' | 'admin';
  isActive: boolean;
  createdAt: string;
  inviteToken?: string | null;
  inviteExpiresAt?: string | null;
  deletedAt?: string | null;
  submittedCount?: number;
  // Баланс кошелька в копейках (UI отображает в рублях).
  balanceKopecks?: number;
  // Демо/служебный аккаунт: не платит и не учитывается в статистике.
  // Приходит в /users и ростере группы (/streams/:id/students).
  isDemo?: boolean;
}

export async function getStudents(
  accessToken: string,
  search?: string,
): Promise<{ users: Student[] }> {
  const params = search ? `?search=${encodeURIComponent(search)}` : '';
  return request(`/users${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function createStudent(
  accessToken: string,
  email: string,
  name: string,
  // Опциональные фамилия и телефон (согласия при создании админом НЕ собираются —
  // участник даст их сам при активации инвайта).
  extra?: { lastName?: string; phone?: string },
): Promise<{ user: Student }> {
  return request('/users', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ email, name, ...extra }),
  });
}

export async function updateStudent(
  accessToken: string,
  id: string,
  // isDemo (admin): помечает аккаунт демо/служебным — он не платит и не в статистике.
  // lastName/phone — nullable: пустая строка очищает поле.
  data: {
    name?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    isActive?: boolean;
    isDemo?: boolean;
  },
): Promise<{ user: Student }> {
  return request(`/users/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

export async function deleteStudent(
  accessToken: string,
  id: string,
): Promise<{ user: Student }> {
  return request(`/users/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function inviteStudent(
  accessToken: string,
  id: string,
): Promise<{ inviteUrl: string; expiresAt: string }> {
  return request(`/users/${id}/invite`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function resetStudentPassword(
  accessToken: string,
  id: string,
): Promise<{ tempPassword: string; message: string }> {
  return request(`/users/${id}/reset-password`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Teachers (admins) API

export interface Teacher {
  id: string;
  name: string;
  email: string;
}

export async function getTeachers(
  accessToken: string,
): Promise<{ teachers: Teacher[] }> {
  return request('/teachers', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Lessons API

// Учебный материал урока — только PDF/MD. url — подписанная временная ссылка
// (приходит с бэка), s3Key — постоянный ключ файла в хранилище.
export interface LessonMaterial {
  s3Key: string;
  fileName: string;
  mimeType: string;
  size: number;
  url?: string;
  // Видимость по потокам: null/отсутствует = общий метод (виден всем потокам),
  // задан = только студентам этого потока.
  streamId?: string | null;
}

// Одно видео урока: kind различает загруженный файл и внешнюю ссылку,
// url — подписанный временный URL файла или внешняя ссылка как есть.
export interface LessonVideo {
  id: string;
  title: string | null;
  kind: 'file' | 'link';
  url: string;
  sortOrder: number;
  // Видимость по потокам: null/отсутствует = общий метод (виден всем потокам),
  // задан = только студентам этого потока.
  streamId?: string | null;
}

/** Добавляет download=1 к подписанному URL файла для форс-скачивания (вложением). */
export function fileDownloadUrl(url: string): string {
  if (!url) return url;
  return `${url}${url.includes('?') ? '&' : '?'}download=1`;
}

/**
 * Превращает абсолютный подписанный URL файла (`${API_BASE_URL}/files/...?exp&sig`)
 * в SAME-ORIGIN путь через `/api-proxy`, чтобы файл можно было получить через
 * `fetch()` без CORS. Бэк отдаёт файловые URL абсолютными (кросс-доменными):
 * <a href>/<video>/<img> ходят по ним без CORS, но `fetch(...).text()` (например
 * предпросмотр .md) требует CORS и падает с другого origin. В браузере переписываем
 * путь на `/api-proxy/files/...` (тот же прокси, через который идут все API-вызовы —
 * см. `API_URL` выше); на сервере (SSR) и для уже-относительных путей возвращаем как есть.
 */
export function toProxiedFileUrl(url: string): string {
  if (!url || typeof window === 'undefined') return url;
  try {
    // Файлы отдаём SAME-ORIGIN по пути /files/... : на проде Caddy шлёт /files → api,
    // в dev — rewrite в next.config. Берём path+query из подписанного URL и
    // запрашиваем same-origin — так нет CORS (для fetch .md) и не нужен хрупкий
    // /api-proxy (он на проде не доносил /api-proxy/files/... до Next → 404).
    const parsed = new URL(url, window.location.origin);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/** Удалить ВСЕ загруженные файлы и обнулить ссылки на них (только admin). Необратимо. */
export async function purgeAllFiles(accessToken: string): Promise<{
  deletedFiles: number;
  clearedLessonVideos: number;
  clearedLessonMaterials: number;
  // Видеозаписи теперь живут на сессиях потока (новая модель), отдельно от материалов.
  clearedSessionVideos: number;
  clearedSubmissionFiles: number;
  deletedFileMessages: number;
}> {
  return request('/admin/files', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Статус урока: Черновик · Запланирован · Проведён · Отменён.
// Черновик скрыт от учеников; статус управляет видимостью.
// 'live' = «Идёт» — занятие в эфире (между Zoom meeting.started и meeting.ended).
// Системный статус: ставится автоматически бэком, вручную не выбирается.
export type LessonStatus = 'draft' | 'planned' | 'live' | 'done' | 'cancelled';

export const LESSON_STATUS_LABELS: Record<LessonStatus, string> = {
  draft: 'Черновик',
  planned: 'Запланирован',
  live: 'Идёт',
  done: 'Проведён',
  cancelled: 'Отменён',
};

export type AssignmentType = 'short' | 'long';

export interface Lesson {
  id: string;
  // Опционально: сервер опускает streamId в режиме «Все потоки»/копилка
  // (урок-шаблон без привязки к конкретному потоку).
  streamId?: string;
  title: string;
  videoUrl: string | null;
  // Ключ загруженной видеозаписи в хранилище (отдельно от внешней ссылки videoUrl).
  videoKey?: string | null;
  // Подписанный временный URL загруженного видео (для встроенного плеера) или null.
  videoFileUrl?: string | null;
  // Несколько видео урока (аддитивно к одиночным videoUrl/videoFileUrl).
  videos?: LessonVideo[];
  summary: string | null;
  notes: string | null;
  status: LessonStatus;
  // Дата занятия "YYYY-MM-DD" (или null, если урок ещё не назначен на дату).
  date: string | null;
  // Время начала "HH:MM" (или null).
  startTime: string | null;
  // Ссылка на созвон (или null).
  meetingUrl: string | null;
  sortOrder: number;
  materials?: LessonMaterial[];
  createdAt: string;
  updatedAt: string;
  teachers?: { id: string; name: string }[];
  // Поток урока (для режима «Все потоки» на странице уроков).
  stream?: { id: string; name: string };
  // Свёрнутое в блок задание (folded assignment) — есть у блоков-уроков копилки.
  hasAssignment?: boolean;
  assignmentTitle?: string | null;
  assignmentDescription?: string | null;
  assignmentCriteria?: string | null;
  assignmentType?: AssignmentType | null;
  assignmentTags?: string[];
  assignmentMaterials?: AssignmentMaterial[];
  // Автосбор записи/итогов Zoom (Волна 2). Поля проецируются из Session занятия;
  // вне потока или без созвона Zoom — null/отсутствуют.
  // recordingStatus: none | pending | processing | ready | failed.
  recordingStatus?: string | null;
  // Текст ошибки автозагрузки записи (для показа в UI), если recordingStatus = 'failed'.
  recordingError?: string | null;
  // Запись Zoom-занятия — разведена с учебным видео урока (videos/videoUrl/videoFileUrl).
  // Учебное видео грузится ДО урока (из блока), запись подтягивается ПОСЛЕ занятия (из Session).
  // recordingVideoKey — ключ загруженной записи в хранилище;
  // recordingVideoUrl — внешняя ссылка на запись; recordingFileUrl — подписанный URL файла записи.
  recordingVideoKey?: string | null;
  recordingVideoUrl?: string | null;
  recordingFileUrl?: string | null;
  // Источник итогов занятия: 'zoom_ai' (AI Companion) | 'manual' (ввёл преподаватель).
  summarySource?: string | null;
  // Статус формирования итогов Zoom AI: none | pending | processing | ready | failed.
  // Виден всем; для студенческой страницы управляет состоянием блока «Итоги».
  summaryStatus?: string | null;
  // Статус/ошибка транскрипта — ОПЦИОНАЛЬНЫ (только в препод/админ-проекции; у студента нет).
  transcriptStatus?: string | null;
  transcriptError?: string | null;
  // Отметки времени запроса данных у Zoom (ISO-строка|null). По ним отличаем
  // «ещё формируется» (свежий запрос → дружелюбное «формируется») от
  // «данных так и нет» (запрос давно → нейтральное «недоступно»).
  // recordingRequestedAt / summaryRequestedAt видны всем; transcriptRequestedAt —
  // только препод/админу (у студента поля нет, как и transcriptStatus).
  recordingRequestedAt?: string | null;
  summaryRequestedAt?: string | null;
  transcriptRequestedAt?: string | null;
}

export async function getLessons(
  accessToken: string,
  streamId?: string,
  options?: { mine?: boolean },
): Promise<{ lessons: Lesson[] }> {
  const params = new URLSearchParams();
  if (streamId) params.set('streamId', streamId);
  if (options?.mine) params.set('mine', 'true');
  const qs = params.toString();
  return request(`/lessons${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function getLesson(
  accessToken: string,
  id: string,
  // Поток, чей контент урока вернуть (студент может состоять в нескольких потоках —
  // без явного streamId бэк брал случайный поток, отсюда баг #158).
  streamId?: string,
): Promise<{ lesson: Lesson & { assignments?: Assignment[] } }> {
  const params = new URLSearchParams();
  if (streamId) params.set('streamId', streamId);
  const qs = params.toString();
  return request(`/lessons/${id}${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function createLesson(
  accessToken: string,
  data: {
    streamId: string;
    title: string;
    videoUrl?: string;
    summary?: string;
    notes?: string;
    status?: LessonStatus;
    date?: string | null;
    startTime?: string | null;
    meetingUrl?: string | null;
    // Если true — бэк создаёт встречу Zoom и вернёт meetingUrl в проекции занятия
    // (или null, если интеграция не настроена/ошибка — без падения запроса).
    generateMeeting?: boolean;
    sortOrder?: number;
    teacherIds?: string[];
    materials?: LessonMaterial[];
  },
): Promise<{ lesson: Lesson }> {
  return request('/lessons', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

export async function updateLesson(
  accessToken: string,
  id: string,
  data: {
    // Поток, чью сессию обновлять (новая модель: расписание урока живёт на
    // пер-поточной Session). Без него поля статуса/даты/времени/ссылки не сохранятся.
    streamId?: string;
    title?: string;
    videoUrl?: string;
    summary?: string;
    notes?: string;
    status?: LessonStatus;
    date?: string | null;
    startTime?: string | null;
    meetingUrl?: string | null;
    // Если true — бэк создаёт встречу Zoom и вернёт meetingUrl в проекции занятия
    // (или null, если интеграция не настроена/ошибка — без падения запроса).
    generateMeeting?: boolean;
    sortOrder?: number;
    teacherIds?: string[];
    materials?: LessonMaterial[];
    // Свёрнутое задание блока (folded assignment) — сохраняется при PATCH без streamId.
    hasAssignment?: boolean;
    assignmentTitle?: string | null;
    assignmentDescription?: string | null;
    assignmentCriteria?: string | null;
    assignmentType?: AssignmentType | null;
    assignmentTags?: string[];
    assignmentMaterials?: AssignmentMaterial[];
  },
): Promise<{ lesson: Lesson }> {
  return request(`/lessons/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

// Загрузка файла-материала урока (PDF/MD). Возвращает обновлённый список материалов.
export async function uploadLessonMaterial(
  accessToken: string,
  lessonId: string,
  file: File,
  // Видимость: задан streamId = только этому потоку; не задан = общий метод.
  streamId?: string | null,
): Promise<{ materials: LessonMaterial[] }> {
  const formData = new FormData();
  formData.append('file', file);

  const qs = streamId ? `?streamId=${encodeURIComponent(streamId)}` : '';

  let res: Response;
  try {
    res = await fetch(`${API_URL}/lessons/${lessonId}/materials${qs}`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
  } catch (err) {
    throw new Error(translateNetworkError(err));
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error(HTTP_STATUS_MESSAGES[res.status] || `Ошибка загрузки файла (${res.status})`);
  }

  if (!res.ok) {
    const serverMsg = typeof data.error === 'string' ? data.error : null;
    throw new Error(serverMsg || 'Ошибка загрузки файла');
  }
  return data as { materials: LessonMaterial[] };
}

// Удаление файла-материала урока по s3Key. Возвращает обновлённый список материалов.
export async function deleteLessonMaterial(
  accessToken: string,
  lessonId: string,
  s3Key: string,
): Promise<{ materials: LessonMaterial[] }> {
  return request(`/lessons/${lessonId}/materials?s3Key=${encodeURIComponent(s3Key)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Загрузка видеозаписи урока (один файл MP4/WebM/MOV). Возвращает обновлённый урок
// с подписанным videoFileUrl. Лимит размера сейчас — общий серверный (50МБ).
export async function uploadLessonVideo(
  accessToken: string,
  lessonId: string,
  file: File,
): Promise<{ lesson: Lesson }> {
  const formData = new FormData();
  formData.append('file', file);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/lessons/${lessonId}/video`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
  } catch (err) {
    throw new Error(translateNetworkError(err));
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error(HTTP_STATUS_MESSAGES[res.status] || `Ошибка загрузки файла (${res.status})`);
  }

  if (!res.ok) {
    const serverMsg = typeof data.error === 'string' ? data.error : null;
    throw new Error(serverMsg || 'Ошибка загрузки файла');
  }
  return data as { lesson: Lesson };
}

// Удаление загруженной видеозаписи урока. Возвращает обновлённый урок.
export async function deleteLessonVideo(
  accessToken: string,
  lessonId: string,
): Promise<{ lesson: Lesson }> {
  return request(`/lessons/${lessonId}/video`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ─── Несколько видео на урок (LessonVideo) — АДДИТИВНО ──────────────────────
// Все мутации возвращают свежий упорядоченный список видео урока { videos }.
// Не путать с легаси uploadLessonVideo/deleteLessonVideo (одиночное видео блока).

// Добавить видео-ФАЙЛ урока (multipart). title — опционально (уйдёт в query).
export async function addLessonVideoFile(
  accessToken: string,
  lessonId: string,
  file: File,
  title?: string,
  // Видимость: задан streamId = только этому потоку; не задан = общий метод.
  streamId?: string | null,
): Promise<{ videos: LessonVideo[] }> {
  const formData = new FormData();
  formData.append('file', file);

  const params = new URLSearchParams();
  if (title) params.set('title', title);
  if (streamId) params.set('streamId', streamId);
  const qs = params.toString() ? `?${params.toString()}` : '';

  let res: Response;
  try {
    res = await fetch(`${API_URL}/lessons/${lessonId}/videos${qs}`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
  } catch (err) {
    throw new Error(translateNetworkError(err));
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error(HTTP_STATUS_MESSAGES[res.status] || `Ошибка загрузки файла (${res.status})`);
  }

  if (!res.ok) {
    const serverMsg = typeof data.error === 'string' ? data.error : null;
    throw new Error(serverMsg || 'Ошибка загрузки файла');
  }
  return data as { videos: LessonVideo[] };
}

// Добавить видео-ССЫЛКУ урока (внешний URL). title — опционально.
export async function addLessonVideoLink(
  accessToken: string,
  lessonId: string,
  url: string,
  title?: string,
  // Видимость: задан streamId = только этому потоку; не задан = общий метод.
  streamId?: string | null,
): Promise<{ videos: LessonVideo[] }> {
  return request(`/lessons/${lessonId}/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ url, title, ...(streamId ? { streamId } : {}) }),
  });
}

// Обновить видео урока: title и/или url (url — только у видео-ссылки) и/или
// видимость streamId (строка = поток, null/'' = сброс в общий, не передан = не менять).
export async function updateLessonVideoItem(
  accessToken: string,
  lessonId: string,
  videoId: string,
  patch: { title?: string | null; url?: string; streamId?: string | null },
): Promise<{ videos: LessonVideo[] }> {
  return request(`/lessons/${lessonId}/videos/${videoId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(patch),
  });
}

// Удалить элемент видео урока. S3-объект при этом не удаляется.
export async function deleteLessonVideoItem(
  accessToken: string,
  lessonId: string,
  videoId: string,
): Promise<{ videos: LessonVideo[] }> {
  return request(`/lessons/${lessonId}/videos/${videoId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Переупорядочить видео урока: orderedIds — желаемый порядок.
export async function reorderLessonVideos(
  accessToken: string,
  lessonId: string,
  orderedIds: string[],
): Promise<{ videos: LessonVideo[] }> {
  return request(`/lessons/${lessonId}/videos/order`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ orderedIds }),
  });
}

export async function deleteLesson(
  accessToken: string,
  id: string,
): Promise<{ message: string }> {
  return request(`/lessons/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ─── Прогресс просмотра видео урока (лог активности студента, Этап A) ────────

// Тело отправки прогресса просмотра НАШЕГО видеофайла урока. intervals — НОВЫЕ
// реально проигранные куски [start,end] (сек) с прошлой отправки; ended — пометка
// завершения (событие ended плеера).
export interface VideoProgressPayload {
  lessonId: string;
  videoId: string;
  streamId: string;
  positionSec: number;
  durationSec: number;
  intervals: [number, number][];
  ended?: boolean;
}

// Серверная сводка прогресса по видео (для будущего UI прогресса).
export interface VideoProgressResult {
  watchedPercent: number;
  watchedSec: number;
  lastPositionSec: number;
  completed: boolean;
}

// URL роута прогресса (для keepalive-fetch при уходе со страницы из хука трекинга,
// где нужен ручной Authorization-заголовок). Тот же base/proxy, что и у request().
export function videoProgressUrl(lessonId: string, videoId: string): string {
  return `${API_URL}/lessons/${lessonId}/videos/${videoId}/progress`;
}

// Отправить накопленный прогресс просмотра видеофайла урока. Фоновая телеметрия —
// вызывающий код сам решает, как реагировать на ошибку (хук её глотает).
export async function sendVideoProgress(
  accessToken: string,
  payload: VideoProgressPayload,
): Promise<VideoProgressResult> {
  const { lessonId, videoId, streamId, positionSec, durationSec, intervals, ended } =
    payload;
  return request(`/lessons/${lessonId}/videos/${videoId}/progress`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ streamId, positionSec, durationSec, intervals, ended }),
  });
}

export type MaterialAccessType = 'viewed' | 'downloaded';

// Зафиксировать обращение студента к материалу урока (просмотр/скачивание).
// Фоновая телеметрия: ошибки сети ГЛОТАЕМ — обращение к файлу не должно зависеть
// от доставки лога. Вешается на onClick соответствующего действия.
export async function trackMaterialAccess(
  accessToken: string,
  lessonId: string,
  payload: { streamId: string; s3Key: string; accessType: MaterialAccessType },
): Promise<void> {
  try {
    await request(`/lessons/${lessonId}/materials/access`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload),
    });
  } catch {
    // no-op: фоновая телеметрия не мешает пользователю.
  }
}

// Занятие урока в конкретном потоке (для блока «Расписание» на странице урока).
export interface LessonSession {
  streamId: string;
  streamName: string;
  streamStatus: 'active' | 'archived';
  status: LessonStatus;
  date: string | null;
  startTime: string | null;
  meetingUrl: string | null;
  // Итоги занятия + автосбор записи Zoom (Волна 2). Поля nullable: для старых
  // занятий и занятий без созвона Zoom — null.
  // recordingStatus: none | pending | processing | ready | failed.
  summary?: string | null;
  summarySource?: string | null;
  recordingStatus?: string | null;
  recordingError?: string | null;
  // Статус формирования итогов Zoom AI: none | pending | processing | ready | failed.
  // Виден ВСЕМ (включая студента) — управляет состоянием блока «Итоги занятия».
  summaryStatus?: string | null;
  // Статус и ошибка транскрипта. ОПЦИОНАЛЬНЫ: бэк отдаёт эти поля ТОЛЬКО
  // админу/преподу урока; у студента их нет вовсе. Наличие transcriptStatus в
  // объекте = признак того, что получатель админ/препод (по нему гейтим блок).
  transcriptStatus?: string | null;
  transcriptError?: string | null;
  // Запись Zoom-занятия (разведена с учебным видео урока): внешняя ссылка
  // (recordingVideoUrl) или подписанный URL загруженного файла (recordingFileUrl).
  recordingFileUrl?: string | null;
  recordingVideoUrl?: string | null;
  // Отметки времени запроса данных у Zoom (ISO-строка|null). По ним отличаем
  // «ещё формируется» (свежий запрос) от «данных так и нет» (запрос давно →
  // нейтральное «недоступно»). recordingRequestedAt / summaryRequestedAt видны
  // всем; transcriptRequestedAt — только препод/админу (у студента поля нет).
  recordingRequestedAt?: string | null;
  summaryRequestedAt?: string | null;
  transcriptRequestedAt?: string | null;
}

// Сохранить ручные итоги КОНКРЕТНОГО занятия потока (Session.summary). Бэк ставит
// summarySource='manual' — автосбор Zoom AI такие итоги не перетирает. Пустая
// строка очищает итоги (на бэке превращается в null). Только admin.
export async function updateLessonSummary(
  accessToken: string,
  lessonId: string,
  streamId: string,
  summary: string,
): Promise<{ lesson: Lesson }> {
  return request(`/lessons/${lessonId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ streamId, summary }),
  });
}

// Аналитика сдач по ЗАНЯТИЮ (Session = lessonId × streamId) для View Mode урока.
// Все счётчики плоские. byStatus — распределение материализованных StudentAssignment
// по статусам; total — всего материализованных назначений; enrolledCount — состав
// потока (знаменатель). submittedCount = submitted+reviewed+needs_revision;
// notSubmittedCount = enrolledCount − submittedCount; pendingReviewCount = submitted.
export interface LessonAnalytics {
  sessionId: string;
  streamId: string;
  enrolledCount: number;
  total: number;
  byStatus: {
    assigned: number;
    submitted: number;
    reviewed: number;
    needs_revision: number;
  };
  submittedCount: number;
  notSubmittedCount: number;
  pendingReviewCount: number;
}

// Получить аналитику сдач по занятию урока в конкретном потоке (только admin).
export async function getLessonAnalytics(
  accessToken: string,
  lessonId: string,
  streamId: string,
): Promise<LessonAnalytics> {
  const qs = new URLSearchParams({ streamId }).toString();
  return request(`/lessons/${lessonId}/analytics?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ── Посещаемость занятия (B5) ───────────────────────────────────────────────

// Одна запись посещаемости. source='zoom_report' — авто-забор из Zoom (matched
// проставлен при сопоставлении по email); source='manual' — ручная отметка
// (всегда привязана к студенту). studentName — имя сопоставленного студента.
export interface SessionAttendanceRecord {
  id: string;
  userId: string | null;
  studentName: string | null;
  source: 'zoom_report' | 'manual';
  status: 'present' | 'absent';
  displayName: string | null;
  email: string | null;
  joinedAt: string | null;
  leftAt: string | null;
  durationSec: number | null;
  matched: boolean;
  // Хост встречи (Zoom-аккаунт преподавателя). Приходит с userId=null,
  // показывается отдельно как преподаватель и не считается гостем.
  isHost: boolean;
}

// Сводка посещаемости занятия. present/absent считаются по уникальным
// сопоставленным студентам (manual приоритетнее zoom_report); несопоставленные
// гости — в unmatchedCount и в records. lastSyncedAt — время последнего zoom-забора.
export interface SessionAttendanceSummary {
  sessionId: string;
  streamId: string;
  enrolledCount: number;
  presentCount: number;
  absentCount: number;
  unmatchedCount: number;
  lastSyncedAt: string | null;
  records: SessionAttendanceRecord[];
}

// Мягкий отказ resync (нет scope / отчёт ещё не готов / нет встречи Zoom).
export type AttendanceResyncResult =
  | ({ ok: true } & SessionAttendanceSummary)
  | { ok: false; reason: string };

// Получить сводку посещаемости занятия урока в потоке (только admin).
export async function getLessonAttendance(
  accessToken: string,
  lessonId: string,
  streamId: string,
): Promise<SessionAttendanceSummary> {
  const qs = new URLSearchParams({ streamId }).toString();
  return request(`/lessons/${lessonId}/attendance?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Перезабрать посещаемость из Zoom. Возвращает свежую сводку (ok:true) либо
// мягкий отказ (ok:false, reason) — UI показывает причину, без ошибки.
export async function resyncLessonAttendance(
  accessToken: string,
  lessonId: string,
  streamId: string,
): Promise<AttendanceResyncResult> {
  return request(`/lessons/${lessonId}/attendance/resync`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ streamId }),
  });
}

// Ручная отметка посещаемости студента. Возвращает обновлённую сводку.
export async function markLessonAttendance(
  accessToken: string,
  lessonId: string,
  params: { streamId: string; userId: string; status: 'present' | 'absent' },
): Promise<SessionAttendanceSummary> {
  return request(`/lessons/${lessonId}/attendance/mark`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(params),
  });
}

// Привязать zoom-гостя к студенту потока либо СБРОСИТЬ привязку. Пустой/отсутствующий
// userId = сброс (запись снова станет несопоставленным гостем). Возвращает сводку.
export async function matchLessonAttendance(
  accessToken: string,
  lessonId: string,
  attendanceId: string,
  params: { streamId: string; userId?: string },
): Promise<SessionAttendanceSummary> {
  return request(`/lessons/${lessonId}/attendance/${attendanceId}/match`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(params),
  });
}

// Список занятий урока по всем потокам (где и когда он запланирован).
export async function getLessonSessions(
  accessToken: string,
  lessonId: string,
): Promise<{ sessions: LessonSession[] }> {
  return request(`/lessons/${lessonId}/sessions`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Снять урок с расписания потока (удалить занятие).
export async function unscheduleLesson(
  accessToken: string,
  lessonId: string,
  streamId: string,
): Promise<{ message: string }> {
  return request(`/lessons/${lessonId}/sessions/${streamId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Повторить автозагрузку записи Zoom для занятия (админ): перезапускает скачивание
// записи, когда recordingStatus = 'failed' или процесс завис. Бэк отвечает 202.
export async function retrySessionRecording(
  accessToken: string,
  lessonId: string,
  streamId: string,
): Promise<{ status: string; message: string }> {
  return request(`/lessons/${lessonId}/sessions/${streamId}/recording/retry`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Результат одного шага единой подтяжки из Zoom: ok + причина неуспеха (если есть).
export interface ZoomRefreshStep {
  ok: boolean;
  reason?: string;
}

// Частичный результат единой ручной подтяжки занятия из Zoom (запись + итоги +
// транскрипт + посещаемость). Каждый шаг независим: какие-то могут получиться,
// какие-то — нет (с reason). Только admin/препод урока.
export interface ZoomRefreshResult {
  recording: ZoomRefreshStep;
  summary: ZoomRefreshStep;
  transcript: ZoomRefreshStep;
  attendance: ZoomRefreshStep;
}

// Единая ручная подтяжка занятия из Zoom: запускает и ДОЖИДАЕТСЯ всех шагов
// (запись/итоги/транскрипт/посещаемость), возвращает частичный результат по каждому.
export async function refreshSessionFromZoom(
  accessToken: string,
  lessonId: string,
  streamId: string,
): Promise<ZoomRefreshResult> {
  return request(`/lessons/${lessonId}/sessions/${streamId}/refresh`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Транскрипт занятия в нужном формате. Возвращает подписанную ссылку на тело
// (url) + статус. Доступно только преподу/админу урока (студенту — 403).
export interface TranscriptResponse {
  format: 'vtt' | 'txt';
  url: string;
  status: string;
}

export async function fetchTranscript(
  accessToken: string,
  lessonId: string,
  streamId: string,
  format: 'vtt' | 'txt',
): Promise<TranscriptResponse> {
  const qs = new URLSearchParams({ format }).toString();
  return request(`/lessons/${lessonId}/sessions/${streamId}/transcript?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Assignments API

export interface AssignmentMaterial {
  type: 'file' | 'url';
  name: string;
  url: string;
  size?: number;
  s3Key?: string;
}

export interface Assignment {
  id: string;
  streamId: string;
  lessonId: string | null;
  title: string;
  description: string | null;
  criteria: string | null;
  type: 'short' | 'long';
  tags: string[];
  dueDate: string | null;
  groupId: string | null;
  materials: AssignmentMaterial[];
  createdAt: string;
  updatedAt: string;
  lesson?: { id: string; title: string } | null;
  stream?: { id: string; name: string };
  _count?: { studentAssignments: number };
}

export type StudentAssignmentStatus = 'assigned' | 'submitted' | 'reviewed' | 'needs_revision';

export interface StudentAssignment {
  id: string;
  assignmentId: string;
  studentId: string;
  status: StudentAssignmentStatus;
  content: string | null;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  fileSignedUrl?: string;
  studentComment: string | null;
  reviewText: string | null;
  reviewedBy: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignment?: Assignment;
  student?: { id: string; name: string; email: string };
}

export async function getAssignments(
  accessToken: string,
  streamId?: string,
): Promise<{ assignments: Assignment[] }> {
  const qs = streamId ? `?streamId=${encodeURIComponent(streamId)}` : '';
  return request(`/assignments${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function getAssignment(
  accessToken: string,
  id: string,
): Promise<{ assignment: Assignment }> {
  return request(`/assignments/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function createAssignment(
  accessToken: string,
  data: {
    streamId: string;
    title: string;
    description?: string;
    criteria?: string | null;
    type?: 'short' | 'long';
    tags?: string[];
    dueDate?: string;
    lessonId?: string;
    materials?: AssignmentMaterial[];
  },
): Promise<{ assignment: Assignment }> {
  return request('/assignments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

export async function updateAssignment(
  accessToken: string,
  id: string,
  data: {
    title?: string;
    description?: string;
    criteria?: string | null;
    type?: 'short' | 'long';
    tags?: string[];
    dueDate?: string | null;
    lessonId?: string | null;
    materials?: AssignmentMaterial[];
  },
): Promise<{ assignment: Assignment }> {
  return request(`/assignments/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

export async function uploadAssignmentMaterial(
  accessToken: string,
  file: File,
): Promise<{ material: AssignmentMaterial }> {
  const formData = new FormData();
  formData.append('file', file);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/assignments/upload-material`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
  } catch (err) {
    throw new Error(translateNetworkError(err));
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error(HTTP_STATUS_MESSAGES[res.status] || `Ошибка загрузки файла (${res.status})`);
  }

  if (!res.ok) {
    const serverMsg = typeof data.error === 'string' ? data.error : null;
    throw new Error(serverMsg || 'Ошибка загрузки файла');
  }
  return data as { material: AssignmentMaterial };
}

export async function deleteAssignment(
  accessToken: string,
  id: string,
): Promise<{ message: string }> {
  return request(`/assignments/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function getStudentAssignments(
  accessToken: string,
  params?: { streamId?: string; status?: string; studentId?: string },
): Promise<{ studentAssignments: StudentAssignment[] }> {
  const query = new URLSearchParams();
  if (params?.streamId) query.set('streamId', params.streamId);
  if (params?.status) query.set('status', params.status);
  if (params?.studentId) query.set('studentId', params.studentId);
  const qs = query.toString();
  return request(`/student-assignments${qs ? '?' + qs : ''}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function updateStudentAssignment(
  accessToken: string,
  id: string,
  data: { status: 'submitted' | 'reviewed' | 'needs_revision'; reviewText?: string },
): Promise<{ studentAssignment: StudentAssignment }> {
  return request(`/student-assignments/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

export interface AssignmentsSummary {
  assigned: number;
  submitted: number;
  reviewed: number;
  needs_revision: number;
  overdue: number;
  total: number;
}

export async function getStudentAssignmentsSummary(
  accessToken: string,
  studentId: string,
): Promise<{ summary: AssignmentsSummary }> {
  return request(`/students/${encodeURIComponent(studentId)}/assignments-summary`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function submitStudentAssignment(
  accessToken: string,
  id: string,
  data: { answerText?: string; studentComment?: string; file?: File },
): Promise<{ studentAssignment: StudentAssignment }> {
  const formData = new FormData();
  formData.append('status', 'submitted');
  if (data.answerText) formData.append('answerText', data.answerText);
  if (data.studentComment) formData.append('studentComment', data.studentComment);
  if (data.file) formData.append('file', data.file);

  const res = await fetch(`${API_URL}/student-assignments/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  let result: Record<string, unknown>;
  try {
    result = await res.json();
  } catch {
    throw new Error(HTTP_STATUS_MESSAGES[res.status] || `Ошибка сервера (${res.status})`);
  }

  if (!res.ok) {
    const serverMsg = typeof result.error === 'string' ? result.error : null;
    throw new Error(serverMsg || HTTP_STATUS_MESSAGES[res.status] || `Ошибка запроса (${res.status})`);
  }
  return result as { studentAssignment: StudentAssignment };
}

// Wallet API
//
// Деньги хранятся/передаются в КОПЕЙКАХ (целое число), UI показывает рубли.

export type WalletTxKind = 'topup' | 'debit';

export interface WalletTransaction {
  id: string;
  userId: string;
  amount: number; // в копейках; всегда положительное, знак определяется kind
  kind: WalletTxKind;
  note: string | null;
  createdBy: string | null; // имя администратора, сделавшего операцию
  createdAt: string;
}

// Статус начисления по группе: open — есть долг, paid — оплачено, refunded — возвращено.
export type ChargeStatus = 'open' | 'paid' | 'refunded';

// Природа начисления: разовое (за участие) или ежемесячное (менторская группа).
export type ChargeKind = 'one_time' | 'monthly';

// Начисление студенту за участие в группе (для блока «По группам» в кошельке).
export interface StudentCharge {
  id: string;
  streamId: string;
  streamName: string;
  amountKopecks: number; // сколько начислено за группу
  paidKopecks: number; // сколько уже оплачено
  status: ChargeStatus;
  // Природа начисления (разовое/ежемесячное). Опционально — старый бэк поле не отдаёт.
  kind?: ChargeKind;
}

// Активная группа студента с внешней ссылкой на оплату (кнопка «Оплатить»).
// paymentUrl — http(s) URL, заданный админом; присутствуют только группы с ссылкой.
export interface PayableStream {
  id: string;
  name: string;
  paymentUrl: string;
}

// Предстоящее ежемесячное списание за менторскую группу (блок «Следующее списание»).
// nextChargeDate — ISO-строка; willGoIntoDebt=true, если баланса может не хватить.
export interface NextMentorshipCharge {
  streamId: string;
  streamName: string;
  nextChargeDate: string;
  amountKopecks: number;
  willGoIntoDebt: boolean;
}

export interface WalletResponse {
  balanceKopecks: number;
  transactions: WalletTransaction[];
  // Начисления по группам (платёжный план). Пустой массив — начислений нет.
  charges: StudentCharge[];
  // Суммарный долг по открытым начислениям (копейки). 0 — долга нет.
  outstandingKopecks: number;
  // Предстоящие ежемесячные списания за менторские группы. [] — таких групп нет.
  nextMentorshipCharges: NextMentorshipCharge[];
  // Активные группы студента с внешней ссылкой на оплату (кнопка «Оплатить»). [] — нет.
  payableStreams: PayableStream[];
}

/** Форматирует копейки в рубли: 123456 → «1 234 ₽». */
export function formatKopecks(kopecks: number): string {
  const rubles = Math.round(kopecks) / 100;
  return `${rubles.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
}

/**
 * Переводит введённые пользователем рубли в копейки (целое).
 * Принимает строку или число; запятую трактует как десятичный разделитель.
 * Возвращает null, если значение не распознано или отрицательное.
 * Округляет к ближайшей копейке, чтобы избежать float-ошибок (например 19.99 → 1999).
 */
export function rublesToKopecks(input: string | number): number | null {
  const raw = typeof input === 'number' ? input : Number(String(input).trim().replace(',', '.'));
  if (!Number.isFinite(raw) || raw < 0) return null;
  return Math.round(raw * 100);
}

/**
 * Переводит копейки в строку рублей для поля ввода (без символа валюты).
 * Целое число рублей — без дробной части (120000 → «1200»), иначе с копейками.
 */
export function kopecksToRublesInput(kopecks: number | null | undefined): string {
  if (kopecks == null) return '';
  const rubles = Math.round(kopecks) / 100;
  return Number.isInteger(rubles) ? String(rubles) : rubles.toFixed(2);
}

export async function getWallet(
  accessToken: string,
  studentId: string,
): Promise<WalletResponse> {
  return request(`/students/${encodeURIComponent(studentId)}/wallet`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function topupWallet(
  accessToken: string,
  studentId: string,
  data: { amountKopecks: number; note?: string },
): Promise<{ balanceKopecks: number; transaction: WalletTransaction; settledKopecks: number }> {
  return request(`/students/${encodeURIComponent(studentId)}/wallet/topup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

export async function debitWallet(
  accessToken: string,
  studentId: string,
  data: { amountKopecks: number; note?: string },
): Promise<{ balanceKopecks: number; transaction: WalletTransaction }> {
  return request(`/students/${encodeURIComponent(studentId)}/wallet/debit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

// Payments & Top-up requests API (эпик «Оплата и баланс», Фаза 1)
//
// Студент пополняет баланс не сам: переводит деньги по реквизитам (PaymentSettings)
// и присылает скриншот → создаётся заявка (TopUpRequest). Админ одобряет (зачисляет
// реальную сумму на баланс через кошелёк) или отклоняет. Суммы — в КОПЕЙКАХ.
// Скрин и QR-код — приватные: бэк отдаёт подписанные временные URL.

export type TopUpRequestStatus = 'pending' | 'approved' | 'rejected';

export const TOPUP_STATUS_LABELS: Record<TopUpRequestStatus, string> = {
  pending: 'На рассмотрении',
  approved: 'Одобрена',
  rejected: 'Отклонена',
};

export interface TopUpRequest {
  id: string;
  status: TopUpRequestStatus;
  // Заявленная студентом сумма (копейки) — может отсутствовать.
  claimedAmountKopecks: number | null;
  // Фактически зачислено админом при одобрении (копейки) — null до одобрения.
  creditedAmountKopecks?: number | null;
  note?: string | null;
  // Подписанный временный URL скрина оплаты (приватный файл) — есть в списках.
  screenshotUrl?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  // Автор заявки — присутствует только в админском списке.
  user?: { id: string; name: string; email: string };
}

export interface PaymentSettings {
  transferUrl: string | null;
  transferPhone: string | null;
  instructions: string | null;
  // Подписанный временный URL QR-кода (или null).
  qrUrl: string | null;
}

// Создать заявку на пополнение (multipart: скрин оплаты + опционально сумма/коммент).
// По образцу uploadMyAvatar: FormData с файлом, ручная обработка ответа.
export async function createTopUpRequest(
  accessToken: string,
  data: { file: File; claimedAmountKopecks?: number; note?: string },
): Promise<Pick<TopUpRequest, 'id' | 'status' | 'claimedAmountKopecks' | 'createdAt'>> {
  const formData = new FormData();
  formData.append('file', data.file);
  if (data.claimedAmountKopecks !== undefined) {
    formData.append('claimedAmountKopecks', String(data.claimedAmountKopecks));
  }
  if (data.note) formData.append('note', data.note);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/topup-requests`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
  } catch (err) {
    throw new Error(translateNetworkError(err));
  }

  let result: Record<string, unknown>;
  try {
    result = await res.json();
  } catch {
    throw new Error(HTTP_STATUS_MESSAGES[res.status] || `Ошибка отправки заявки (${res.status})`);
  }

  if (!res.ok) {
    const serverMsg = typeof result.error === 'string' ? result.error : null;
    throw new Error(serverMsg || HTTP_STATUS_MESSAGES[res.status] || 'Ошибка отправки заявки');
  }
  return result as Pick<TopUpRequest, 'id' | 'status' | 'claimedAmountKopecks' | 'createdAt'>;
}

// Свои заявки на пополнение (для студента).
export async function getMyTopUpRequests(
  accessToken: string,
): Promise<{ requests: TopUpRequest[] }> {
  return request('/topup-requests/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Список заявок для модерации (admin). status: pending|approved|rejected|all (default pending).
export async function getAdminTopUpRequests(
  accessToken: string,
  status?: TopUpRequestStatus | 'all',
): Promise<{ requests: TopUpRequest[] }> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return request(`/admin/topup-requests${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Одобрить заявку и зачислить сумму на баланс студента (admin). Идемпотентно на бэке.
export async function approveTopUp(
  accessToken: string,
  id: string,
  amountKopecks: number,
): Promise<{ balanceKopecks: number; transaction: WalletTransaction; request: TopUpRequest }> {
  return request(`/admin/topup-requests/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ amountKopecks }),
  });
}

// Отклонить заявку (admin), опционально с комментарием-резолюцией.
export async function rejectTopUp(
  accessToken: string,
  id: string,
  note?: string,
): Promise<{ request: TopUpRequest }> {
  return request(`/admin/topup-requests/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ note }),
  });
}

// Реквизиты для перевода (любой аутентифицированный). Без секретов.
export async function getPaymentSettings(
  accessToken: string,
): Promise<PaymentSettings> {
  return request('/payment-settings', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Обновить реквизиты для перевода (admin).
export async function updatePaymentSettings(
  accessToken: string,
  payload: { transferUrl?: string; transferPhone?: string; instructions?: string },
): Promise<PaymentSettings> {
  return request('/admin/payment-settings', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
}

// Загрузить QR-код реквизитов (admin, multipart image/*). Возвращает подписанный qrUrl.
export async function uploadPaymentQr(
  accessToken: string,
  file: File,
): Promise<{ qrUrl: string }> {
  const formData = new FormData();
  formData.append('file', file);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/admin/payment-settings/qr`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
  } catch (err) {
    throw new Error(translateNetworkError(err));
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error(HTTP_STATUS_MESSAGES[res.status] || `Ошибка загрузки файла (${res.status})`);
  }

  if (!res.ok) {
    const serverMsg = typeof data.error === 'string' ? data.error : null;
    throw new Error(serverMsg || 'Ошибка загрузки файла');
  }
  return data as { qrUrl: string };
}

// Убрать QR-код реквизитов (admin).
export async function deletePaymentQr(
  accessToken: string,
): Promise<{ qrUrl: null }> {
  return request('/admin/payment-settings/qr', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Charges API (платёжный план группы)
//
// Начисления студентам за участие в группе. priceKopecks — цена группы (план);
// по каждому студенту видно начислено/оплачено/остаток и платёжный статус.
// Суммы — в КОПЕЙКАХ (UI показывает рубли).

// Платёжный статус студента по группе:
// paid — оплачено полностью, partial — оплачено частично, unpaid — есть долг,
// none — начислений нет (например, ещё не начисляли).
export type StreamChargePaymentStatus = 'paid' | 'partial' | 'unpaid' | 'none';

// Один период начисления студента по группе (детализация для месячных групп).
export interface StreamChargePeriod {
  id: string;
  amountKopecks: number;
  paidKopecks: number;
  status: ChargeStatus;
  kind: ChargeKind;
  // Ключ периода 'YYYY-MM' (для месячных) или null (для разового начисления).
  periodKey: string | null;
}

// Строка таблицы оплат группы: студент + АГРЕГАТ его начислений по этой группе.
// Для месячных групп у студента несколько начислений (по периодам) — суммы
// агрегатные, долг = outstandingKopecks (Σ по open), детализация — в periods.
export interface StreamChargeRow {
  id: string; // id студента
  name: string;
  email: string;
  // Агрегатные суммы; null — начислений по группе ещё нет.
  amountKopecks: number | null; // Σ начислено
  paidKopecks: number | null; // Σ оплачено
  // Суммарный долг по открытым начислениям (копейки). 0 — долга нет.
  outstandingKopecks: number;
  // Статус свежайшего начисления (совместимость с разовыми) или null.
  status: ChargeStatus | null;
  paymentStatus: StreamChargePaymentStatus;
  // Детализация по периодам (для месячных групп).
  periods: StreamChargePeriod[];
}

export interface StreamChargesResponse {
  // Цена группы (разовая, план) в копейках или null = план не задан.
  priceKopecks: number | null;
  // Тип оплаты группы и ежемесячная сумма (для месячных групп).
  billingType: StreamBillingType;
  monthlyPriceKopecks: number | null;
  students: StreamChargeRow[];
}

// Таблица оплат группы (admin): цена группы + начисления по студентам.
export async function getStreamCharges(
  accessToken: string,
  streamId: string,
): Promise<StreamChargesResponse> {
  return request(`/streams/${encodeURIComponent(streamId)}/charges`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Вернуть сумму начисления на баланс студента (admin). amountKopecks — целое >0.
export async function refundCharge(
  accessToken: string,
  chargeId: string,
  amountKopecks: number,
): Promise<{ balanceKopecks: number; transaction: WalletTransaction }> {
  return request(`/admin/charges/${encodeURIComponent(chargeId)}/refund`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ amountKopecks }),
  });
}

// Profiles API

export interface StudentProfile {
  id: string;
  resume: string | null;
  portfolio: string | null;
  contacts: { email?: string; telegram?: string } | null;
  direction: string | null;
  questionnaireCompletedAt: string | null;
}

export interface TeacherNote {
  id: string;
  studentId: string;
  authorId: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string };
}

export interface ProfileResponse {
  student: {
    id: string;
    email: string;
    name: string;
    lastName: string | null;
    phone: string | null;
    createdAt: string;
  };
  profile: StudentProfile | null;
  notes?: TeacherNote[];
}

export async function getProfile(
  accessToken: string,
  studentId: string,
): Promise<ProfileResponse> {
  return request(`/profiles/${studentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function updateProfile(
  accessToken: string,
  studentId: string,
  data: {
    resume?: string;
    portfolio?: string;
    contacts?: { email?: string; telegram?: string };
    direction?: string;
  },
): Promise<{ profile: StudentProfile }> {
  return request(`/profiles/${studentId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

export async function getTeacherNotes(
  accessToken: string,
  studentId: string,
): Promise<{ notes: TeacherNote[] }> {
  return request(`/profiles/${studentId}/notes`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function addTeacherNote(
  accessToken: string,
  studentId: string,
  content: string,
): Promise<{ note: TeacherNote }> {
  return request(`/profiles/${studentId}/notes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ content }),
  });
}

// Student dynamic (динамика ученика) — приватный инструмент преподавателя/админа.
// Roadmap-шапка («с чем пришёл / в процессе / с чем ушёл») + лента датированных записей.

export interface StudentDynamicEntry {
  id: string;
  content: string;
  source: string;
  authorName: string | null;
  lessonId: string | null;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentDynamic {
  roadmap: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
  entries: StudentDynamicEntry[];
}

export async function getStudentDynamic(
  accessToken: string,
  studentId: string,
): Promise<StudentDynamic> {
  return request(`/students/${studentId}/dynamic`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// PUT возвращает только мету roadmap (без ленты entries) — мёржим в стейт на клиенте.
export type StudentDynamicRoadmap = Pick<
  StudentDynamic,
  'roadmap' | 'updatedAt' | 'updatedByName'
>;

export async function updateStudentDynamicRoadmap(
  accessToken: string,
  studentId: string,
  roadmap: string,
): Promise<StudentDynamicRoadmap> {
  return request(`/students/${studentId}/dynamic/roadmap`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ roadmap }),
  });
}

export async function createStudentDynamicEntry(
  accessToken: string,
  studentId: string,
  content: string,
): Promise<{ entry: StudentDynamicEntry }> {
  return request(`/students/${studentId}/dynamic/entries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ content }),
  });
}

export async function updateStudentDynamicEntry(
  accessToken: string,
  studentId: string,
  entryId: string,
  content: string,
): Promise<{ entry: StudentDynamicEntry }> {
  return request(`/students/${studentId}/dynamic/entries/${entryId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ content }),
  });
}

export async function deleteStudentDynamicEntry(
  accessToken: string,
  studentId: string,
  entryId: string,
): Promise<{ ok: boolean }> {
  return request(`/students/${studentId}/dynamic/entries/${entryId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Лог активности студента (агрегированная лента событий: посещения, сдачи и
// проверки ДЗ, просмотры видео) — только для админа. Курсорная пагинация по
// timestamp (before=nextCursor подгружает следующую страницу).

export type ActivityEventType =
  | 'attendance'
  | 'assignment_submitted'
  | 'assignment_reviewed'
  | 'video_watched'
  | 'material_viewed'
  | 'material_downloaded';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  timestamp: string;
  lessonId: string | null;
  lessonTitle: string | null;
  streamId: string | null;
  streamName: string | null;
  status?: string;
  videoId?: string;
  videoTitle?: string | null;
  watchedPercent?: number;
  completed?: boolean;
  // Имя файла материала (для событий material_viewed / material_downloaded).
  materialName?: string;
}

export interface StudentActivityResponse {
  items: ActivityEvent[];
  nextCursor: string | null;
}

export async function getStudentActivity(
  accessToken: string,
  studentId: string,
  params?: { limit?: number; before?: string },
): Promise<StudentActivityResponse> {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.before) query.set('before', params.before);
  const qs = query.toString();
  return request(`/students/${studentId}/activity${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Threads API

export type ThreadEntryType = 'text' | 'file' | 'audio' | 'link' | 'comment' | 'note';

export interface ThreadEntry {
  id: string;
  threadId: string;
  authorId: string;
  type: ThreadEntryType;
  content: string;
  metadata: {
    s3Key?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    url?: string;
    title?: string;
    [key: string]: unknown;
  } | null;
  assignmentId: string | null;
  createdAt: string;
  readAt: string | null;
  author: { id: string; name: string; role: string };
  assignment: { id: string; title: string } | null;
}

export interface ThreadResponse {
  student: { id: string; name: string; email: string };
  thread: { id: string };
  entries: ThreadEntry[];
}

export async function getThread(
  accessToken: string,
  studentId: string,
  assignmentId?: string,
): Promise<ThreadResponse> {
  const qs = assignmentId ? `?assignmentId=${encodeURIComponent(assignmentId)}` : '';
  return request(`/threads/${studentId}${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function addThreadEntry(
  accessToken: string,
  studentId: string,
  data: { type: ThreadEntryType; content: string; assignmentId?: string; metadata?: Record<string, unknown> },
): Promise<{ entry: ThreadEntry }> {
  return request(`/threads/${studentId}/entries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

export interface ThreadSummary {
  studentId: string;
  studentName: string;
  lastEntryAt: string;
  lastEntryPreview: string;
  lastEntryAuthorRole: string;
  unanswered: boolean;
  unreadCount: number;
}

export async function getThreads(accessToken: string): Promise<{ threads: ThreadSummary[] }> {
  return request('/threads', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Staff conversation (штаб-канал преподавателей) API

export interface StaffEntry {
  id: string;
  conversationId: string;
  authorId: string;
  type: ThreadEntryType;
  content: string;
  metadata: {
    s3Key?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    url?: string;
    title?: string;
    [key: string]: unknown;
  } | null;
  createdAt: string;
  author: { id: string; name: string; role: string };
}

export interface StaffConversationResponse {
  conversation: { id: string };
  entries: StaffEntry[];
  unreadCount: number;
}

export async function getStaffConversation(
  accessToken: string,
): Promise<StaffConversationResponse> {
  return request('/conversations/staff', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function getStaffUnread(
  accessToken: string,
): Promise<{ unreadCount: number }> {
  return request('/conversations/staff/unread', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Суммарно непрочитанные сообщения текущего пользователя (роль-зависимо на бэке:
// admin — треды + штаб + cohort; student — личный тред + его cohort). Для бейджа в сайдбаре.
export async function getMessagesUnreadCount(
  accessToken: string,
): Promise<{ unreadCount: number }> {
  return request('/messages/unread-count', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function addStaffEntry(
  accessToken: string,
  data: { type: ThreadEntryType; content: string; metadata?: Record<string, unknown> },
): Promise<{ entry: StaffEntry }> {
  return request('/conversations/staff/entries', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

export async function uploadStaffFile(
  accessToken: string,
  file: File,
  type: 'file' | 'audio' = 'file',
): Promise<{ entry: StaffEntry }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', type);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/conversations/staff/entries`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
  } catch (err) {
    throw new Error(translateNetworkError(err));
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error(HTTP_STATUS_MESSAGES[res.status] || `Ошибка загрузки файла (${res.status})`);
  }

  if (!res.ok) {
    const serverMsg = typeof data.error === 'string' ? data.error : null;
    throw new Error(serverMsg || 'Ошибка загрузки файла');
  }
  return data as { entry: StaffEntry };
}

// Stream conversations (пер-поточные чаты преподавателей «общих» потоков) API
//
// Записи и ответ структурно совпадают со штабом — переиспользуем StaffEntry.

export interface StreamConversationSummary {
  streamId: string;
  name: string;
  status: 'active' | 'archived';
  unreadCount: number;
}

export interface StreamConversationResponse {
  conversation: { id: string; streamId: string };
  entries: StaffEntry[];
  unreadCount: number;
}

export async function getStreamConversations(
  accessToken: string,
): Promise<{ streams: StreamConversationSummary[] }> {
  return request('/conversations/streams', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function getStreamConversation(
  accessToken: string,
  streamId: string,
): Promise<StreamConversationResponse> {
  return request(`/conversations/stream/${streamId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function addStreamEntry(
  accessToken: string,
  streamId: string,
  data: { type: ThreadEntryType; content: string; metadata?: Record<string, unknown> },
): Promise<{ entry: StaffEntry }> {
  return request(`/conversations/stream/${streamId}/entries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

export async function uploadStreamFile(
  accessToken: string,
  streamId: string,
  file: File,
  type: 'file' | 'audio' = 'file',
): Promise<{ entry: StaffEntry }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', type);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/conversations/stream/${streamId}/entries`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
  } catch (err) {
    throw new Error(translateNetworkError(err));
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error(HTTP_STATUS_MESSAGES[res.status] || `Ошибка загрузки файла (${res.status})`);
  }

  if (!res.ok) {
    const serverMsg = typeof data.error === 'string' ? data.error : null;
    throw new Error(serverMsg || 'Ошибка загрузки файла');
  }
  return data as { entry: StaffEntry };
}

// Cohort conversations (общий чат потока: все студенты потока + преподаватели) API
//
// Записи и ответ структурно совпадают со штабом — переиспользуем StaffEntry.

export interface CohortConversationSummary {
  streamId: string;
  name: string;
  status: 'active' | 'archived';
  unreadCount: number;
}

export interface CohortConversationResponse {
  conversation: { id: string; streamId: string };
  entries: StaffEntry[];
  unreadCount: number;
}

export async function getCohortConversations(
  accessToken: string,
): Promise<{ streams: CohortConversationSummary[] }> {
  return request('/conversations/cohorts', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function getCohortConversation(
  accessToken: string,
  streamId: string,
): Promise<CohortConversationResponse> {
  return request(`/conversations/cohort/${streamId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function addCohortEntry(
  accessToken: string,
  streamId: string,
  data: { type: ThreadEntryType; content: string; metadata?: Record<string, unknown> },
): Promise<{ entry: StaffEntry }> {
  return request(`/conversations/cohort/${streamId}/entries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

export async function uploadCohortFile(
  accessToken: string,
  streamId: string,
  file: File,
  type: 'file' | 'audio' = 'file',
): Promise<{ entry: StaffEntry }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', type);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/conversations/cohort/${streamId}/entries`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
  } catch (err) {
    throw new Error(translateNetworkError(err));
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error(HTTP_STATUS_MESSAGES[res.status] || `Ошибка загрузки файла (${res.status})`);
  }

  if (!res.ok) {
    const serverMsg = typeof data.error === 'string' ? data.error : null;
    throw new Error(serverMsg || 'Ошибка загрузки файла');
  }
  return data as { entry: StaffEntry };
}

// Notifications API

export type NotificationType =
  | 'lesson_published'
  | 'assignment_created'
  | 'deadline_reminder'
  | 'thread_entry'
  | 'assignment_submitted'
  | 'assignment_reviewed'
  | 'schedule_entry_created'
  | 'topup_requested'
  | 'student_enrolled';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata: Record<string, string> | null;
  isRead: boolean;
  createdAt: string;
}

export type NotificationCategory =
  | 'learning'
  | 'deadlines'
  | 'feedback'
  | 'schedule'
  | 'student_activity'
  | 'system';

export interface NotificationPreference {
  id: string;
  userId: string;
  category: NotificationCategory;
  channelEmail: boolean;
  channelPush: boolean;
  updatedAt: string;
}

export async function getNotifications(
  accessToken: string,
): Promise<{ notifications: Notification[]; unreadCount: number }> {
  return request('/notifications', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function markNotificationRead(
  accessToken: string,
  id: string,
): Promise<{ notification: Notification }> {
  return request(`/notifications/${id}/read`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function markAllNotificationsRead(
  accessToken: string,
): Promise<{ message: string }> {
  return request('/notifications/read-all', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * Вычисляет ссылку на источник уведомления по типу и metadata.
 */
export function getNotificationLink(
  notification: Notification,
  role: 'student' | 'admin',
): string | null {
  const m = notification.metadata;
  if (!m) return null;

  switch (notification.type) {
    case 'assignment_created':
    case 'deadline_reminder':
      return role === 'student' ? '/dashboard/assignments' : '/admin/assignments';
    case 'assignment_submitted':
      // Админ должен попасть на страницу ЗАДАНИЯ (проверить сдачу), а не в профиль студента.
      if (role === 'admin' && m.assignmentId) return `/admin/assignments/${m.assignmentId}`;
      return '/admin/assignments';
    case 'assignment_reviewed':
      if (role === 'student' && m.assignmentId) return `/dashboard/assignments/${m.assignmentId}`;
      return role === 'student' ? '/dashboard/assignments' : '/admin/assignments';
    case 'thread_entry':
      if (role === 'student') return '/dashboard/messages?tab=personal';
      if (m.studentId) return `/admin/students/${m.studentId}?tab=thread`;
      // Без studentId — это сообщение из штаб-канала преподавателей.
      return '/admin/messages';
    case 'lesson_published':
      return role === 'student' ? '/dashboard/lessons' : '/admin/streams';
    case 'schedule_entry_created':
      return role === 'student' ? '/dashboard/schedule' : '/admin/lessons';
    case 'topup_requested':
      return '/admin/topups';
    case 'student_enrolled':
      // Уведомление приходит преподавателю: ведём в карточку зачисленного
      // студента, иначе — в список групп. У студента ссылки нет.
      if (role !== 'admin') return null;
      return m.studentId ? `/admin/students/${m.studentId}` : '/admin/streams';
    default:
      return null;
  }
}

export async function getNotificationPreferences(
  accessToken: string,
): Promise<{ preferences: NotificationPreference[] }> {
  return request('/notification-preferences', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function updateNotificationPreferences(
  accessToken: string,
  preferences: Array<{ category: NotificationCategory; channelEmail?: boolean; channelPush?: boolean }>,
): Promise<{ preferences: NotificationPreference[] }> {
  return request('/notification-preferences', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ preferences }),
  });
}

export async function savePushSubscription(
  accessToken: string,
  subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  },
): Promise<{ message: string }> {
  return request('/push-subscriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(subscription),
  });
}

/** VAPID public key с сервера (рантайм-env), а не из build-time NEXT_PUBLIC_*. */
export async function getVapidPublicKey(accessToken: string): Promise<string | null> {
  const { vapidPublicKey } = await request<{ vapidPublicKey: string | null }>(
    '/push-subscriptions/vapid-public-key',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return vapidPublicKey;
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreateApiKeyResponse {
  apiKey: {
    id: string;
    name: string;
    key: string; // полный ключ, показывается 1 раз
    keyPrefix: string;
    createdAt: string;
  };
}

export async function getApiKeys(accessToken: string): Promise<{ apiKeys: ApiKey[] }> {
  return request('/api-keys', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function createApiKey(accessToken: string, name: string): Promise<CreateApiKeyResponse> {
  return request('/api-keys', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name }),
  });
}

export async function revokeApiKey(accessToken: string, id: string): Promise<{ message: string }> {
  return request(`/api-keys/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Admin dashboard stats

export interface AdminStats {
  students: {
    total: number;
    active: number;
    blocked: number;
    newThisWeek: number;
    pendingOnboarding: number;
    questionnaireIncomplete: number;
  };
  streams: {
    active: number;
    archived: number;
  };
  assignments: {
    byStatus: {
      assigned: number;
      submitted: number;
      reviewed: number;
      needs_revision: number;
    };
    awaitingReview: number;
  };
  schedule: {
    thisWeek: number;
    upcoming: Array<{
      id: string;
      date: string;
      startTime: string;
      lessonTitle: string;
      streamId: string;
      streamName: string;
      meetingUrl: string | null;
    }>;
  };
  attention: {
    submissionsToReview: Array<{
      studentAssignmentId: string;
      studentId: string;
      studentName: string;
      assignmentTitle: string;
      submittedAt: string | null;
    }>;
    unansweredThreads: Array<{
      studentId: string;
      studentName: string;
      lastEntryAt: string;
    }>;
    onboarding: Array<{
      studentId: string;
      studentName: string;
      reason: 'invite_pending' | 'questionnaire_incomplete';
    }>;
  };
}

export async function getAdminStats(accessToken: string): Promise<AdminStats> {
  return request('/stats', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function uploadThreadFile(
  accessToken: string,
  studentId: string,
  file: File,
  type: 'file' | 'audio' = 'file',
  assignmentId?: string,
): Promise<{ entry: ThreadEntry }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', type);
  if (assignmentId) formData.append('assignmentId', assignmentId);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/threads/${studentId}/entries`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
  } catch (err) {
    throw new Error(translateNetworkError(err));
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error(HTTP_STATUS_MESSAGES[res.status] || `Ошибка загрузки файла (${res.status})`);
  }

  if (!res.ok) {
    const serverMsg = typeof data.error === 'string' ? data.error : null;
    throw new Error(serverMsg || 'Ошибка загрузки файла');
  }
  return data as { entry: ThreadEntry };
}

// Programs API
//
// Program — переиспользуемый учебный план: упорядоченный набор блоков-уроков
// (ProgramLesson). Поток (Stream) ссылается на программу через programId.
// Управление программами — только admin.

export type ProgramType = 'course' | 'intensive' | 'mentorship';

export const PROGRAM_TYPE_LABELS: Record<ProgramType, string> = {
  course: 'Курс',
  intensive: 'Интенсив',
  mentorship: 'Менторская',
};

// Элемент списка программ (со счётчиками).
export interface Program {
  id: string;
  name: string;
  type: ProgramType;
  whatYouLearn: string | null;
  lessonsCount: number;
  streamsCount: number;
}

// Урок в составе программы (минимум полей для UI).
export interface ProgramLesson {
  id: string;
  title: string;
  hasAssignment: boolean;
  hasVideo: boolean;
  sortOrder: number;
}

// Деталь программы: сама программа + упорядоченные уроки + привязанные потоки.
export interface ProgramDetail {
  id: string;
  name: string;
  type: ProgramType;
  whatYouLearn: string | null;
  createdAt: string;
  updatedAt: string;
  lessons: ProgramLesson[];
  streams: { id: string; name: string; status: 'active' | 'archived' }[];
}

export async function getPrograms(
  accessToken: string,
): Promise<{ programs: Program[] }> {
  return request('/programs', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function getProgram(
  accessToken: string,
  id: string,
): Promise<{ program: ProgramDetail }> {
  return request(`/programs/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function createProgram(
  accessToken: string,
  data: { name: string; type?: ProgramType; whatYouLearn?: string | null },
): Promise<{ program: Program }> {
  return request('/programs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

export async function updateProgram(
  accessToken: string,
  id: string,
  data: { name?: string; type?: ProgramType; whatYouLearn?: string | null },
): Promise<{ program: Program }> {
  return request(`/programs/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

export async function deleteProgram(
  accessToken: string,
  id: string,
): Promise<{ message: string }> {
  return request(`/programs/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Привязать существующий блок-урок к программе (в конец). Идемпотентно.
export async function addProgramLesson(
  accessToken: string,
  programId: string,
  lessonId: string,
): Promise<{ programLesson: { id: string; programId: string; lessonId: string; sortOrder: number } }> {
  return request(`/programs/${programId}/lessons`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ lessonId }),
  });
}

// Отвязать урок от программы (идемпотентно).
export async function removeProgramLesson(
  accessToken: string,
  programId: string,
  lessonId: string,
): Promise<{ success: boolean }> {
  return request(`/programs/${programId}/lessons/${lessonId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Переустановить порядок уроков программы по порядку массива lessonIds.
export async function reorderProgramLessons(
  accessToken: string,
  programId: string,
  lessonIds: string[],
): Promise<{ lessons: { lessonId: string; sortOrder: number }[] }> {
  return request(`/programs/${programId}/lessons/reorder`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ lessonIds }),
  });
}

// Создать блок-урок без привязки к потоку (копилка): POST /lessons без streamId.
// Сервер вернёт спроецированный урок (streamId=null, status='draft').
export async function createLessonBlock(
  accessToken: string,
  data: {
    title: string;
    videoUrl?: string;
    summary?: string;
    notes?: string;
    sortOrder?: number;
    teacherIds?: string[];
    materials?: LessonMaterial[];
  },
): Promise<{ lesson: Lesson }> {
  return request('/lessons', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

// --- Интеграция Zoom (Система → Интеграции) ----------------------------------
// Безопасный вид настроек: секреты не отдаются, доступны лишь признаки наличия
// (secretSet/secretTokenSet) и последние 4 символа (secretLast4/secretTokenLast4).
// encryptionKeySet сообщает, настроен ли на сервере ключ шифрования (без него
// секреты нельзя сохранить/проверить). webhookId — публичный id персонального
// URL вебхука Zoom (/webhooks/zoom/<webhookId>).
export interface ZoomIntegrationConfig {
  enabled: boolean;
  autoCreateMeeting: boolean;
  accountId: string | null;
  clientId: string | null;
  secretSet: boolean;
  secretLast4: string | null;
  secretTokenSet: boolean;
  secretTokenLast4: string | null;
  webhookId: string | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  encryptionKeySet: boolean;
}

// Получить текущие настройки Zoom.
export async function getZoomIntegration(accessToken: string): Promise<ZoomIntegrationConfig> {
  return request('/admin/integrations/zoom', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Сохранить настройки Zoom. clientSecret/secretToken передавать только при
// изменении — пустое/отсутствующее значение оставляет сохранённый секрет без
// изменений.
export async function updateZoomIntegration(
  accessToken: string,
  data: {
    enabled?: boolean;
    autoCreateMeeting?: boolean;
    accountId?: string;
    clientId?: string;
    clientSecret?: string;
    secretToken?: string;
  },
): Promise<ZoomIntegrationConfig> {
  return request('/admin/integrations/zoom', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

// Проверить соединение с Zoom. Не бросает на ошибках Zoom — возвращает ok:false.
export async function testZoomIntegration(
  accessToken: string,
): Promise<{ ok: boolean; message: string }> {
  return request('/admin/integrations/zoom/test', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// --- Интеграция Telegram (уведомления преподавателю) -------------------------
// Каждый преподаватель сам создаёт бота в @BotFather и вводит токен СВОЕГО бота
// (как секреты Zoom). tokenSet — токен сохранён; botUsername — @username бота
// (известен после сохранения токена); connected — чат привязан (преподаватель
// нажал «Старт» боту и привязал чат); enabled — доставка уведомлений включена;
// encryptionKeySet=false — на сервере нет ключа шифрования, токен сохранить нельзя.
export interface TelegramIntegrationConfig {
  tokenSet: boolean;
  botUsername: string | null;
  connected: boolean;
  enabled: boolean;
  linkedAt: string | null;
  encryptionKeySet: boolean;
}

// Получить текущие настройки Telegram.
export async function getTelegramIntegration(
  accessToken: string,
): Promise<TelegramIntegrationConfig> {
  return request('/admin/integrations/telegram', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Сохранить токен бота. 400 — токен неверный или нет ключа шифрования.
export async function saveTelegramToken(
  accessToken: string,
  botToken: string,
): Promise<TelegramIntegrationConfig> {
  return request('/admin/integrations/telegram/token', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ botToken }),
  });
}

// Привязать чат к боту. 409 (ApiError) — преподаватель ещё не написал боту
// (нет сообщений): нужно открыть бота, нажать «Старт» и повторить.
export async function linkTelegramChat(
  accessToken: string,
): Promise<TelegramIntegrationConfig> {
  return request('/admin/integrations/telegram/link', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Отправить тестовое сообщение в привязанный чат.
export async function testTelegram(
  accessToken: string,
): Promise<{ ok: boolean }> {
  return request('/admin/integrations/telegram/test', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Включить/выключить доставку уведомлений в Telegram.
export async function setTelegramEnabled(
  accessToken: string,
  enabled: boolean,
): Promise<TelegramIntegrationConfig> {
  return request('/admin/integrations/telegram', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ enabled }),
  });
}

// Отключить интеграцию: удаляет токен и привязку чата.
export async function unlinkTelegram(
  accessToken: string,
): Promise<{ ok: true }> {
  return request('/admin/integrations/telegram', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ─── Встречи 1-на-1 (эпик #154) ─────────────────────────────────────────────
//
// Meeting — лёгкая отдельная сущность (НЕ Session): преподаватель + студент +
// дата/время + опц. тема. Поля записи/итогов/транскрипта зеркалят Session.
//
// ИЗОЛЯЦИЯ two-party: встречу видит только её teacher и student (бэк фильтрует).
// Студенту отдаётся УРЕЗАННАЯ проекция: БЕЗ recordingError и без полей
// транскрипта (transcriptStatus/transcriptError/transcriptRequestedAt) — эти
// ключи в объекте отсутствуют (отмечены опциональными ниже).

// Статус встречи: planned | done | cancelled (зеркало Session.status, но без
// draft/live — встречу 1-на-1 не «ведут» как урок-блок).
export type MeetingStatus = 'planned' | 'done' | 'cancelled' | string;

export interface Meeting {
  id: string;
  teacherId: string;
  studentId: string;
  // Тема встречи (или null — тогда показываем дефолт «Встреча 1-на-1»).
  title: string | null;
  status: MeetingStatus;
  // Дата "YYYY-MM-DD" (или null).
  date: string | null;
  // Время начала "HH:MM" (или null).
  startTime: string | null;
  // Ссылка на созвон Zoom (best-effort, может быть null).
  meetingUrl: string | null;
  // Запись Zoom-созвона (подтягивается ПОСЛЕ встречи). videoUrl — внешняя ссылка
  // на запись; videoKey — ключ файла в хранилище. recordingFileUrl — подписанный
  // временный S3-URL по videoKey (приоритетен для плеера; null если файла нет).
  videoUrl: string | null;
  videoKey: string | null;
  // Подписанный временный URL загруженной записи в S3 (или null). На фронте
  // используем recordingFileUrl ?? videoUrl (S3-файл приоритетно, внешняя ссылка фолбэк).
  recordingFileUrl: string | null;
  // recordingStatus: none | pending | processing | ready | failed.
  recordingStatus?: string | null;
  recordingRequestedAt?: string | null;
  // Итоги встречи (отдаются обоим). summarySource: 'zoom_ai' | 'manual' | null.
  summary: string | null;
  summarySource?: string | null;
  summaryStatus?: string | null;
  summaryRequestedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  teacher: { id: string; name: string };
  student: { id: string; name: string };
  // Только в админ/препод-проекции (у студента полей нет вовсе).
  recordingError?: string | null;
  transcriptStatus?: string | null;
  transcriptError?: string | null;
  transcriptRequestedAt?: string | null;
}

// Список встреч (бэк фильтрует по роли: admin → свои как teacher, student → свои).
export async function getMeetings(
  accessToken: string,
): Promise<{ meetings: Meeting[] }> {
  return request('/meetings', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Деталь встречи. Чужая/несуществующая → 404 (бэк проверяет участие).
export async function getMeeting(accessToken: string, id: string): Promise<Meeting> {
  return request(`/meetings/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Создать встречу 1-на-1 (admin). teacherId = текущий админ (бэк). date — YYYY-MM-DD,
// startTime — HH:MM (опц.), title — опц. тема. Бэк best-effort создаёт Zoom-встречу.
export async function createMeeting(
  accessToken: string,
  data: { studentId: string; date: string; startTime?: string | null; title?: string | null },
): Promise<Meeting> {
  return request('/meetings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

// Отмена встречи (admin-teacher своей встречи). status → cancelled.
export async function cancelMeeting(accessToken: string, id: string): Promise<Meeting> {
  return request(`/meetings/${id}/cancel`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Транскрипт встречи (только teacher). Возвращает подписанную ссылку на тело + статус
// (зеркало fetchTranscript для занятий). Студенту бэк отвечает 404.
export async function getMeetingTranscript(
  accessToken: string,
  id: string,
  format: 'vtt' | 'txt',
): Promise<TranscriptResponse> {
  const qs = new URLSearchParams({ format }).toString();
  return request(`/meetings/${id}/transcript?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
