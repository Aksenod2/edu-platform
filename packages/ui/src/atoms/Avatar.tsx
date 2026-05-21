/**
 * Avatar — Атом
 * Atomic level: Atom
 *
 * Мигрирован на shadcn/Tailwind v4 (CMP-226).
 * Экспортирует: AvatarRoot, AvatarImage, AvatarFallback (shadcn-style primitives)
 * и удобный wrapper Avatar с полным prop-API.
 *
 * Состояния: image, initials, anonymous
 * Размеры: xs (24px), sm (32px), md (40px), lg (56px), xl (80px)
 *
 * Nothing Phone: строгий квадрат (не круг) — геометрическая идентификация
 */
import React from 'react';
import { cn } from '../lib/utils';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

// ─── Shadcn-style primitives ────────────────────────────────────────

export interface AvatarRootProps {
  size?: AvatarSize;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

const sizeClasses: Record<AvatarSize, string> = {
  xs: 'size-6',   // 24px
  sm: 'size-8',   // 32px
  md: 'size-10',  // 40px
  lg: 'size-14',  // 56px
  xl: 'size-20',  // 80px
};

export function AvatarRoot({ size = 'md', className, style, children }: AvatarRootProps) {
  return (
    <span
      className={cn(
        'relative inline-flex items-center justify-center shrink-0',
        'bg-bg-elevated border border-border-default rounded-xs overflow-hidden',
        sizeClasses[size],
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}

export interface AvatarImageProps {
  src: string;
  alt?: string;
  className?: string;
}

export function AvatarImage({ src, alt = 'Avatar', className }: AvatarImageProps) {
  return (
    <img
      src={src}
      alt={alt}
      className={cn('w-full h-full object-cover', className)}
    />
  );
}

export interface AvatarFallbackProps {
  size?: AvatarSize;
  className?: string;
  children?: React.ReactNode;
}

const fallbackFontClasses: Record<AvatarSize, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
};

export function AvatarFallback({ size = 'md', className, children }: AvatarFallbackProps) {
  return (
    <span
      className={cn(
        'font-mono font-bold tracking-wide text-text-secondary select-none',
        fallbackFontClasses[size],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ─── Online indicator ───────────────────────────────────────────────

interface OnlineIndicatorProps {
  online: boolean;
  size: AvatarSize;
}

function OnlineIndicator({ online, size }: OnlineIndicatorProps) {
  return (
    <span
      className={cn(
        'absolute bottom-0.5 right-0.5 rounded-full border border-bg-base',
        size === 'xs' ? 'size-1' : 'size-[6px]',
        online ? 'bg-success' : 'bg-text-tertiary',
      )}
      aria-hidden
    />
  );
}

// ─── Convenience wrapper (backward-compatible API) ──────────────────

export interface AvatarProps {
  src?: string;
  name?: string;
  size?: AvatarSize;
  online?: boolean;
  className?: string;
  /** @deprecated Используй className; оставлен для обратной совместимости */
  style?: React.CSSProperties;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ src, name, size = 'md', online, className, style }: AvatarProps) {
  const initials = name ? getInitials(name) : '?';

  return (
    <AvatarRoot size={size} className={className} style={style}>
      {src ? (
        <AvatarImage src={src} alt={name ?? 'Avatar'} />
      ) : (
        <AvatarFallback size={size}>{initials}</AvatarFallback>
      )}
      {online !== undefined && <OnlineIndicator online={online} size={size} />}
    </AvatarRoot>
  );
}
