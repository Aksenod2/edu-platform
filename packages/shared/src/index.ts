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

// Контракты фронт↔бэк (zod-схемы — единый источник правды). Epic #174.
export * from './contracts';
