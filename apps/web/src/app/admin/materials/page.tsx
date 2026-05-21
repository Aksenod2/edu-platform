'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import { DashboardLayout, PageHeader } from '@platform/ui/templates';
import { Spinner, Badge } from '@platform/ui/atoms';
import { getStreams, getAssignments, type Stream, type Assignment, type AssignmentMaterial } from '@/lib/api';
import { cn } from '@platform/ui/lib/utils';

const ADMIN_NAV = [
  {
    label: 'Управление',
    items: [
      { label: 'Обзор',        href: '/admin',               icon: <GridIcon /> },
      { label: 'Ученики',      href: '/admin/students',      icon: <UsersIcon /> },
      { label: 'Потоки',       href: '/admin/streams',       icon: <StreamIcon /> },
      { label: 'Расписание',   href: '/admin/schedule',      icon: <CalendarIcon /> },
    ],
  },
  {
    label: 'Контент',
    items: [
      { label: 'Материалы',    href: '/admin/materials',     icon: <FolderIcon /> },
    ],
  },
  {
    label: 'Система',
    items: [
      { label: 'Уведомления',  href: '/admin/notifications', icon: <BellNavIcon /> },
      { label: 'API-ключи',    href: '/admin/api-keys',      icon: <KeyIcon /> },
      { label: 'Настройки',    href: '/admin/settings',      icon: <SettingsIcon /> },
    ],
  },
];

interface MaterialRow {
  material: AssignmentMaterial;
  assignment: Assignment;
  stream: Stream;
}

const FILE_TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF',
  doc: 'DOC',
  docx: 'DOCX',
  xls: 'XLS',
  xlsx: 'XLSX',
  ppt: 'PPT',
  pptx: 'PPTX',
  mp4: 'VIDEO',
  mov: 'VIDEO',
  avi: 'VIDEO',
  mp3: 'AUDIO',
  zip: 'ZIP',
  png: 'IMG',
  jpg: 'IMG',
  jpeg: 'IMG',
  gif: 'IMG',
  svg: 'IMG',
};

