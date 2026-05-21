/**
 * DashboardLayout — Шаблон
 * Atomic level: Template
 *
 * Состав: Header (организм) + Sidebar (организм) + main content area
 * Токены: --sidebar-width, --header-height, --content-max-w
 *
 * Скелет: фиксированный хедер, фиксированный сайдбар, прокручиваемый контент
 * Применяется на: /dashboard, /admin, /admin/students, /admin/streams
 *
 * Nothing Phone layout philosophy:
 * - Жёсткая сетка, никакой свободной раскладки
 * - Sidebar = навигационная рельса, header = статусная строка
 * - Контент = всё остальное пространство
 */
import React from 'react';
import { Header, type HeaderProps } from '../organisms/Header';
import { Sidebar, type SidebarProps } from '../organisms/Sidebar';

export interface DashboardLayoutProps {
  header: HeaderProps;
  sidebar: SidebarProps;
  children: React.ReactNode;
  currentPath?: string;
}

export function DashboardLayout({ header, sidebar, children, currentPath }: DashboardLayoutProps) {
  return (
    <div className="flex flex-col min-h-screen bg-[var(--color-bg-base)]">
      <Header {...header} />

      <div className="flex flex-1 overflow-hidden h-[calc(100vh-var(--header-height))]">
        <Sidebar {...sidebar} currentPath={currentPath} />

        <main className="flex-1 overflow-y-auto p-8 bg-[var(--color-bg-base)]">
          <div className="max-w-[var(--content-max-w)]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Page section helpers ─────────────────────────────────

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-8">
      <div>
        <h1 className="font-sans text-2xl font-bold tracking-[var(--tracking-tight)] text-[var(--color-text-primary)] leading-[var(--leading-tight)]">
          {title}
        </h1>
        {subtitle && (
          <p className="font-sans text-sm text-[var(--color-text-tertiary)] mt-1">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
