/**
 * Avatar — Атом
 * Atomic level: Atom
 *
 * Токены: --color-bg-elevated, --color-border-default, --color-accent-red
 * Состояния: image, initials, anonymous
 * Размеры: xs (24), sm (32), md (40), lg (56), xl (80)
 *
 * Nothing Phone: строгий квадрат (не круг) — геометрическая идентификация
 */
import React from 'react';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  src?: string;
  name?: string;
  size?: AvatarSize;
  online?: boolean;
  style?: React.CSSProperties;
}

const dimMap: Record<AvatarSize, number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
  xl: 80,
};

const fontMap: Record<AvatarSize, string> = {
  xs: 'var(--text-xs)',
  sm: 'var(--text-sm)',
  md: 'var(--text-base)',
  lg: 'var(--text-lg)',
  xl: 'var(--text-xl)',
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ src, name, size = 'md', online, style }: AvatarProps) {
  const dim = dimMap[size];
  const initials = name ? getInitials(name) : '?';

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: dim,
        height: dim,
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-default)',
        borderRadius: 'var(--radius-xs)',
        flexShrink: 0,
        overflow: 'hidden',
        ...style,
      }}
    >
      {src ? (
        <img
          src={src}
          alt={name ?? 'Avatar'}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: fontMap[size],
            fontWeight: 700,
            letterSpacing: 'var(--tracking-wide)',
            color: 'var(--color-text-secondary)',
            userSelect: 'none',
          }}
        >
          {initials}
        </span>
      )}
      {online !== undefined && (
        <span
          style={{
            position: 'absolute',
            bottom: 2,
            right: 2,
            width: size === 'xs' ? 4 : 6,
            height: size === 'xs' ? 4 : 6,
            borderRadius: '50%',
            background: online ? 'var(--color-success)' : 'var(--color-text-tertiary)',
            border: '1px solid var(--color-bg-base)',
          }}
          aria-hidden
        />
      )}
    </span>
  );
}
