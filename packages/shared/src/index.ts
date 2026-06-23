export const APP_NAME = 'Обучающая платформа';

export {
  API_ENDPOINTS,
  API_ENDPOINT_GROUPS,
  type ApiEndpoint,
} from './api-endpoints';

export {
  FOREIGN_EMAIL_DOMAINS,
  isForeignEmail,
  FOREIGN_EMAIL_STUDENT_MESSAGE,
  FOREIGN_EMAIL_ADMIN_MESSAGE,
} from './foreign-email';

export {
  EMAIL_REGEX,
  isValidEmail,
  normalizeEmail,
  MIN_PASSWORD_LENGTH,
  isValidPassword,
  PHONE_REGEX,
  normalizePhone,
  isValidPhone,
} from './validation';

export {
  USER_ROLES,
  USER_ROLE_LABELS,
  type UserRoleCode,
  STREAM_STATUSES,
  STREAM_STATUS_LABELS,
  type StreamStatusCode,
  SESSION_STATUSES,
  SESSION_STATUS_LABELS,
  type SessionStatusCode,
  MEETING_STATUSES,
  MEETING_STATUS_LABELS,
  type MeetingStatusCode,
} from './enums';
