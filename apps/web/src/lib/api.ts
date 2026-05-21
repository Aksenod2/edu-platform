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
    role: 'admin' | 'student';
    mustChangePassword: boolean;
    questionnaireCompleted?: boolean;
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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
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

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error(HTTP_STATUS_MESSAGES[res.status] || `Ошибка сервера (${res.status})`);
  }

  if (!res.ok) {
    const serverMsg = typeof data.error === 'string' ? data.error : null;
    const fallback = HTTP_STATUS_MESSAGES[res.status] || `Ошибка запроса (${res.status})`;
    throw new Error(serverMsg || fallback);
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

export async function forgotPassword(email: string): Promise<{ message: string }> {
  return request('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
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

export async function acceptInvite(
  token: string,
  password: string,
): Promise<{ message: string }> {
  return request('/auth/accept-invite', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

export async function verifyEmail(token: string): Promise<{ message: string }> {
  return request('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

// Streams API

export interface Stream {
  id: string;
  name: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export async function getStreams(accessToken: string): Promise<{ streams: Stream[] }> {
  return request('/streams', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function createStream(
  accessToken: string,
  name: string,
): Promise<{ stream: Stream }> {
  return request('/streams', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name }),
  });
}

export async function updateStream(
  accessToken: string,
  id: string,
  name: string,
): Promise<{ stream: Stream }> {
  return request(`/streams/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name }),
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

// Users (Students) API

export interface Student {
  id: string;
  email: string;
  name: string;
  role: 'student' | 'admin';
  isActive: boolean;
  createdAt: string;
  inviteToken?: string | null;
  inviteExpiresAt?: string | null;
  deletedAt?: string | null;
  submittedCount?: number;
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
): Promise<{ user: Student }> {
  return request('/users', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ email, name }),
  });
}

export async function updateStudent(
  accessToken: string,
  id: string,
  data: { name?: string; email?: string; isActive?: boolean },
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

// Lessons API

export interface Lesson {
  id: string;
  streamId: string;
  title: string;
  videoUrl: string | null;
  summary: string | null;
  notes: string | null;
  status: 'draft' | 'published' | 'closed';
  publishAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export async function getLessons(
  accessToken: string,
  streamId: string,
): Promise<{ lessons: Lesson[] }> {
  return request(`/lessons?streamId=${encodeURIComponent(streamId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function getLesson(
  accessToken: string,
  id: string,
): Promise<{ lesson: Lesson }> {
  return request(`/lessons/${id}`, {
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
    publishAt?: string;
    sortOrder?: number;
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
    title?: string;
    videoUrl?: string;
    summary?: string;
    notes?: string;
    status?: 'draft' | 'published' | 'closed';
    publishAt?: string | null;
    sortOrder?: number;
  },
): Promise<{ lesson: Lesson }> {
  return request(`/lessons/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
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

// Schedule API

export interface ScheduleEntry {
  id: string;
  streamId: string;
  date: string;
  startTime: string;
  lessonTitle: string;
  notes: string | null;
  meetingUrl: string | null;
  createdAt: string;
  updatedAt: string;
  stream?: { id: string; name: string };
}

export async function getSchedule(
  accessToken: string,
  streamId: string,
): Promise<{ schedule: ScheduleEntry[] }> {
  return request(`/schedule?streamId=${encodeURIComponent(streamId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function createScheduleEntry(
  accessToken: string,
  data: {
    streamId: string;
    date: string;
    startTime: string;
    lessonTitle: string;
    notes?: string;
    meetingUrl?: string;
  },
): Promise<{ entry: ScheduleEntry }> {
  return request('/schedule', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

export async function updateScheduleEntry(
  accessToken: string,
  id: string,
  data: {
    date?: string;
    startTime?: string;
    lessonTitle?: string;
    notes?: string | null;
    meetingUrl?: string | null;
  },
): Promise<{ entry: ScheduleEntry }> {
  return request(`/schedule/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

export async function deleteScheduleEntry(
  accessToken: string,
  id: string,
): Promise<{ success: boolean }> {
  return request(`/schedule/${id}`, {
    method: 'DELETE',
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

export interface StudentAssignment {
  id: string;
  assignmentId: string;
  studentId: string;
  status: 'assigned' | 'submitted' | 'reviewed' | 'needs_revision';
  content: string | null;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  fileSignedUrl?: string;
  studentComment: string | null;
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

export async function assignAssignment(
  accessToken: string,
  id: string,
  data: { studentId?: string; groupId?: string },
): Promise<{ studentAssignment?: StudentAssignment; assigned?: number; message?: string }> {
  return request(`/assignments/${id}/assign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
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
  data: { status: 'submitted' | 'reviewed' | 'needs_revision' },
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
  student: { id: string; email: string; name: string; createdAt: string };
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

// Notifications API

export type NotificationType =
  | 'lesson_published'
  | 'assignment_created'
  | 'deadline_reminder'
  | 'thread_entry'
  | 'assignment_submitted'
  | 'assignment_reviewed'
  | 'schedule_entry_created';

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
      if (role === 'admin' && m.studentId) return `/admin/students/${m.studentId}`;
      return '/admin/assignments';
    case 'assignment_reviewed':
      return role === 'student' ? '/dashboard/assignments' : '/admin/assignments';
    case 'thread_entry':
      if (role === 'student') return '/dashboard/thread';
      if (m.studentId) return `/admin/students/${m.studentId}/thread`;
      return '/admin/students';
    case 'lesson_published':
      return role === 'student' ? '/dashboard/lessons' : '/admin/streams';
    case 'schedule_entry_created':
      return role === 'student' ? '/dashboard/schedule' : '/admin/schedule';
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
