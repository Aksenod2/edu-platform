/**
 * AuthLayout — Шаблон
 * Atomic level: Template
 *
 * Состав: центрированный контейнер + DotMatrix фон
 * Токены: bg-[var(--color-bg-base)], spacing, border
 *
 * Применяется на: /login, /forgot-password, /reset-password, /invite, /change-password
 *
 * Nothing Phone aesthetics:
 * - Полностью чёрный фон
 * - Центрированная форма с тонкой рамкой
 * - Dot-matrix декор на фоне (фирменный паттерн Nothing)
 * - Всё внимание на форму — ноль визуального шума
 */
import React from 'react';
import { cn } from '../lib/utils';

export interface AuthLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  return (
    <div className="relative flex items-center justify-center min-h-screen bg-[var(--color-bg-base)] p-8 overflow-hidden">
      {/* Dot-matrix фоновый декор */}
      <DotMatrixBackground />

      {/* Форм-карточка */}
      <div className="relative z-10 w-full max-w-[400px] bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] rounded-[var(--radius-xs)] p-8">
        {/* Логотип и заголовок */}
        <div className="mb-8 text-center">
          <AuthLogo />
          {title && (
            <h1
              className={cn(
                'font-sans text-xl font-semibold text-[var(--color-text-primary)]',
                'tracking-[var(--tracking-tight)] mt-4',
                subtitle ? 'mb-2' : 'mb-0',
              )}
            >
              {title}
            </h1>
          )}
          {subtitle && (
            <p className="font-sans text-sm text-[var(--color-text-tertiary)]">
              {subtitle}
            </p>
          )}
        </div>

        {children}
      </div>
    </div>
  );
}

// Dot-matrix паттерн на фоне — узнаваемый Nothing Phone визуальный язык
function DotMatrixBackground() {
  const cols = 20;
  const rows = 12;
  const dots = Array.from({ length: cols * rows });

  return (
    <div
      aria-hidden
      className="absolute inset-0 grid opacity-[0.15] pointer-events-none"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
    >
      {dots.map((_, i) => {
        const visible = Math.random() > 0.65;
        return (
          <span key={i} className="flex items-center justify-center">
            {visible && (
              <span className="w-[2px] h-[2px] rounded-full bg-[var(--color-border-strong)]" />
            )}
          </span>
        );
      })}
    </div>
  );
}

// Логотип в auth-контексте
function AuthLogo() {
  return (
    <div className="inline-flex items-center gap-2">
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: 'repeat(3, 4px)' }}
      >
        {[1, 1, 1, 1, 0, 1, 1, 1, 1].map((on, i) => (
          <span
            key={i}
            className={cn(
              'w-[4px] h-[4px] rounded-full',
              on ? 'bg-[var(--color-accent-red)]' : 'bg-transparent',
            )}
          />
        ))}
      </div>
      <span className="font-mono text-sm font-bold tracking-[var(--tracking-widest)] text-[var(--color-text-primary)] uppercase">
        PLATFORM
      </span>
    </div>
  );
}
