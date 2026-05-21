/**
 * Header — Организм
 * Atomic level: Organism
 *
 * Мигрирован на Tailwind CSS v4 + shadcn Button + Avatar (CMP-252).
 * Состав: Avatar (атом) + Mono (атом) + Button (атом)
 * Токены: h-14 (56px), bg-bg-surface, border-border-subtle, z-[200]
 *
 * Nothing Phone: 56px фиксированная высота, строгий border-bottom,
 * имя платформы в Space Mono — dot-matrix сигнатура
 */
import React from 'react';
import { Avatar } from '../atoms/Avatar';
import { Mono } from '../atoms/Typography';
import { Button } from '../atoms/Button';
import { cn } from '../lib/utils';

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
  /** Слот для иконки колокольчика уведомлений — рендерится между логотипом и пользователем */
  notificationBell?: React.ReactNode;
}

export function Header({ user, onLogout, platformName = 'PLATFORM', notificationBell }: HeaderProps) {
  return (
    <header className="sticky top-0 z-[200] h-14 flex items-center justify-between px-6 bg-bg-surface border-b border-border-subtle">
      {/* Логотип — dot-matrix сигнатура */}
      <div className="flex items-center gap-2">
        <DotMatrixLogo />
        <Mono size="sm" className="text-text-primary font-bold tracking-widest">
          {platformName}
        </Mono>
      </div>

      {/* Правая сторона: колокольчик + пользователь + выход */}
      {user && (
        <div className="flex items-center gap-4">
          {notificationBell}

          <div className="flex items-center gap-3">
            <Avatar name={user.name} src={user.avatarSrc} size="sm" />
            <div className="flex flex-col gap-[2px]">
              <Mono size="xs" className="text-text-primary font-bold">
                {user.name}
              </Mono>
              {user.role && (
                <Mono size="xs" className="text-text-tertiary uppercase">
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
      className="grid gap-0.5"
      style={{ gridTemplateColumns: 'repeat(3, 3px)' }}
      aria-hidden
    >
      {[1, 1, 1, 1, 0, 1, 1, 1, 1].map((on, i) => (
        <span
          key={i}
          className={cn(
            'w-[3px] h-[3px] rounded-full',
            on ? 'bg-accent-red' : 'bg-transparent',
          )}
        />
      ))}
    </div>
  );
}
