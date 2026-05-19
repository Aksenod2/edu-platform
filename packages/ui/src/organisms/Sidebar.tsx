/**
 * Sidebar — Организм
 * Atomic level: Organism
 *
 * Состав: NavItem[] (молекула) + Divider (атом) + секции навигации
 * Токены: --sidebar-width, --color-bg-surface, --color-border-subtle
 *
 * Nothing Phone: 240px фиксированная колонка, нет скруглений, 1px border-right
 * Активный пункт = красная левая полоска (visually distinct signal)
 */
import React from 'react';
import { NavItem, type NavItemProps } from '../molecules/NavItem';
import { Mono } from '../atoms/Typography';

export interface SidebarSection {
  label?: string;
  items: NavItemProps[];
}

export interface SidebarProps {
  sections: SidebarSection[];
  currentPath?: string;
  footer?: React.ReactNode;
}

export function Sidebar({ sections, currentPath, footer }: SidebarProps) {
  return (
    <aside
      style={{
        width: 'var(--sidebar-width)',
        flexShrink: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg-surface)',
        borderRight: '1px solid var(--color-border-subtle)',
        overflowY: 'auto',
      }}
    >
      <nav
        style={{
          flex: 1,
          paddingBlock: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
        }}
      >
        {sections.map((section, si) => (
          <div key={si}>
            {section.label && (
              <div style={{ paddingInline: 'var(--space-4)', paddingTop: si > 0 ? 'var(--space-4)' : 0, paddingBottom: 'var(--space-2)' }}>
                <Mono
                  size="xs"
                  style={{
                    color: 'var(--color-text-tertiary)',
                    letterSpacing: 'var(--tracking-widest)',
                    textTransform: 'uppercase',
                  }}
                >
                  {section.label}
                </Mono>
              </div>
            )}
            {section.items.map((item, ii) => (
              <NavItem
                key={ii}
                {...item}
                active={currentPath ? item.href === currentPath : item.active}
              />
            ))}
          </div>
        ))}
      </nav>

      {footer && (
        <div
          style={{
            borderTop: '1px solid var(--color-border-subtle)',
            padding: 'var(--space-4)',
          }}
        >
          {footer}
        </div>
      )}
    </aside>
  );
}
