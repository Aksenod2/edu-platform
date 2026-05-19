/**
 * AuthLayout — Шаблон
 * Atomic level: Template
 *
 * Состав: центрированный контейнер + DotMatrix фон
 * Токены: --color-bg-base, spacing
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

export interface AuthLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--color-bg-base)',
        padding: 'var(--space-8)',
        overflow: 'hidden',
      }}
    >
      {/* Dot-matrix фоновый декор */}
      <DotMatrixBackground />

      {/* Форм-карточка */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: 400,
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-default)',
          borderRadius: 'var(--radius-xs)',
          padding: 'var(--space-8)',
        }}
      >
        {/* Логотип и заголовок */}
        <div style={{ marginBottom: 'var(--space-8)', textAlign: 'center' }}>
          <AuthLogo />
          {title && (
            <h1
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-xl)',
                fontWeight: 'var(--font-semibold)' as unknown as number,
                color: 'var(--color-text-primary)',
                letterSpacing: 'var(--tracking-tight)',
                marginTop: 'var(--space-4)',
                marginBottom: subtitle ? 'var(--space-2)' : 0,
              }}
            >
              {title}
            </h1>
          )}
          {subtitle && (
            <p
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-tertiary)',
              }}
            >
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
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        opacity: 0.15,
        pointerEvents: 'none',
      }}
    >
      {dots.map((_, i) => {
        const visible = Math.random() > 0.65;
        return (
          <span
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {visible && (
              <span
                style={{
                  width: 2,
                  height: 2,
                  borderRadius: '50%',
                  background: 'var(--color-border-strong)',
                }}
              />
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
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 4px)',
          gap: 3,
        }}
      >
        {[1,1,1, 1,0,1, 1,1,1].map((on, i) => (
          <span
            key={i}
            style={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: on ? 'var(--color-accent-red)' : 'transparent',
            }}
          />
        ))}
      </div>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          fontWeight: 700,
          letterSpacing: 'var(--tracking-widest)',
          color: 'var(--color-text-primary)',
          textTransform: 'uppercase',
        }}
      >
        PLATFORM
      </span>
    </div>
  );
}
