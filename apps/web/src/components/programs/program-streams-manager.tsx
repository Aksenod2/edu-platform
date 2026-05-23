'use client';

import { useState } from 'react';
import { Link2Off, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { getStreams, updateStream, type Stream } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ProgramStreamsManagerProps {
  programId: string;
  streams: ProgramDetailStream[];
  // Рефетч детали программы после привязки/отвязки.
  onChange: () => Promise<void> | void;
}

type ProgramDetailStream = { id: string; name: string; status: 'active' | 'archived' };

/** Потоки программы: список привязанных + привязка/отвязка через programId потока. */
export function ProgramStreamsManager({
  programId,
  streams,
  onChange,
}: ProgramStreamsManagerProps) {
  const { accessToken } = useAuth();
  const [busy, setBusy] = useState(false);

  // Диалог привязки потока.
  const [addOpen, setAddOpen] = useState(false);
  const [pool, setPool] = useState<Stream[]>([]);
  const [loadingPool, setLoadingPool] = useState(false);
  const [selectedId, setSelectedId] = useState('');

  const unlink = async (streamId: string) => {
    if (!accessToken) return;
    setBusy(true);
    try {
      await updateStream(accessToken, streamId, { programId: null });
      await onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка отвязки группы');
    } finally {
      setBusy(false);
    }
  };

  const openAdd = async () => {
    setSelectedId('');
    setAddOpen(true);
    if (!accessToken) return;
    setLoadingPool(true);
    try {
      const { streams } = await getStreams(accessToken);
      setPool(streams);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки групп');
    } finally {
      setLoadingPool(false);
    }
  };

  const link = async () => {
    if (!accessToken || !selectedId) return;
    setBusy(true);
    try {
      await updateStream(accessToken, selectedId, { programId });
      setAddOpen(false);
      await onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка привязки группы');
    } finally {
      setBusy(false);
    }
  };

  // Потоки, ещё не привязанные к этой программе.
  const linkedIds = new Set(streams.map((s) => s.id));
  // Кандидаты на привязку — только свободные потоки (без программы): привязка
  // потока, уже принадлежащего другой программе, молча переотвязала бы его.
  const candidates = pool.filter((s) => !linkedIds.has(s.id) && !s.programId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Группы программы</CardTitle>
        <CardAction>
          <Button size="sm" onClick={openAdd} disabled={busy}>
            <Plus />
            Привязать группу
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {streams.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            К программе пока не привязана ни одна группа.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {streams.map((stream) => (
              <li
                key={stream.id}
                className="flex items-center gap-3 rounded-lg border px-3 py-2"
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{stream.name}</span>
                  {stream.status === 'active' ? (
                    <Badge variant="secondary">Активный</Badge>
                  ) : (
                    <Badge variant="outline">Архивный</Badge>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={() => unlink(stream.id)}
                >
                  <Link2Off />
                  <span className="sr-only">Отвязать</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Привязать группу</DialogTitle>
            <DialogDescription>
              Выберите группу. В списке только группы, ещё не привязанные к этой программе.
            </DialogDescription>
          </DialogHeader>

          {loadingPool ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Нет доступных групп для привязки.
            </p>
          ) : (
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Выберите группу" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Отмена
            </Button>
            <Button onClick={link} disabled={busy || !selectedId}>
              {busy && <Loader2 className="animate-spin" />}
              Привязать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
