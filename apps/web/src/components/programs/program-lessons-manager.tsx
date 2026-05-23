'use client';

import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ClipboardList,
  Loader2,
  Plus,
  Trash2,
  Video,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import {
  addProgramLesson,
  getLessons,
  removeProgramLesson,
  reorderProgramLessons,
  type Lesson,
  type ProgramLesson,
} from '@/lib/api';
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

interface ProgramLessonsManagerProps {
  programId: string;
  lessons: ProgramLesson[];
  // Рефетч детали программы после любой мутации состава.
  onChange: () => Promise<void> | void;
}

/** Состав уроков программы: упорядоченный список + перестановка, удаление, добавление. */
export function ProgramLessonsManager({
  programId,
  lessons,
  onChange,
}: ProgramLessonsManagerProps) {
  const { accessToken } = useAuth();
  const [busy, setBusy] = useState(false);

  // Диалог добавления урока из копилки блоков.
  const [addOpen, setAddOpen] = useState(false);
  const [pool, setPool] = useState<Lesson[]>([]);
  const [loadingPool, setLoadingPool] = useState(false);
  const [selectedId, setSelectedId] = useState('');

  const move = async (index: number, dir: -1 | 1) => {
    if (!accessToken) return;
    const target = index + dir;
    if (target < 0 || target >= lessons.length) return;
    const ids = lessons.map((l) => l.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(true);
    try {
      await reorderProgramLessons(accessToken, programId, ids);
      await onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка изменения порядка');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (lessonId: string) => {
    if (!accessToken) return;
    setBusy(true);
    try {
      await removeProgramLesson(accessToken, programId, lessonId);
      await onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления урока');
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
      const { lessons } = await getLessons(accessToken);
      setPool(lessons);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки блоков');
    } finally {
      setLoadingPool(false);
    }
  };

  const add = async () => {
    if (!accessToken || !selectedId) return;
    setBusy(true);
    try {
      await addProgramLesson(accessToken, programId, selectedId);
      setAddOpen(false);
      await onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка добавления урока');
    } finally {
      setBusy(false);
    }
  };

  // Блоки копилки, которых ещё нет в программе.
  const existingIds = new Set(lessons.map((l) => l.id));
  const candidates = pool.filter((l) => !existingIds.has(l.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Состав уроков</CardTitle>
        <CardAction>
          <Button size="sm" onClick={openAdd} disabled={busy}>
            <Plus />
            Добавить урок
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {lessons.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            В программе пока нет уроков — добавьте блок из копилки.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {lessons.map((lesson, index) => (
              <li
                key={lesson.id}
                className="flex items-center gap-3 rounded-lg border px-3 py-2"
              >
                <span className="w-6 shrink-0 text-sm tabular-nums text-muted-foreground">
                  {index + 1}.
                </span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{lesson.title}</span>
                  {lesson.hasVideo && (
                    <Badge variant="secondary">
                      <Video />
                      Видео
                    </Badge>
                  )}
                  {lesson.hasAssignment && (
                    <Badge variant="secondary">
                      <ClipboardList />
                      Задание
                    </Badge>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                    <span className="sr-only">Выше</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    disabled={busy || index === lessons.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                    <span className="sr-only">Ниже</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => remove(lesson.id)}
                  >
                    <Trash2 />
                    <span className="sr-only">Убрать из программы</span>
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Добавить урок</DialogTitle>
            <DialogDescription>
              Выберите блок-урок из копилки. В списке только блоки, которых ещё нет в программе.
            </DialogDescription>
          </DialogHeader>

          {loadingPool ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Нет доступных блоков для добавления.
            </p>
          ) : (
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Выберите блок-урок" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Отмена
            </Button>
            <Button onClick={add} disabled={busy || !selectedId}>
              {busy && <Loader2 className="animate-spin" />}
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
