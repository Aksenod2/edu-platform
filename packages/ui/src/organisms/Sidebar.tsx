/**
 * Sidebar — Организм
 * Atomic level: Organism
 *
 * Мигрирован на Tailwind CSS v4 (CMP-252).
 * Состав: NavItem[] (молекула) + секции навигации
 * Токены: w-60 (240px), bg-bg-surface, border-border-subtle
 *
 * Nothing Phone: 240px фиксированная колонка, нет скруглений, 1px border-right
 * Активный пункт = красная левая полоска (visually distinct signal)
 */
import React from 'react';
import { NavItem, type NavItemProps } from '../molecules/NavItem';
import { Mono } from '../atoms/Typography';
import { cn } from '../lib/utils';

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
    <aside className="w-60 shrink-0 h-full flex flex-col bg-bg-surface border-r border-border-subtle overflow-y-auto">
      <nav className="flex-1 py-4 flex flex-col gap-1">
        {sections.map((section, si) => (
          <div key={si}>
            {section.label && (
              <div className={cn('px-4 pb-2', si > 0 && 'pt-4')}>
                <Mono
                  size="xs"
                  className="text-text-tertiary tracking-widest uppercase"
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
        <div className="border-t border-border-subtle p-4">
          {footer}
        </div>
      )}
    </aside>
  );
}
