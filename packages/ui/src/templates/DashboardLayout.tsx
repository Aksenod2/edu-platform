/**
 * DashboardLayout — Шаблон
 * Atomic level: Template
 *
 * Состав: Header (организм) + Sidebar (организм) + main content area
 * Токены: --sidebar-width, --header-height, --content-padding
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        background: 'var(--color-bg-base)',
      }}
    >
      <Header {...header} />

      <div
        style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
          height: 'calc(100vh - var(--header-height))',
        }}
      >
        <Sidebar {...sidebar} currentPath={currentPath} />

        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 'var(--content-padding)',
            background: 'var(--color-bg-base)',
          }}
        >
          <div style={{ maxWidth: 'var(--content-max-w)' }}>
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
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        marginBottom: 'var(--space-8)',
      }}
    >
      <div>
        <h1
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-2xl)',
            fontWeight: 'var(--font-bold)' as unknown as number,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--color-text-primary)',
            lineHeight: 'var(--leading-tight)',
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-tertiary)',
              marginTop: 'var(--space-1)',
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}
