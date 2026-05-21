'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { getStreams, getAssignments, type Stream, type Assignment, type AssignmentMaterial } from '@/lib/api';
import { cn } from '@platform/ui/lib/utils';

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
  const { user, accessToken } = useAuth();

  const [rows, setRows] = useState<MaterialRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [streamFilter, setStreamFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'file' | 'url'>('all');
  const [streams, setStreams] = useState<Stream[]>([]);

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

  const filteredRows = rows.filter((row) => {
    if (streamFilter && row.stream.id !== streamFilter) return false;
    if (typeFilter !== 'all' && row.material.type !== typeFilter) return false;
    return true;
  });

  const fileCount = rows.filter((r) => r.material.type === 'file').length;
  const urlCount = rows.filter((r) => r.material.type === 'url').length;

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Материалы</h1>
          <p className="text-sm text-muted-foreground">Все файлы и ссылки, прикреплённые к заданиям</p>
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-6 mb-6">
        {[
          { label: 'Всего', value: rows.length },
          { label: 'Файлов', value: fileCount },
          { label: 'Ссылок', value: urlCount },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">{label}:</span>
            <span className="font-mono text-xs font-bold text-foreground">{value}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <Select value={streamFilter || 'all'} onValueChange={(v) => setStreamFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-full max-w-xs">
            <SelectValue placeholder="Все потоки" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все потоки</SelectItem>
            {streams.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex">
          {(['all', 'file', 'url'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                'font-mono text-xs px-3 py-2 uppercase tracking-wider',
                'border',
                '-ml-px first:ml-0',
                'transition-colors',
                typeFilter === t
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t === 'all' ? 'Все' : t === 'file' ? 'Файлы' : 'Ссылки'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loadingData ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground border rounded-md">
          <span className="text-3xl opacity-20" aria-hidden>📁</span>
          <span className="font-mono text-xs uppercase tracking-wider">
            Материалы не найдены
          </span>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                {['Тип', 'Название', 'Задание', 'Поток', 'Размер'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left font-mono text-xs uppercase tracking-widest text-muted-foreground whitespace-nowrap"
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
                    className="border-b hover:bg-muted transition-colors group"
                  >
                    <td className="px-4 py-3">
                      <Badge variant={row.material.type === 'file' ? 'outline' : 'secondary'}>
                        {typeLabel}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      {row.material.type === 'url' ? (
                        <a
                          href={row.material.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-foreground hover:underline truncate block"
                        >
                          {row.material.name}
                        </a>
                      ) : (
                        <a
                          href={row.material.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-foreground hover:text-muted-foreground truncate block"
                        >
                          {row.material.name}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
                        {row.assignment.title}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        {row.stream.name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-muted-foreground">
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
    </>
  );
}
