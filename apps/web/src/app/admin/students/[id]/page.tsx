'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  Download,
  FileText,
  Loader2,
  RotateCcw,
  ScrollText,
  Users,
  Wallet,
} from 'lucide-react';
import { cn } from '@platform/ui/lib/utils';
import { FileLightbox } from '@/components/files/file-lightbox';
import { StudentDynamicTab } from '@/components/students/student-dynamic-tab';
import { StudentActivityTab } from '@/components/students/student-activity-tab';
import { BackButton } from '@/components/back-button';
import { ThreadConversation } from '@/components/thread-conversation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import {
  getProfile,
  addTeacherNote,
  getStudentAssignments,
  updateStudentAssignment,
  getStudentAssignmentsSummary,
  getWallet,
  topupWallet,
  debitWallet,
  getStudents,
  updateStudent,
  getUserConsents,
  deleteUserConsents,
  formatKopecks,
  fileDownloadUrl,
  CONSENT_ACTION_LABELS,
  CONSENT_TYPE_LABELS,
  type ProfileResponse,
  type TeacherNote,
  type StudentAssignment,
  type AssignmentsSummary,
  type UserConsent,
  type WalletTransaction,
} from '@/lib/api';
import { STATUS_LABELS, STATUS_VARIANT } from '@/lib/assignment-status';
import { PlanEventDialog } from '@/components/schedule/plan-event-dialog';

type Tab = 'profile' | 'dynamic' | 'activity' | 'assignments' | 'thread';

