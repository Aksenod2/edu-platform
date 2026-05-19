/**
 * Header — Организм
 * Atomic level: Organism
 *
 * Состав: Avatar (атом) + Text (атом) + Divider (атом) + Button (атом)
 * Токены: --header-height, --color-bg-surface, --color-border-subtle
 *
 * Nothing Phone: 56px фиксированная высота, строгий border-bottom,
 * имя платформы в Space Mono — dot-matrix сигнатура
 */
import React from 'react';
import { Avatar } from '../atoms/Avatar';
import { Mono } from '../atoms/Typography';
import { Button } from '../atoms/Button';

export interface HeaderUser {
  name: string;
  email?: string;
  avatarSrc?: string;
  role?: 'admin' | 'student';
}

export interface HeaderProps {
  user?: HeaderUser;
  onLogout?: () => void;
  platformName?: string;
}

export function Header({ user, onLogout, platformName = 'PLATFORM' }: HeaderProps) {
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 'var(--z-sticky)' as unknown as number,
        height: 'var(--header-height)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingInline: 'var(--space-6)',
        background: 'var(--color-bg-surface)',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      {/* Логотип — dot-matrix сигнатура */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <DotMatrixLogo />
        <Mono size="sm" style={{ color: 'var(--color-text-primary)', fontWeight: 700, letterSpacing: 'var(--tracking-widest)' }}>
          {platformName}
        </Mono>
      </div>

      {/* Правая сторона: пользователь + выход */}
      {user && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <Avatar name={user.name} src={user.avatarSrc} size="sm" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Mono size="xs" style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>
                {user.name}
              </Mono>
              {user.role && (
                <Mono size="xs" style={{ color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>
                  {user.role === 'admin' ? 'TEACHER' : 'STUDENT'}
                </Mono>
              )}
            </div>
          </div>

          {onLogout && (
            <Button variant="ghost" size="sm" onClick={onLogout}>
              EXIT
            </Button>
          )}
        </div>
      )}
    </header>
  );
}

// Dot-matrix логотип — 3×3 сетка точек, Nothing Phone фирменный элемент
function DotMatrixLogo() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 3px)',
        gap: '2px',
      }}
      aria-hidden
    >
      {[1,1,1, 1,0,1, 1,1,1].map((on, i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: 3,
            borderRadius: '50%',
            background: on ? 'var(--color-accent-red)' : 'transparent',
          }}
        />
      ))}
    </div>
  );
}
