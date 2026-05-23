'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';
import {
  Loader2,
  Plus,
  Search,
  Video,
  Film,
  FileText,
  ClipboardList,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getLessons, createLessonBlock } from '@/lib/api';
import { type LessonBlock } from '@/components/lessons/lesson-block';
import { initials } from '@/components/lessons/teacher-picker';
import { HintCallout } from '@/components/hint-callout';

export default function AdminLessonsPage() {
  const router = useRouter();
  const { user, accessToken } = useAuth();

  const [lessons, setLessons] = useState<LessonBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchLessons = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      // Без streamId → копилка блоков-уроков (без расписания).
      const { lessons } = await getLessons(accessToken);
      setLessons(lessons as LessonBlock[]);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки уроков');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (accessToken && user?.role === 'admin') {
      fetchLessons();
    }
  }, [accessToken, user, fetchLessons]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lessons;
    return lessons.filter((l) => l.title.toLowerCase().includes(q));
  }, [lessons, search]);

  const handleCreate = async () => {
    if (!accessToken) return;
    setCreating(true);
    try {
      const { lesson } = await createLessonBlock(accessToken, { title: 'Новый урок' });
      router.push(`/admin/lessons/${lesson.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка создания урока');
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Уроки</h1>
          <p className="text-sm text-muted-foreground">
            Копилка переиспользуемых блоков-уроков.
          </p>
        </div>
        <Button onClick={handleCreate} disabled={creating}>
          {creating ? <Loader2 className="animate-spin" /> : <Plus />}
          Создать урок
        </Button>
      </div>

      <HintCallout storageKey="eduhint:lessons-pool" title="Урок — это переиспользуемый блок">
        Здесь живёт копилка уроков: видео, конспект, материалы и ДЗ. Один урок
        можно проводить в разных потоках — не нужно создавать его заново. Когда и
        кому его провести — настраивается в расписании потока.
      </HintCallout>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Поиск по названию..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {lessons.length === 0
            ? 'Уроков пока нет. Создайте первый блок.'
            : 'Ничего не найдено.'}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((lesson) => (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              onOpen={() => router.push(`/admin/lessons/${lesson.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LessonCard({
  lesson,
  onOpen,
}: {
  lesson: LessonBlock;
  onOpen: () => void;
}) {
  const materialsCount = lesson.materials?.length ?? 0;
  const hasVideoFile = !!lesson.videoFileUrl;
  const hasVideoUrl = !!lesson.videoUrl;

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-muted/50"
      onClick={onOpen}
    >
      <CardHeader>
        <CardTitle className="text-base">{lesson.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(hasVideoFile || hasVideoUrl) && (
            <Badge variant="secondary" className="gap-1 font-normal">
              {hasVideoFile ? <Film className="size-3" /> : <Video className="size-3" />}
              видео
            </Badge>
          )}
          {lesson.hasAssignment && (
            <Badge variant="secondary" className="gap-1 font-normal">
              <ClipboardList className="size-3" />
              задание
            </Badge>
          )}
          {materialsCount > 0 && (
            <Badge variant="secondary" className="gap-1 font-normal">
              <FileText className="size-3" />
              {materialsCount} материал{plural(materialsCount)}
            </Badge>
          )}
          {!hasVideoFile && !hasVideoUrl && !lesson.hasAssignment && materialsCount === 0 && (
            <span className="text-xs text-muted-foreground">Пустой блок</span>
          )}
        </div>

        {lesson.teachers && lesson.teachers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {lesson.teachers.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1.5 text-xs">
                <Avatar size="sm">
                  <AvatarFallback>{initials(t.name)}</AvatarFallback>
                </Avatar>
                <span className="text-muted-foreground">{t.name}</span>
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Русское окончание для «материал/материала/материалов».
function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return '';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'а';
  return 'ов';
}
