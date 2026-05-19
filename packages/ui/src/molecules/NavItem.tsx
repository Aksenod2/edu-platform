/**
 * NavItem — Молекула
 * Atomic level: Molecule
 *
 * Состав: иконка (атом, опц.) + Text (атом) + Badge (атом, опц.)
 * Токены: --color-bg-elevated, --color-accent-red, spacing
 * Состояния: default, active, hover, disabled
 *
 * Nothing Phone: минимальный nav item, красная левая полоска = активный
 */
import React from 'react';

export interface NavItemProps {
  label: string;
  href?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export function NavItem({
  label,
  href,
  icon,
  badge,
  active = false,
  disabled = false,
  onClick,
  style,
}: NavItemProps) {
  const Tag = href ? 'a' : 'button';

  return (
    <Tag
      href={href}
      onClick={!disabled ? onClick : undefined}
      aria-current={active ? 'page' : undefined}
      aria-disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        width: '100%',
        padding: 'var(--space-2) var(--space-4)',
        paddingLeft: active ? 'calc(var(--space-4) - 2px)' : 'var(--space-4)',
        borderLeft: active ? '2px solid var(--color-accent-red)' : '2px solid transparent',
        background: active ? 'var(--color-bg-elevated)' : 'transparent',
        border: 'none',
        borderRadius: '0 var(--radius-xs) var(--radius-xs) 0',
        color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        fontWeight: active ? 500 : 400,
        letterSpacing: 'var(--tracking-normal)',
        textDecoration: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.38 : 1,
        transition: 'background var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default)',
        textAlign: 'left',
        ...style,
      }}
    >
      {icon && (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            width: 16,
            height: 16,
            flexShrink: 0,
            color: active ? 'var(--color-accent-red)' : 'var(--color-text-tertiary)',
          }}
        >
          {icon}
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {badge && <span style={{ flexShrink: 0 }}>{badge}</span>}
    </Tag>
  );
}
