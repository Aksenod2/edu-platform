/**
 * Student navigation — shared across all student dashboard pages.
 * Extracted to avoid copy-paste across 5+ pages.
 */
import React from 'react';

export const STUDENT_NAV = [
  {
    label: 'Обучение',
    items: [
      { label: 'Обзор',        href: '/dashboard',               icon: <GridIcon /> },
      { label: 'Уроки',        href: '/dashboard/lessons',       icon: <BookIcon /> },
      { label: 'Задания',      href: '/dashboard/assignments',   icon: <ClipboardIcon /> },
      { label: 'Тред',         href: '/dashboard/thread',        icon: <ChatIcon /> },
      { label: 'Расписание',   href: '/dashboard/schedule',      icon: <CalendarIcon /> },
      { label: 'Материалы',    href: '/dashboard/materials',     icon: <FolderIcon /> },
      { label: 'Профиль',      href: '/dashboard/profile',       icon: <UserIcon /> },
      { label: 'Настройки',    href: '/dashboard/settings',      icon: <GearIcon /> },
    ],
  },
];

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="5" height="5" />
      <rect x="10" y="1" width="5" height="5" />
      <rect x="1" y="10" width="5" height="5" />
      <rect x="10" y="10" width="5" height="5" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 2h10v12H3z" />
      <path d="M6 2v12M6 5h4M6 8h4M6 11h4" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="2" width="10" height="13" rx="1" />
      <path d="M6 1h4v2H6zM6 6h4M6 9h4M6 12h2" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 2h12v9H5l-3 3V2z" />
      <path d="M5 6h6M5 9h3" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3" width="14" height="12" />
      <path d="M1 7h14M5 1v4M11 1v4" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="5" r="3" />
      <path d="M2 15c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 4h5l2 2h7v8H1z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13" />
    </svg>
  );
}
