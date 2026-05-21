/**
 * @platform/ui — Nothing Phone Design System
 *
 * Атомарная иерархия:
 * - tokens:    CSS custom properties + TypeScript зеркало
 * - atoms:     Button, Input, Label, Badge, Typography, Divider, Spinner, Avatar
 * - molecules: FormField, Card, NavItem, EmptyState
 * - organisms: Header, Sidebar, StudentCard, AssignmentList
 * - templates: DashboardLayout, AuthLayout
 *
 * Подключение CSS-токенов: import '@platform/ui/styles' в root layout
 */

// Утилиты
export { cn } from './lib/utils';

// Токены
export * from './tokens';

// Атомы
export * from './atoms';

// Молекулы
export * from './molecules';

// Организмы
export * from './organisms';

// Шаблоны
export * from './templates';
