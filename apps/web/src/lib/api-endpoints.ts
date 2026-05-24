// Перечень эндпоинтов API, доступных по admin-ключу (`sk_…`).
//
// Источник истины вынесен в общий пакет `@platform/shared`, чтобы один и тот же
// список потребляли и эта страница (`/admin/api-access`), и тест-страж паритета
// на стороне api (`apps/api/src/routes/__tests__/api-docs-parity.test.ts`).
// Здесь — только реэкспорт для удобного импорта через `@/lib/api-endpoints`.
export {
  API_ENDPOINTS,
  API_ENDPOINT_GROUPS,
  type ApiEndpoint,
} from '@platform/shared';
