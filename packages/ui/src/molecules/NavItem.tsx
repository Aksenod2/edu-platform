/**
 * NavItem — Молекула
 * Atomic level: Molecule
 *
 * Rebuilt on Tailwind CSS v4 (CMP-251).
 * Состав: иконка (атом, опц.) + Text (атом) + Badge (атом, опц.)
 * Токены: через @theme — bg-bg-elevated, border-accent-red, text-*, gap-*
 * Состояния: default, active, hover, disabled
 *
 * Nothing Phone: минимальный nav item, красная левая полоска = активный
 */
import React from 'react';
import { cn } from '../lib/utils';

export interface NavItemProps {
  label: string;
  href?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  /** @deprecated используй className */
  style?: React.CSSProperties;
}

const sharedClasses = (active: boolean, disabled: boolean, className?: string) =>
  cn(
    // Layout
    'flex items-center gap-3 w-full',
    'py-2 pr-4',
    // Left border indicator (Nothing Phone: красная полоска = активный)
    'border-l-2',
    active
      ? 'border-l-accent-red pl-[calc(1rem-2px)]'
      : 'border-l-transparent pl-4',
    // Background
    active ? 'bg-bg-elevated' : 'bg-transparent',
    // Right corners only — Nothing: borderRadius: 0 2px 2px 0
    'rounded-r-xs',
    // Typography
    'font-sans text-sm text-left no-underline',
    active ? 'text-text-primary font-medium' : 'text-text-secondary font-normal',
    // State
    disabled ? 'opacity-[0.38] cursor-not-allowed' : 'cursor-pointer',
    // Transitions
    'transition-colors duration-fast',
    className,
  );

export function NavItem({
  label,
  href,
  icon,
  badge,
  active = false,
  disabled = false,
  onClick,
  className,
  style,
}: NavItemProps) {
  const classes = sharedClasses(active, disabled, className);
  const handleClick = !disabled ? onClick : undefined;

  const content = (
    <>
      {icon && (
        <span
          className={cn(
            'flex items-center shrink-0 w-4 h-4',
            active ? 'text-accent-red' : 'text-text-tertiary',
          )}
        >
          {icon}
        </span>
      )}
      <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
        {label}
      </span>
      {badge && <span className="shrink-0">{badge}</span>}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        onClick={handleClick}
        aria-current={active ? 'page' : undefined}
        aria-disabled={disabled || undefined}
        className={classes}
        style={style}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-current={active ? 'page' : undefined}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      className={classes}
      style={style}
    >
      {content}
    </button>
  );
}
