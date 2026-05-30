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
  BookOpen,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@platform/ui/lib/utils';
import { getLessons, createLessonBlock } from '@/lib/api';
import { type LessonBlock } from '@/components/lessons/lesson-block';
import { initials } from '@/components/lessons/teacher-picker';
import { HintCallout } from '@/components/hint-callout';

// Варианты сортировки копилки уроков. Дефолт — по дате создания, старые сверху.
type SortKey =
  | 'created-asc'
  | 'created-desc'
  | 'title-asc'
  | 'title-desc'
  | 'updated-desc';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'created-asc', label: 'По дате создания (старые сверху)' },
  { value: 'created-desc', label: 'По дате создания (новые сверху)' },
  { value: 'title-asc', label: 'По названию (А→Я)' },
  { value: 'title-desc', label: 'По названию (Я→А)' },
  { value: 'updated-desc', label: 'По дате обновления (свежие сверху)' },
];

// Натуральная сортировка названий: «Урок 2» < «Урок 10» (numeric), регистр/диакритика
// игнорируются (sensitivity: 'base') — чтобы нумерованные уроки шли по порядку.
const titleCollator = new Intl.Collator('ru', {
  numeric: true,
  sensitivity: 'base',
});

function compareLessons(a: LessonBlock, b: LessonBlock, sort: SortKey): number {
  switch (sort) {
    case 'created-asc':
      return a.createdAt.localeCompare(b.createdAt);
    case 'created-desc':
      return b.createdAt.localeCompare(a.createdAt);
    case 'updated-desc':
      return b.updatedAt.localeCompare(a.updatedAt);
    case 'title-asc':
      return titleCollator.compare(a.title, b.title);
    case 'title-desc':
      return titleCollator.compare(b.title, a.title);
  }
}

export default function AdminLessonsPage() {
  const router = useRouter();
  const { user, accessToken } = useAuth();

  const [lessons, setLessons] = useState<LessonBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('created-asc');
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
    const matched = q
      ? lessons.filter((l) => l.title.toLowerCase().includes(q))
      : lessons;
    // Не мутируем исходный массив из состояния — сортируем копию.
    return [...matched].sort((a, b) => compareLessons(a, b, sort));
  }, [lessons, search, sort]);

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
        можно проводить в разных группах — не нужно создавать его заново. Когда и
        кому его провести — настраивается в расписании группы.
      </HintCallout>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:max-w-sm sm:flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Поиск по названию..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-full sm:w-auto sm:min-w-[16rem]" aria-label="Сортировка">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        // Скелетоны сетки — плотный каркас вместо одинокого спиннера.
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <LessonCardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        // Пустое состояние в едином стиле админки (border-dashed).
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            {lessons.length === 0 ? (
              <BookOpen className="size-6" />
            ) : (
              <Search className="size-6" />
            )}
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {lessons.length === 0 ? 'Уроков пока нет' : 'Ничего не найдено'}
            </p>
            <p className="text-sm text-muted-foreground">
              {lessons.length === 0
                ? 'Создайте первый блок-урок для копилки.'
                : 'Попробуйте изменить поисковый запрос.'}
            </p>
          </div>
          {lessons.length === 0 && (
            <Button onClick={handleCreate} disabled={creating} className="mt-1">
              {creating ? <Loader2 className="animate-spin" /> : <Plus />}
              Создать урок
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
  const hasVideo = hasVideoFile || hasVideoUrl;
  const hasAssignment = !!lesson.hasAssignment;
  const teachers = lesson.teachers ?? [];

  // Урок без содержимого — приглушаем, чтобы сетка не пестрила «пустыми» блоками.
  const isEmpty = !hasVideo && !hasAssignment && materialsCount === 0;

  // Иконка-плашка урока: подсказывает основной тип содержимого блока.
  const LeadingIcon = hasVideo
    ? hasVideoFile
      ? Film
      : Video
    : hasAssignment
      ? ClipboardList
      : materialsCount > 0
        ? FileText
        : BookOpen;

  // Список метрик содержимого — компактные «иконка + значение».
  const metrics: { key: string; icon: typeof Video; label: string }[] = [];
  if (hasVideo)
    metrics.push({ key: 'video', icon: hasVideoFile ? Film : Video, label: 'видео' });
  if (hasAssignment)
    metrics.push({ key: 'assignment', icon: ClipboardList, label: 'задание' });
  if (materialsCount > 0)
    metrics.push({
      key: 'materials',
      icon: FileText,
      label: `${materialsCount} материал${plural(materialsCount)}`,
    });

  return (
    <Card
      onClick={onOpen}
      className={cn(
        'group cursor-pointer gap-0 overflow-hidden py-0 transition-colors',
        'hover:border-primary/40 hover:bg-muted/40',
      )}
    >
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          {/* Плашка-иконка типа урока */}
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg',
              isEmpty
                ? 'bg-muted text-muted-foreground'
                : 'bg-primary/10 text-primary',
            )}
          >
            <LeadingIcon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground group-hover:text-primary">
              {lesson.title}
            </h3>
            {isEmpty && (
              <Badge
                variant="outline"
                className="mt-1.5 gap-1 border-dashed font-normal text-muted-foreground"
              >
                Пустой блок
              </Badge>
            )}
          </div>
        </div>

        {metrics.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            {metrics.map((m) => (
              <span key={m.key} className="inline-flex items-center gap-1.5">
                <m.icon className="size-3.5" />
                {m.label}
              </span>
            ))}
          </div>
        )}
      </CardContent>

      {/* Подвал карточки с преподавателями — выделен фоном для плотности. */}
      <Separator />
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
        {teachers.length > 0 ? (
          <>
            <AvatarGroup>
              {teachers.slice(0, 3).map((t) => (
                <Avatar key={t.id} size="sm">
                  <AvatarFallback>{initials(t.name)}</AvatarFallback>
                </Avatar>
              ))}
              {teachers.length > 3 && (
                <AvatarGroupCount className="size-6 text-xs">
                  +{teachers.length - 3}
                </AvatarGroupCount>
              )}
            </AvatarGroup>
            <span className="truncate">
              {teachers.length === 1
                ? teachers[0].name
                : `${teachers.length} ${teacherPlural(teachers.length)}`}
            </span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-3.5" />
            Преподаватели не назначены
          </span>
        )}
      </div>
    </Card>
  );
}

// Скелетон карточки урока для состояния загрузки.
function LessonCardSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2 pt-0.5">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-2/5" />
          </div>
        </div>
        <Skeleton className="h-3 w-3/5" />
      </CardContent>
      <Separator />
      <div className="flex items-center gap-2 px-4 py-3">
        <Skeleton className="size-6 rounded-full" />
        <Skeleton className="h-3 w-24" />
      </div>
    </Card>
  );
}

// Русское окончание для «преподаватель/преподавателя/преподавателей».
function teacherPlural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'преподаватель';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20))
    return 'преподавателя';
  return 'преподавателей';
}

// Русское окончание для «материал/материала/материалов».
function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return '';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'а';
  return 'ов';
}