export default function StudentProfilePage() {
  const { accessToken } = useAuth();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentId = params.id as string;

  // Активная вкладка синхронизирована с ?tab= — это позволяет вести на чат ученика
  // прямой ссылкой /admin/students/:id?tab=thread (раньше для этого была отдельная
  // страница /thread).
  const tabParam = searchParams.get('tab');
  // По умолчанию открываем «Динамику» (первая вкладка); прочие — по ?tab=.
  const initialTab: Tab =
    tabParam === 'profile' ||
    tabParam === 'activity' ||
    tabParam === 'assignments' ||
    tabParam === 'thread'
      ? tabParam
      : 'dynamic';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  const handleTabChange = (value: Tab) => {
    setActiveTab(value);
    const query = new URLSearchParams(searchParams.toString());
    query.set('tab', value);
    router.replace(`/admin/students/${studentId}?${query.toString()}`, { scroll: false });
  };
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [error, setError] = useState('');

  // Notes state
  const [noteContent, setNoteContent] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Assignments state
  const [assignments, setAssignments] = useState<StudentAssignment[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [assignmentsSummary, setAssignmentsSummary] = useState<AssignmentsSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [pendingRevision, setPendingRevision] = useState<StudentAssignment | null>(null);
  // Текст разбора, который преподаватель пишет к сдаче (по id назначения).
  const [reviewTexts, setReviewTexts] = useState<Record<string, string>>({});
  // Подсветка обязательной причины при «На доработку» (по id назначения).
  const [reviewErrors, setReviewErrors] = useState<Record<string, boolean>>({});

  // Wallet state (баланс кошелька + история операций; суммы в копейках)
  const [balanceKopecks, setBalanceKopecks] = useState<number | null>(null);
  const [walletTx, setWalletTx] = useState<WalletTransaction[]>([]);
  const [loadingWallet, setLoadingWallet] = useState(false);
  const [topupRubles, setTopupRubles] = useState('');
  const [topupNote, setTopupNote] = useState('');
  const [debitRubles, setDebitRubles] = useState('');
  const [debitNote, setDebitNote] = useState('');
  const [walletSubmitting, setWalletSubmitting] = useState(false);

  // Юридические согласия участника (append-only журнал; грузим при открытии
  // вкладки «Профиль»). Пустой список — норма для старых участников.
  const [consents, setConsents] = useState<UserConsent[]>([]);
  const [loadingConsents, setLoadingConsents] = useState(false);
  const [consentsError, setConsentsError] = useState('');
  // Сброс журнала согласий — только для демо-аккаунтов (подтверждение + запрос).
  const [resetConsentsOpen, setResetConsentsOpen] = useState(false);
  const [resettingConsents, setResettingConsents] = useState(false);

  // Демо/служебный аккаунт. Профиль (getProfile) этот флаг не отдаёт, поэтому
  // начальное значение берём из списка студентов (getStudents отдаёт isDemo).
  // null = ещё не загружено (тумблер disabled до получения значения).
  const [isDemo, setIsDemo] = useState<boolean | null>(null);
  const [togglingDemo, setTogglingDemo] = useState(false);

  // Отмечаем, что вкладка уже загружалась, чтобы не дёргать запрос повторно.
  // Раньше условием было `.length === 0`, и для пустого списка это
  // зацикливало загрузку (спиннер мигал поверх пустого состояния).
  const fetchedRef = useRef({ assignments: false, summary: false, consents: false });

  const fetchProfile = useCallback(async () => {
    if (!accessToken || !studentId) return;
    setLoadingProfile(true);
    try {
      const result = await getProfile(accessToken, studentId);
      setData(result);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки профиля');
    } finally {
      setLoadingProfile(false);
    }
  }, [accessToken, studentId]);

  const fetchWallet = useCallback(async () => {
    if (!accessToken || !studentId) return;
    setLoadingWallet(true);
    try {
      const result = await getWallet(accessToken, studentId);
      setBalanceKopecks(result.balanceKopecks);
      setWalletTx(result.transactions);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки баланса');
    } finally {
      setLoadingWallet(false);
    }
  }, [accessToken, studentId]);

  // Начальное значение демо-флага (профиль его не отдаёт — берём из /users).
  const fetchDemoFlag = useCallback(async () => {
    if (!accessToken || !studentId) return;
    try {
      const { users } = await getStudents(accessToken);
      const me = users.find((u) => u.id === studentId);
      setIsDemo(me?.isDemo ?? false);
    } catch {
      // Некритично: при сбое оставим тумблер недоступным (isDemo=null).
    }
  }, [accessToken, studentId]);

  const handleToggleDemo = async (next: boolean) => {
    if (!accessToken) return;
    setTogglingDemo(true);
    try {
      const { user } = await updateStudent(accessToken, studentId, { isDemo: next });
      setIsDemo(user.isDemo ?? next);
      toast.success(next ? 'Аккаунт помечен как демо' : 'Демо-метка снята');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось изменить демо-флаг');
    } finally {
      setTogglingDemo(false);
    }
  };

  const fetchConsents = useCallback(async () => {
    if (!accessToken || !studentId) return;
    setLoadingConsents(true);
    try {
      const result = await getUserConsents(accessToken, studentId);
      setConsents(result.consents);
      setConsentsError('');
    } catch (err) {
      setConsentsError(err instanceof Error ? err.message : 'Ошибка загрузки согласий');
    } finally {
      setLoadingConsents(false);
    }
  }, [accessToken, studentId]);

  // Сброс журнала согласий демо-аккаунта. Сообщения 403 («не демо») и 404
  // приходят с бэкенда уже человекочитаемыми — показываем их как есть.
  const handleResetConsents = async () => {
    if (!accessToken) return;
    setResettingConsents(true);
    try {
      const { deleted } = await deleteUserConsents(accessToken, studentId);
      setConsents([]);
      setConsentsError('');
      toast.success(
        deleted > 0
          ? `Журнал согласий очищен (удалено записей: ${deleted})`
          : 'Журнал согласий уже пуст',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сбросить согласия');
    } finally {
      setResettingConsents(false);
    }
  };

  const fetchAssignments = useCallback(async () => {
    if (!accessToken || !studentId) return;
    setLoadingAssignments(true);
    try {
      const result = await getStudentAssignments(accessToken, { studentId });
      setAssignments(result.studentAssignments);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки заданий');
    } finally {
      setLoadingAssignments(false);
    }
  }, [accessToken, studentId]);

  const fetchSummary = useCallback(async () => {
    if (!accessToken || !studentId) return;
    setLoadingSummary(true);
    try {
      const result = await getStudentAssignmentsSummary(accessToken, studentId);
      setAssignmentsSummary(result.summary);
    } catch {
      // summary не критична
    } finally {
      setLoadingSummary(false);
    }
  }, [accessToken, studentId]);

  useEffect(() => {
    if (accessToken && studentId) {
      fetchProfile();
      fetchWallet();
      fetchDemoFlag();
    }
  }, [accessToken, studentId, fetchProfile, fetchWallet, fetchDemoFlag]);

  // При смене ученика сбрасываем «уже загружено» и устаревшие данные вкладок,
  // чтобы они перезагрузились для нового ученика.
  useEffect(() => {
    fetchedRef.current = { assignments: false, summary: false, consents: false };
    setAssignments([]);
    setAssignmentsSummary(null);
    setConsents([]);
    setConsentsError('');
    setIsDemo(null);
  }, [studentId]);

  // Согласия грузим лениво — при первом открытии вкладки «Профиль».
  useEffect(() => {
    if (accessToken && studentId && activeTab === 'profile' && !fetchedRef.current.consents) {
      fetchedRef.current.consents = true;
      fetchConsents();
    }
  }, [accessToken, studentId, activeTab, fetchConsents]);

  useEffect(() => {
    if (accessToken && studentId && activeTab === 'assignments') {
      if (!fetchedRef.current.assignments && !loadingAssignments) {
        fetchedRef.current.assignments = true;
        fetchAssignments();
      }
      if (!fetchedRef.current.summary && !loadingSummary) {
        fetchedRef.current.summary = true;
        fetchSummary();
      }
    }
  }, [accessToken, studentId, activeTab, loadingAssignments, fetchAssignments, loadingSummary, fetchSummary]);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !noteContent.trim()) return;
    setSavingNote(true);
    try {
      const { note } = await addTeacherNote(accessToken, studentId, noteContent.trim());
      setData((prev) => {
        if (!prev) return prev;
        return { ...prev, notes: [note, ...(prev.notes || [])] };
      });
      setNoteContent('');
      toast.success('Заметка добавлена');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка добавления заметки');
    } finally {
      setSavingNote(false);
    }
  };

  // Рубли (строка из инпута) → копейки (целое). null, если ввод некорректный.
  const rublesToKopecks = (input: string): number | null => {
    const normalized = input.trim().replace(',', '.');
    if (!normalized) return null;
    const rubles = Number(normalized);
    if (!Number.isFinite(rubles) || rubles <= 0) return null;
    return Math.round(rubles * 100);
  };

  const handleTopup = async () => {
    if (!accessToken) return;
    const amountKopecks = rublesToKopecks(topupRubles);
    if (amountKopecks === null) {
      toast.error('Введите корректную сумму в рублях');
      return;
    }
    setWalletSubmitting(true);
    try {
      const { balanceKopecks: newBalance, transaction } = await topupWallet(accessToken, studentId, {
        amountKopecks,
        note: topupNote.trim() || undefined,
      });
      setBalanceKopecks(newBalance);
      setWalletTx((prev) => [transaction, ...prev]);
      setTopupRubles('');
      setTopupNote('');
      toast.success('Баланс пополнен');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка пополнения');
    } finally {
      setWalletSubmitting(false);
    }
  };

  const handleDebit = async () => {
    if (!accessToken) return;
    const amountKopecks = rublesToKopecks(debitRubles);
    if (amountKopecks === null) {
      toast.error('Введите корректную сумму в рублях');
      return;
    }
    setWalletSubmitting(true);
    try {
      const { balanceKopecks: newBalance, transaction } = await debitWallet(accessToken, studentId, {
        amountKopecks,
        note: debitNote.trim() || undefined,
      });
      setBalanceKopecks(newBalance);
      setWalletTx((prev) => [transaction, ...prev]);
      setDebitRubles('');
      setDebitNote('');
      toast.success('Списано с баланса');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка списания');
    } finally {
      setWalletSubmitting(false);
    }
  };

  const handleUpdateAssignment = async (saId: string, status: 'submitted' | 'reviewed' | 'needs_revision') => {
    if (!accessToken) return;
    const reviewText = reviewTexts[saId]?.trim();
    // Для «На доработку» причина обязательна (бэкенд отвечает 400 на пустую) —
    // валидируем до запроса и подсвечиваем поле.
    if (status === 'needs_revision' && !reviewText) {
      setReviewErrors((prev) => ({ ...prev, [saId]: true }));
      toast.error('Укажите причину доработки — она видна студенту.');
      return;
    }
    setUpdatingId(saId);
    try {
      const { studentAssignment } = await updateStudentAssignment(accessToken, saId, {
        status,
        reviewText: reviewText || undefined,
      });
      setAssignments((prev) => prev.map((a) => (a.id === saId ? studentAssignment : a)));
      setReviewTexts((prev) => {
        const next = { ...prev };
        delete next[saId];
        return next;
      });
      setReviewErrors((prev) => {
        const next = { ...prev };
        delete next[saId];
        return next;
      });
      fetchSummary();
      toast.success('Статус обновлён');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка обновления статуса');
    } finally {
      setUpdatingId(null);
    }
  };

  if (loadingProfile) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-4">
        <BackButton
          fallbackHref="/admin/students"
          className="h-auto px-2 text-muted-foreground"
          icon={<ChevronLeft className="size-4" />}
        >
          К списку студентов
        </BackButton>
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!data) return null;

  const { student, profile, notes } = data;

  const now = new Date();
  const filteredAssignments = statusFilter === 'all'
    ? assignments
    : statusFilter === 'overdue'
      ? assignments.filter((a) => {
          if (a.status === 'reviewed') return false;
          const dueDate = a.assignment?.dueDate;
          return dueDate && new Date(dueDate) < now;
        })
      : assignments.filter((a) => a.status === statusFilter);

  return (
    <>
      <div className="flex flex-1 flex-col min-h-0">

        {/* ── Header ── */}
        <div>
          <BackButton
            fallbackHref="/admin/students"
            className="-ml-2 h-auto px-2 text-muted-foreground"
            icon={<ChevronLeft className="size-4" />}
          >
            К списку студентов
          </BackButton>

          <div className="mt-2 mb-1 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h1 className="m-0 text-xl font-bold tracking-tight text-foreground">
                  {student.name}
                  {student.lastName ? ` ${student.lastName}` : ''}
                </h1>
                {isDemo && <Badge variant="secondary">Демо</Badge>}
              </div>
              <p className="text-muted-foreground m-0 text-sm break-words">
                {student.email}
                {student.phone ? ` · ${student.phone}` : ''}
                {' · '}Зарегистрирован: {new Date(student.createdAt).toLocaleDateString('ru-RU')}
              </p>
            </div>
            {accessToken && (
              <PlanEventDialog
                accessToken={accessToken}
                lockedMode="meeting"
                defaultStudentId={studentId}
                defaultStudentName={`${student.name}${student.lastName ? ` ${student.lastName}` : ''}`}
                trigger={
                  <Button variant="outline" className="w-full shrink-0 sm:w-auto">
                    <CalendarPlus />
                    Новое событие
                  </Button>
                }
                onMeetingCreated={(meeting) => {
                  toast.success('Встреча запланирована', {
                    action: {
                      label: 'Открыть',
                      onClick: () => router.push(`/admin/meetings/${meeting.id}`),
                    },
                  });
                }}
              />
            )}
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as Tab)} className="mt-4">
            <div className="-m-1.5 overflow-x-auto p-1.5">
              <TabsList>
                <TabsTrigger value="dynamic">Динамика</TabsTrigger>
                <TabsTrigger value="activity">Активность</TabsTrigger>
                <TabsTrigger value="assignments">Задания</TabsTrigger>
                <TabsTrigger value="thread">Сообщения</TabsTrigger>
                <TabsTrigger value="profile">Профиль</TabsTrigger>
              </TabsList>
            </div>
          </Tabs>
        </div>

        {/* ── Tab content ── */}
        {/* Чат (Сообщения) — во всю ширину до краёв (вычитаем паддинги макета);
            Профиль/Задания — по центру с обычными отступами. */}
        <div
          className={`flex flex-1 flex-col min-h-0 ${
            activeTab === 'thread'
              ? '-mx-4 -mb-4 md:-mx-6 md:-mb-6'
              : 'overflow-auto'
          }`}
        >

          {/* ── Profile tab ── */}
          {activeTab === 'profile' && (
            <div className="grid grid-cols-1 items-stretch gap-6 py-4 lg:grid-cols-2">

              {/* Тип аккаунта: демо/служебный флаг (admin) */}
              <Card className="lg:col-span-2">
                <CardContent>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <Label htmlFor="demo-toggle" className="text-sm font-medium text-foreground">
                        Демо/служебный аккаунт (не платит, не в статистике)
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Включите для тестовых и служебных аккаунтов: им не начисляются
                        и не списываются платежи (включая ежемесячные), и они исключены
                        из метрик дашборда и состава групп.
                      </p>
                    </div>
                    <Switch
                      id="demo-toggle"
                      checked={isDemo === true}
                      disabled={isDemo === null || togglingDemo}
                      onCheckedChange={handleToggleDemo}
                      aria-label="Демо/служебный аккаунт"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Баланс кошелька */}
              <section className="lg:col-span-2">
                <h2 className="text-xl font-bold tracking-tight text-foreground mb-3 flex items-center gap-2">
                  <Wallet className="size-5" /> Баланс
                </h2>
                <Card>
                  <CardContent className="space-y-5">
                    {/* Текущий баланс */}
                    <div>
                      <span className="block font-mono text-xs text-muted-foreground uppercase tracking-wider">
                        Текущий баланс
                      </span>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                        {loadingWallet && balanceKopecks === null
                          ? '…'
                          : formatKopecks(balanceKopecks ?? 0)}
                      </p>
                    </div>

                    {/* Операции: пополнить / списать */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {/* Пополнить */}
                      <div className="flex flex-col gap-2 rounded-lg border p-3">
                        <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                          Пополнить
                        </span>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="topup-amount" className="sr-only">Сумма пополнения, ₽</Label>
                          <Input
                            id="topup-amount"
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            placeholder="Сумма, ₽"
                            value={topupRubles}
                            onChange={(e) => setTopupRubles(e.target.value)}
                          />
                          <Input
                            placeholder="Комментарий (необязательно)"
                            value={topupNote}
                            onChange={(e) => setTopupNote(e.target.value)}
                          />
                          <Button
                            onClick={handleTopup}
                            disabled={walletSubmitting || !topupRubles.trim()}
                            className="w-fit"
                          >
                            {walletSubmitting && <Loader2 className="animate-spin" />}
                            Пополнить
                          </Button>
                        </div>
                      </div>

                      {/* Списать */}
                      <div className="flex flex-col gap-2 rounded-lg border p-3">
                        <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                          Списать
                        </span>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="debit-amount" className="sr-only">Сумма списания, ₽</Label>
                          <Input
                            id="debit-amount"
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            placeholder="Сумма, ₽"
                            value={debitRubles}
                            onChange={(e) => setDebitRubles(e.target.value)}
                          />
                          <Input
                            placeholder="Комментарий (необязательно)"
                            value={debitNote}
                            onChange={(e) => setDebitNote(e.target.value)}
                          />
                          <Button
                            variant="secondary"
                            onClick={handleDebit}
                            disabled={walletSubmitting || !debitRubles.trim()}
                            className="w-fit"
                          >
                            {walletSubmitting && <Loader2 className="animate-spin" />}
                            Списать
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* История операций */}
                    <div>
                      <span className="block font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">
                        История операций
                      </span>
                      {loadingWallet && walletTx.length === 0 ? (
                        <div className="flex justify-center p-4">
                          <Loader2 className="size-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : walletTx.length === 0 ? (
                        <p className="text-muted-foreground text-sm">Операций пока нет.</p>
                      ) : (
                        <div className="rounded-lg border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Операция</TableHead>
                                <TableHead className="text-right">Сумма</TableHead>
                                <TableHead>Комментарий</TableHead>
                                <TableHead>Кто</TableHead>
                                <TableHead>Дата</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {walletTx.map((tx) => {
                                const isTopup = tx.kind === 'topup';
                                return (
                                  <TableRow key={tx.id}>
                                    <TableCell>
                                      <Badge variant={isTopup ? 'default' : 'secondary'}>
                                        {isTopup ? 'Пополнение' : 'Списание'}
                                      </Badge>
                                    </TableCell>
                                    <TableCell
                                      className={`text-right tabular-nums font-medium ${
                                        isTopup ? 'text-foreground' : 'text-destructive'
                                      }`}
                                    >
                                      {isTopup ? '+' : '−'}{formatKopecks(tx.amount)}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground whitespace-pre-wrap">
                                      {tx.note || '—'}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{tx.createdBy || '—'}</TableCell>
                                    <TableCell className="text-muted-foreground tabular-nums">
                                      {new Date(tx.createdAt).toLocaleString('ru-RU')}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* Анкета */}
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>Анкета (Задание №0)</CardTitle>
                </CardHeader>
                <CardContent>
                  {profile ? (
                    <div className="space-y-3">
                      <div>
                        <span className="block font-mono text-xs text-muted-foreground uppercase tracking-wider">Резюме</span>
                        <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{profile.resume || '—'}</p>
                      </div>
                      <div>
                        <span className="block font-mono text-xs text-muted-foreground uppercase tracking-wider">Портфолио</span>
                        <p className="mt-1 text-sm text-foreground">{profile.portfolio || '—'}</p>
                      </div>
                      <div>
                        <span className="block font-mono text-xs text-muted-foreground uppercase tracking-wider">Контакты</span>
                        <p className="mt-1 text-sm text-foreground">
                          {profile.contacts
                            ? `Email: ${(profile.contacts as { email?: string; telegram?: string }).email || '—'}, Telegram: ${(profile.contacts as { email?: string; telegram?: string }).telegram || '—'}`
                            : '—'}
                        </p>
                      </div>
                      <div>
                        <span className="block font-mono text-xs text-muted-foreground uppercase tracking-wider">Направление</span>
                        <p className="mt-1 text-sm text-foreground">{profile.direction || '—'}</p>
                      </div>
                      {profile.questionnaireCompletedAt ? (
                        <span className="block font-mono text-xs text-muted-foreground">
                          Заполнена: {new Date(profile.questionnaireCompletedAt).toLocaleDateString('ru-RU')}
                        </span>
                      ) : (
                        <span className="block font-mono text-xs text-destructive">Анкета не заполнена</span>
                      )}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">Студент ещё не заполнил анкету.</p>
                  )}
                </CardContent>
              </Card>

              {/* Заметки преподавателя */}
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>Наблюдения преподавателя</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleAddNote} className="mb-5">
                    <Textarea
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      placeholder="Добавить наблюдение или заметку..."
                      rows={3}
                      className="mb-2 resize-none"
                    />
                    <Button type="submit" disabled={!noteContent.trim() || savingNote}>
                      {savingNote && <Loader2 className="animate-spin" />}
                      {savingNote ? 'Сохранение...' : 'Добавить заметку'}
                    </Button>
                  </form>
                  {notes && notes.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      {notes.map((note: TeacherNote) => (
                        <div key={note.id} className="rounded-md border p-3">
                          <p className="m-0 text-sm text-foreground whitespace-pre-wrap">{note.content}</p>
                          <span className="block font-mono text-xs mt-2 text-muted-foreground">
                            {note.author.name} — {new Date(note.createdAt).toLocaleString('ru-RU')}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">Заметок пока нет.</p>
                  )}
                </CardContent>
              </Card>

              {/* Юридические согласия (append-only журнал: документ+версия, тип, действие, дата, IP) */}
              <section className="lg:col-span-2">
                {/* flex-wrap: на узких экранах кнопка сброса переносится под заголовок */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="m-0 flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
                    <ScrollText className="size-5" /> Согласия
                  </h2>
                  {isDemo === true && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={loadingConsents || resettingConsents}
                      onClick={() => setResetConsentsOpen(true)}
                    >
                      {resettingConsents ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RotateCcw className="size-4" />
                      )}
                      Сбросить согласия
                    </Button>
                  )}
                </div>
                <Card>
                  <CardContent>
                    {loadingConsents ? (
                      <div className="flex justify-center p-4">
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : consentsError ? (
                      <Alert variant="destructive">
                        <AlertDescription className="flex flex-col items-start gap-2">
                          {consentsError}
                          <Button variant="outline" size="sm" onClick={fetchConsents}>
                            Повторить
                          </Button>
                        </AlertDescription>
                      </Alert>
                    ) : consents.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        Согласия не зафиксированы. Это нормально для участников,
                        зарегистрированных до внедрения юридических документов.
                      </p>
                    ) : (
                      <div className="rounded-lg border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Документ</TableHead>
                              <TableHead>Тип</TableHead>
                              <TableHead>Действие</TableHead>
                              <TableHead>Дата и время</TableHead>
                              <TableHead>IP</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {consents.map((consent) => (
                              <TableRow key={consent.id}>
                                <TableCell className="max-w-64 whitespace-normal">
                                  <span className="block text-foreground">
                                    {consent.document.title}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    Редакция №{consent.document.versionNumber}
                                  </span>
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {CONSENT_TYPE_LABELS[consent.consentType] ?? consent.consentType}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={consent.action === 'granted' ? 'default' : 'destructive'}
                                  >
                                    {CONSENT_ACTION_LABELS[consent.action] ?? consent.action}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-muted-foreground tabular-nums">
                                  {new Date(consent.createdAt).toLocaleString('ru-RU')}
                                </TableCell>
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                  {consent.ip || '—'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </section>
            </div>
          )}

          {/* ── Dynamic tab ── */}
          {/* Компонент сам грузит данные при монтировании — это и есть ленивая
              загрузка по вкладке (монтируется только когда вкладка активна). */}
          {activeTab === 'dynamic' && accessToken && (
            <div className="py-4">
              <StudentDynamicTab accessToken={accessToken} studentId={studentId} />
            </div>
          )}

          {/* ── Activity tab ── */}
          {/* Компонент сам грузит первую страницу при монтировании (ленивая
              загрузка по активной вкладке), как StudentDynamicTab. */}
          {activeTab === 'activity' && accessToken && (
            <div className="py-4">
              <StudentActivityTab accessToken={accessToken} studentId={studentId} />
            </div>
          )}

          {/* ── Assignments tab ── */}
          {activeTab === 'assignments' && (
            <div className="py-4">
              {/* Summary block */}
              {(assignmentsSummary || loadingSummary) && (
                <div className="grid gap-3 mb-4 p-3 bg-muted border rounded-lg [grid-template-columns:repeat(auto-fit,minmax(110px,1fr))]">
                  {loadingSummary && !assignmentsSummary ? (
                    <div className="col-span-full flex justify-center p-2">
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : assignmentsSummary ? (
                    <>
                      <SummaryCard label={STATUS_LABELS.assigned}       value={assignmentsSummary.total}          variant="info" />
                      <SummaryCard label={STATUS_LABELS.submitted}      value={assignmentsSummary.submitted}      variant="warning" />
                      <SummaryCard label={STATUS_LABELS.reviewed}       value={assignmentsSummary.reviewed}       variant="success" />
                      <SummaryCard label={STATUS_LABELS.needs_revision} value={assignmentsSummary.needs_revision} variant="accent" />
                      <SummaryCard label="Просрочено"   value={assignmentsSummary.overdue}         variant="error" />
                    </>
                  ) : null}
                </div>
              )}

              {/* Status filter */}
              <div className="flex flex-wrap gap-2 mb-4">
                {[
                  { key: 'all',            label: 'Все' },
                  { key: 'assigned',       label: STATUS_LABELS.assigned },
                  { key: 'submitted',      label: STATUS_LABELS.submitted },
                  { key: 'reviewed',       label: STATUS_LABELS.reviewed },
                  { key: 'needs_revision', label: STATUS_LABELS.needs_revision },
                  { key: 'overdue',        label: 'Просрочено' },
                ].map(({ key, label }) => (
                  <Button
                    key={key}
                    size="sm"
                    variant={statusFilter === key ? 'default' : 'outline'}
                    onClick={() => setStatusFilter(key)}
                  >
                    {label}
                  </Button>
                ))}
              </div>

              {loadingAssignments ? (
                <div className="flex justify-center p-8"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>
              ) : filteredAssignments.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  {assignments.length === 0 ? 'Заданий пока нет.' : 'Нет заданий с выбранным фильтром.'}
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {filteredAssignments.map((sa) => {
                    const isOverdue =
                      sa.status !== 'reviewed' &&
                      sa.assignment?.dueDate &&
                      new Date(sa.assignment.dueDate) < now;
                    return (
                      <AssignmentCard
                        key={sa.id}
                        sa={sa}
                        isOverdue={!!isOverdue}
                        reviewText={reviewTexts[sa.id] ?? ''}
                        reviewError={!!reviewErrors[sa.id]}
                        updating={updatingId === sa.id}
                        onReviewTextChange={(value) => {
                          setReviewTexts((prev) => ({ ...prev, [sa.id]: value }));
                          if (reviewErrors[sa.id]) {
                            setReviewErrors((prev) => {
                              const next = { ...prev };
                              delete next[sa.id];
                              return next;
                            });
                          }
                        }}
                        onAccept={() => handleUpdateAssignment(sa.id, 'reviewed')}
                        onRequestRevision={() => {
                          // Причина обязательна — не открываем диалог с пустым разбором.
                          if (!reviewTexts[sa.id]?.trim()) {
                            setReviewErrors((prev) => ({ ...prev, [sa.id]: true }));
                            toast.error('Укажите причину доработки — она видна студенту.');
                            return;
                          }
                          setPendingRevision(sa);
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Thread tab ── */}
          {/* Общий компонент переписки (тот же, что в инбоксе «Сообщения») —
              лента, композер с заметками/файлами/ссылками, поллинг и карточки
              сданных работ живут в одном месте. */}
          {activeTab === 'thread' && <ThreadConversation studentId={studentId} />}
        </div>
      </div>

      {/* Подтверждение отправки на доработку */}
      <AlertDialog open={!!pendingRevision} onOpenChange={(open) => !open && setPendingRevision(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отправить на доработку?</AlertDialogTitle>
            <AlertDialogDescription>
              Задание «{pendingRevision?.assignment?.title || ''}» будет возвращено студенту на доработку.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingRevision) handleUpdateAssignment(pendingRevision.id, 'needs_revision');
                setPendingRevision(null);
              }}
            >
              На доработку
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Подтверждение сброса согласий демо-аккаунта */}
      <AlertDialog open={resetConsentsOpen} onOpenChange={setResetConsentsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Сбросить согласия?</AlertDialogTitle>
            <AlertDialogDescription>
              Журнал согласий демо-аккаунта будет очищен; при следующем входе студент
              снова увидит экран обязательных согласий. Для реальных аккаунтов сброс
              невозможен.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setResetConsentsOpen(false);
                handleResetConsents();
              }}
            >
              Сбросить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ─── AssignmentCard ─── */

// Полноширинная карточка одной сдачи студента: шапка (заголовок + статус +
// группа + даты), работа студента (текст/файл), критерии и зона ревью.
// Для submitted — поле разбора + кнопки; для reviewed/needs_revision —
// сохранённый разбор (вердикт + текст + автор + дата).
function AssignmentCard({
  sa,
  isOverdue,
  reviewText,
  reviewError,
  updating,
  onReviewTextChange,
  onAccept,
  onRequestRevision,
}: {
  sa: StudentAssignment;
  isOverdue: boolean;
  reviewText: string;
  reviewError: boolean;
  updating: boolean;
  onReviewTextChange: (value: string) => void;
  onAccept: () => void;
  onRequestRevision: () => void;
}) {
  const hasWork = !!(sa.content || sa.fileName);
  const isReviewed = sa.status === 'reviewed';
  const isNeedsRevision = sa.status === 'needs_revision';

  return (
    <Card className="overflow-hidden">
      {/* Шапка: заголовок + статус + метаданные (группа / даты) */}
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <CardTitle className="min-w-0 flex-1 text-base leading-snug break-words">
            {sa.assignment?.title || 'Без названия'}
          </CardTitle>
          <span className="inline-flex shrink-0 flex-wrap items-center gap-1.5">
            <Badge variant={STATUS_VARIANT[sa.status] || 'outline'}>
              {STATUS_LABELS[sa.status] || sa.status}
            </Badge>
            {isOverdue && <Badge variant="destructive">Просрочено</Badge>}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Users className="size-3.5 shrink-0" />
            <span className="truncate">{sa.assignment?.stream?.name || 'Без группы'}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarPlus className="size-3.5 shrink-0" />
            <span className="tabular-nums">
              Назначено {new Date(sa.createdAt).toLocaleDateString('ru-RU')}
            </span>
          </span>
          <span className={cn('inline-flex items-center gap-1.5', isOverdue && 'text-destructive')}>
            <CalendarClock className="size-3.5 shrink-0" />
            <span className="tabular-nums">
              Срок{' '}
              {sa.assignment?.dueDate
                ? new Date(sa.assignment.dueDate).toLocaleDateString('ru-RU')
                : '—'}
            </span>
          </span>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* Работа студента: текст ответа + вложение */}
        <section className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Работа студента
          </span>
          {sa.content ? (
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{sa.content}</p>
          ) : !sa.fileName ? (
            <p className="text-sm text-muted-foreground">
              {hasWork ? '' : 'Готово (без текста и файла).'}
            </p>
          ) : null}
          {sa.fileName && (
            <div className="flex flex-col gap-1.5">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate text-foreground" title={sa.fileName}>
                  {sa.fileName}
                </span>
              </div>
              {sa.fileSignedUrl && (
                <div className="flex flex-wrap items-center gap-1">
                  <FileLightbox
                    fileName={sa.fileName}
                    url={sa.fileSignedUrl}
                    className="text-muted-foreground"
                  />
                  <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
                    <a href={fileDownloadUrl(sa.fileSignedUrl)}>
                      <Download className="size-4" />
                      Скачать
                    </a>
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Критерии оценки — чтобы проверяющий сверялся. */}
        {sa.assignment?.criteria && (
          <section className="flex flex-col gap-1.5 rounded-lg border p-3">
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Критерии оценки
            </span>
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">
              {sa.assignment.criteria}
            </p>
          </section>
        )}

        {/* Зона ревью */}
        {sa.status === 'submitted' && (
          <section className="flex flex-col gap-2">
            <div className="flex flex-col gap-1.5">
              <Textarea
                value={reviewText}
                onChange={(e) => onReviewTextChange(e.target.value)}
                placeholder="Разбор работы (вердикт + комментарий). Видит студент."
                rows={3}
                aria-invalid={reviewError ? true : undefined}
                className="w-full resize-y"
              />
              {reviewError && (
                <span className="text-xs text-destructive">
                  Для «На доработку» причина обязательна.
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={onAccept} disabled={updating}>
                {updating && <Loader2 className="animate-spin" />}
                Принять
              </Button>
              <Button variant="secondary" size="sm" onClick={onRequestRevision} disabled={updating}>
                На доработку
              </Button>
            </div>
          </section>
        )}

        {/* Сохранённый разбор для уже проверенных сдач */}
        {(isReviewed || isNeedsRevision) && (
          <ReviewSummary
            verdict={isReviewed ? 'reviewed' : 'needs_revision'}
            reviewText={sa.reviewText}
            reviewedBy={sa.reviewedBy}
            reviewedAt={sa.reviewedAt}
          />
        )}

        {sa.status === 'assigned' && (
          <p className="text-sm text-muted-foreground">Студент ещё не сдал работу.</p>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── ReviewSummary ─── */

// Блок с сохранённым разбором: вердикт (Принято / На доработку), текст
// комментария (виден студенту), автор и дата проверки.
function ReviewSummary({
  verdict,
  reviewText,
  reviewedBy,
  reviewedAt,
}: {
  verdict: 'reviewed' | 'needs_revision';
  reviewText: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}) {
  const accepted = verdict === 'reviewed';
  return (
    <section
      className={cn(
        'flex flex-col gap-2 rounded-lg border-l-4 bg-muted/40 p-3',
        accepted ? 'border-l-primary' : 'border-l-destructive',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Разбор работы
        </span>
        <Badge variant={accepted ? 'default' : 'destructive'} className="gap-1">
          {accepted ? <CheckCircle2 className="size-3.5" /> : <RotateCcw className="size-3.5" />}
          {accepted ? 'Принято' : 'На доработку'}
        </Badge>
      </div>

      {reviewText ? (
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">{reviewText}</p>
      ) : (
        <p className="text-sm text-muted-foreground">Комментарий не оставлен.</p>
      )}

      {(reviewedBy || reviewedAt) && (
        <span className="font-mono text-xs text-muted-foreground">
          {reviewedBy || 'Проверяющий'}
          {reviewedAt && <> — {new Date(reviewedAt).toLocaleString('ru-RU')}</>}
        </span>
      )}
    </section>
  );
}

/* ─── SummaryCard ─── */

function SummaryCard({ label, value, variant }: {
  label: string; value: number;
  variant: 'info' | 'warning' | 'success' | 'error' | 'accent' | 'default';
}) {
  const isError = variant === 'error';
  return (
    <div className="flex flex-col items-center justify-center gap-1 p-3 rounded-lg border bg-card min-w-[90px]">
      <span className={`text-2xl font-bold leading-none ${isError ? 'text-destructive' : 'text-foreground'}`}>
        {value}
      </span>
      <span className="text-xs text-center leading-tight text-muted-foreground">{label}</span>
    </div>
  );
}