function getFileExt(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function formatSize(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MaterialsPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [rows, setRows] = useState<MaterialRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [streamFilter, setStreamFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'file' | 'url'>('all');
  const [streams, setStreams] = useState<Stream[]>([]);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user && user.role !== 'admin') router.push('/dashboard');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoadingData(true);
    try {
      const { streams: allStreams } = await getStreams(accessToken);
      setStreams(allStreams);
      const activeStreams = allStreams.filter((s) => s.status === 'active');
      const allRows: MaterialRow[] = [];
      await Promise.all(
        activeStreams.map(async (stream) => {
          const { assignments } = await getAssignments(accessToken, stream.id);
          for (const assignment of assignments) {
            for (const material of assignment.materials ?? []) {
              allRows.push({ material, assignment, stream });
            }
          }
        }),
      );
      setRows(allRows);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки материалов');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (accessToken && user?.role === 'admin') fetchData();
  }, [accessToken, user, fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user || user.role !== 'admin') return null;

  const filteredRows = rows.filter((row) => {
    if (streamFilter && row.stream.id !== streamFilter) return false;
    if (typeFilter !== 'all' && row.material.type !== typeFilter) return false;
    return true;
  });

  const fileCount = rows.filter((r) => r.material.type === 'file').length;
  const urlCount = rows.filter((r) => r.material.type === 'url').length;

  return (
    <DashboardLayout
      currentPath={pathname}
      header={{
        user: { name: user.name, role: 'admin' },
        onLogout: async () => {
          await logout();
          router.push('/login');
        },
        platformName: 'PLATFORM ADMIN',
        notificationBell: <NotificationBell />,
      }}
      sidebar={{ sections: ADMIN_NAV }}
    >
      <PageHeader
        title="Материалы"
        subtitle="Все файлы и ссылки, прикреплённые к заданиям"
      />

      {/* Stats */}
      <div className="flex gap-6 mb-6">
        {[
          { label: 'Всего', value: rows.length },
          { label: 'Файлов', value: fileCount },
          { label: 'Ссылок', value: urlCount },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="font-mono text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider">{label}:</span>
            <span className="font-mono text-xs font-bold text-[var(--color-text-primary)]">{value}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <select
          value={streamFilter}
          onChange={(e) => setStreamFilter(e.target.value)}
          className={cn(
            'font-mono text-xs px-3 py-2',
            'bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)]',
            'border border-[var(--color-border-default)]',
            'focus:outline-none focus:border-[var(--color-accent-red)]',
          )}
        >
          <option value="">Все потоки</option>
          {streams.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <div className="flex">
          {(['all', 'file', 'url'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                'font-mono text-xs px-3 py-2 uppercase tracking-wider',
                'border border-[var(--color-border-default)]',
                '-ml-px first:ml-0',
                'transition-colors duration-[var(--duration-fast)]',
                typeFilter === t
                  ? 'bg-[var(--color-text-primary)] text-[var(--color-text-inverse)] border-[var(--color-text-primary)]'
                  : 'bg-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
              )}
            >
              {t === 'all' ? 'Все' : t === 'file' ? 'Файлы' : 'Ссылки'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 border border-[var(--color-error)] bg-[var(--color-error-dim)] font-mono text-xs text-[var(--color-error)]">
          {error}
        </div>
      )}

      {loadingData ? (
        <div className="flex justify-center py-12">
          <Spinner size="md" />
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border border-[var(--color-border-subtle)] gap-3">
          <span className="text-3xl opacity-20" aria-hidden>📁</span>
          <span className="font-mono text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider">
            Материалы не найдены
          </span>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border-strong)]">
                {['Тип', 'Название', 'Задание', 'Поток', 'Размер'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left font-mono text-xs uppercase tracking-widest text-[var(--color-text-tertiary)] whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, idx) => {
                const ext = getFileExt(row.material.name);
                const typeLabel = FILE_TYPE_LABELS[ext] ?? (row.material.type === 'url' ? 'URL' : 'FILE');
                return (
                  <tr
                    key={idx}
                    className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-elevated)] transition-colors group"
                  >
                    <td className="px-4 py-3">
                      <Badge variant={row.material.type === 'file' ? 'default' : 'info'}>
                        {typeLabel}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      {row.material.type === 'url' ? (
                        <a
                          href={row.material.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-sans text-sm text-[var(--color-accent-red)] hover:underline truncate block"
                        >
                          {row.material.name}
                        </a>
                      ) : (
                        <a
                          href={row.material.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-sans text-sm text-[var(--color-text-primary)] hover:text-[var(--color-accent-red)] truncate block"
                        >
                          {row.material.name}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-sans text-sm text-[var(--color-text-secondary)] truncate max-w-[200px] block">
                        {row.assignment.title}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-[var(--color-text-tertiary)]">
                        {row.stream.name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-[var(--color-text-tertiary)]">
                        {formatSize(row.material.size)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

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
function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="5" r="3" />
      <path d="M1 14c0-3 2-5 5-5s5 2 5 5" />
      <circle cx="12" cy="4" r="2" />
      <path d="M15 13c0-2-1-4-3-4" />
    </svg>
  );
}
function StreamIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 4h12M2 8h8M2 12h10" />
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
function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 4a1 1 0 011-1h4l2 2h6a1 1 0 011 1v7a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" />
    </svg>
  );
}
function BellNavIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5a4.5 4.5 0 0 1 4.5 4.5c0 2.5 1 3.5 1 4H2.5s1-1.5 1-4A4.5 4.5 0 0 1 8 2.5z" />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" />
      <path d="M8 2.5V1" />
    </svg>
  );
}
function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="3.5" />
      <path d="M8.5 8.5l5.5 5.5M11 11l1.5 1.5" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
    </svg>
  );
}
