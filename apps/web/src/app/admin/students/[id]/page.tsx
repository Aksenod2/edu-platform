'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { usePolling, isNearBottom, mergeById } from '@/lib/chat-realtime';
import { ChevronLeft, Download, FileText, Loader2, Wallet } from 'lucide-react';
import { MarkdownLightbox, isMarkdownFile } from '@/components/assignments/markdown-lightbox';
import { StudentDynamicTab } from '@/components/students/student-dynamic-tab';
import { BackButton } from '@/components/back-button';

const THREAD_POLL_INTERVAL_MS = 5000;
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
  getThread,
  addThreadEntry,
  uploadThreadFile,
  getWallet,
  topupWallet,
  debitWallet,
  getStudents,
  updateStudent,
  formatKopecks,
  fileDownloadUrl,
  type ProfileResponse,
  type TeacherNote,
  type StudentAssignment,
  type AssignmentsSummary,
  type ThreadEntry,
  type ThreadEntryType,
  type WalletTransaction,
} from '@/lib/api';
import { STATUS_LABELS, STATUS_VARIANT } from '@/lib/assignment-status';

type Tab = 'profile' | 'dynamic' | 'assignments' | 'thread';

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
    tabParam === 'profile' || tabParam === 'assignments' || tabParam === 'thread'
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

  // Демо/служебный аккаунт. Профиль (getProfile) этот флаг не отдаёт, поэтому
  // начальное значение берём из списка студентов (getStudents отдаёт isDemo).
  // null = ещё не загружено (тумблер disabled до получения значения).
  const [isDemo, setIsDemo] = useState<boolean | null>(null);
  const [togglingDemo, setTogglingDemo] = useState(false);

  // Thread state
  const [threadEntries, setThreadEntries] = useState<ThreadEntry[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [inputMode, setInputMode] = useState<'comment' | 'note'>('comment');
  const [threadContent, setThreadContent] = useState('');
  const [sendingThread, setSendingThread] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Прижата ли лента треда к низу — чтобы поллинг не дёргал скролл при чтении истории.
  const threadStick = useRef(true);
  const threadLenRef = useRef(0);
  useEffect(() => {
    threadLenRef.current = threadEntries.length;
  }, [threadEntries]);
  // Отмечаем, что вкладка уже загружалась, чтобы не дёргать запрос повторно.
  // Раньше условием было `.length === 0`, и для пустого треда/списка это
  // зацикливало загрузку (спиннер мигал поверх «Тред пуст»).
  const fetchedRef = useRef({ thread: false, assignments: false, summary: false });

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

  const fetchThread = useCallback(async () => {
    if (!accessToken || !studentId) return;
    setLoadingThread(true);
    try {
      const result = await getThread(accessToken, studentId);
      setThreadEntries(result.entries);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки переписки');
    } finally {
      setLoadingThread(false);
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
    fetchedRef.current = { thread: false, assignments: false, summary: false };
    setThreadEntries([]);
    setAssignments([]);
    setAssignmentsSummary(null);
    setIsDemo(null);
  }, [studentId]);

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

  useEffect(() => {
    if (accessToken && studentId && activeTab === 'thread' && !fetchedRef.current.thread && !loadingThread) {
      fetchedRef.current.thread = true;
      fetchThread();
    }
  }, [accessToken, studentId, activeTab, loadingThread, fetchThread]);

  // Тихий рефреш треда для поллинга: без спиннера, со слиянием по id.
  const refreshThreadSilently = useCallback(async () => {
    if (!accessToken || !studentId) return;
    try {
      const result = await getThread(accessToken, studentId);
      setThreadEntries((prev) => mergeById(result.entries, prev));
    } catch {
      // тихий рефреш — ошибки не показываем
    }
  }, [accessToken, studentId]);

  usePolling(refreshThreadSilently, THREAD_POLL_INTERVAL_MS, activeTab === 'thread');

  const handleThreadScroll = () => {
    const el = threadScrollRef.current;
    if (el) threadStick.current = isNearBottom(el);
  };

  // Прокрутка к низу при появлении новых сообщений — только если пользователь
  // у низа ленты (или сам только что отправил). Иначе не мешаем читать историю.
  useEffect(() => {
    if (activeTab !== 'thread' || threadEntries.length === 0) return;
    if (threadStick.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [threadEntries, activeTab]);

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

  const handleSendThread = async () => {
    if (!accessToken || !threadContent.trim()) return;
    setSendingThread(true);
    try {
      const { entry } = await addThreadEntry(accessToken, studentId, {
        type: inputMode as ThreadEntryType,
        content: threadContent.trim(),
      });
      threadStick.current = true;
      setThreadEntries((prev) => [...prev, entry]);
      setThreadContent('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSendingThread(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !accessToken) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.error('Файл превышает максимальный размер 50MB');
      return;
    }
    setSendingThread(true);
    try {
      const { entry } = await uploadThreadFile(accessToken, studentId, file, 'file');
      threadStick.current = true;
      setThreadEntries((prev) => [...prev, entry]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки файла');
    } finally {
      setSendingThread(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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

  const hasThreadContent = threadContent.trim().length > 0;

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

          <div className="mt-2 mb-1 min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h1 className="m-0 text-xl font-bold tracking-tight text-foreground">{student.name}</h1>
              {isDemo && <Badge variant="secondary">Демо</Badge>}
            </div>
            <p className="text-muted-foreground m-0 text-sm break-words">
              {student.email} · Зарегистрирован: {new Date(student.createdAt).toLocaleDateString('ru-RU')}
            </p>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as Tab)} className="mt-4">
            <div className="-m-1.5 overflow-x-auto p-1.5">
              <TabsList>
                <TabsTrigger value="dynamic">Динамика</TabsTrigger>
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
            <div className="grid items-stretch gap-6 py-4 lg:grid-cols-2">

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
                    <div className="grid gap-4 sm:grid-cols-2">
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
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {['Задание', 'Статус', 'Группа', 'Назначено', 'Срок сдачи', 'Действия'].map((h) => (
                          <TableHead key={h}>{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAssignments.map((sa) => {
                        const isOverdue = sa.status !== 'reviewed' && sa.assignment?.dueDate && new Date(sa.assignment.dueDate) < now;
                        return (
                          <TableRow key={sa.id}>
                            <TableCell className="text-foreground">{sa.assignment?.title || '—'}</TableCell>
                            <TableCell>
                              <span className="inline-flex items-center gap-1.5">
                                <Badge variant={STATUS_VARIANT[sa.status] || 'outline'}>
                                  {STATUS_LABELS[sa.status] || sa.status}
                                </Badge>
                                {isOverdue && <Badge variant="destructive">Просрочено</Badge>}
                              </span>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{sa.assignment?.stream?.name || '—'}</TableCell>
                            <TableCell>
                              <span className="font-mono text-xs text-muted-foreground">
                                {new Date(sa.createdAt).toLocaleDateString('ru-RU')}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="font-mono text-xs text-muted-foreground">
                                {sa.assignment?.dueDate
                                  ? new Date(sa.assignment.dueDate).toLocaleDateString('ru-RU')
                                  : '—'}
                              </span>
                            </TableCell>
                            <TableCell>
                              {sa.status === 'submitted' && (
                                <div className="flex max-w-[360px] flex-col gap-3">
                                  {/* Работа студента: текст ответа + вложение — чтобы
                                      проверять прямо здесь, не уходя на /admin/assignments. */}
                                  {(sa.content || sa.fileName) && (
                                    <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
                                      <span className="text-xs text-muted-foreground">Работа студента</span>
                                      {sa.content && (
                                        <p className="whitespace-pre-wrap text-sm text-foreground">
                                          {sa.content}
                                        </p>
                                      )}
                                      {sa.fileName && (
                                        <div className="flex flex-col gap-1.5">
                                          <div className="flex items-center gap-2 text-sm">
                                            <FileText className="size-4 shrink-0 text-muted-foreground" />
                                            <span className="truncate text-foreground" title={sa.fileName}>
                                              {sa.fileName}
                                            </span>
                                          </div>
                                          {sa.fileSignedUrl && (
                                            <div className="flex items-center gap-1">
                                              {isMarkdownFile(sa.fileName) && (
                                                <MarkdownLightbox fileName={sa.fileName} url={sa.fileSignedUrl} />
                                              )}
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
                                    </div>
                                  )}

                                  {/* Критерии оценки — чтобы проверяющий сверялся. */}
                                  {sa.assignment?.criteria && (
                                    <div className="flex flex-col gap-1.5 rounded-md border p-3">
                                      <span className="text-xs text-muted-foreground">Критерии оценки</span>
                                      <p className="whitespace-pre-wrap text-sm text-foreground">
                                        {sa.assignment.criteria}
                                      </p>
                                    </div>
                                  )}

                                  <div className="flex flex-col gap-1.5">
                                    <Textarea
                                      value={reviewTexts[sa.id] ?? ''}
                                      onChange={(e) => {
                                        setReviewTexts((prev) => ({ ...prev, [sa.id]: e.target.value }));
                                        if (reviewErrors[sa.id]) {
                                          setReviewErrors((prev) => {
                                            const next = { ...prev };
                                            delete next[sa.id];
                                            return next;
                                          });
                                        }
                                      }}
                                      placeholder="Разбор работы (вердикт + комментарий). Видит студент."
                                      rows={3}
                                      aria-invalid={reviewErrors[sa.id] ? true : undefined}
                                      className="min-w-[240px]"
                                    />
                                    {reviewErrors[sa.id] && (
                                      <span className="text-xs text-destructive">
                                        Для «На доработку» причина обязательна.
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex gap-1.5">
                                    <Button
                                      size="sm"
                                      onClick={() => handleUpdateAssignment(sa.id, 'reviewed')}
                                      disabled={updatingId === sa.id}
                                    >
                                      Принять
                                    </Button>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => {
                                        // Причина обязательна — не открываем диалог с пустым разбором.
                                        if (!reviewTexts[sa.id]?.trim()) {
                                          setReviewErrors((prev) => ({ ...prev, [sa.id]: true }));
                                          toast.error('Укажите причину доработки — она видна студенту.');
                                          return;
                                        }
                                        setPendingRevision(sa);
                                      }}
                                      disabled={updatingId === sa.id}
                                    >
                                      На доработку
                                    </Button>
                                  </div>
                                </div>
                              )}
                              {sa.status === 'assigned' && (
                                <span className="font-mono text-xs text-muted-foreground">—</span>
                              )}
                              {sa.status === 'needs_revision' && (
                                <span className="font-mono text-xs text-muted-foreground">↩ Ожидает пересдачи</span>
                              )}
                              {sa.status === 'reviewed' && (
                                <span className="font-mono text-xs text-muted-foreground">✓ Принято</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          {/* ── Thread tab ── */}
          {activeTab === 'thread' && (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Thread messages */}
              <div
                ref={threadScrollRef}
                onScroll={handleThreadScroll}
                className="flex-1 overflow-y-auto p-4 flex flex-col gap-2"
              >
                {loadingThread ? (
                  <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="size-8 animate-spin text-muted-foreground" />
                  </div>
                ) : threadEntries.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="font-mono text-sm text-muted-foreground uppercase tracking-wide">Сообщений пока нет</span>
                  </div>
                ) : (
                  threadEntries.map((entry, i) => (
                    <ThreadBubble
                      key={entry.id}
                      entry={entry}
                      showAuthor={i === 0 || threadEntries[i - 1].authorId !== entry.authorId}
                    />
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              {/* Compose bar */}
              <div className="border-t px-4 py-3 bg-card">
                {inputMode === 'note' && (
                  <div className="flex items-center justify-between px-3 py-2 mb-2 bg-muted border rounded-md">
                    <span className="font-mono text-xs text-muted-foreground uppercase tracking-wide">
                      Приватная заметка — студент не увидит
                    </span>
                    <button
                      onClick={() => setInputMode('comment')}
                      className="bg-transparent border-0 cursor-pointer text-muted-foreground hover:text-foreground p-1 flex"
                    >
                      ×
                    </button>
                  </div>
                )}

                <div className="flex items-end gap-2">
                  <div className="flex gap-1">
                    <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" />
                    <ComposeButton title="Прикрепить файл" onClick={() => fileInputRef.current?.click()} disabled={sendingThread}>
                      <PaperclipIcon />
                    </ComposeButton>
                    <ComposeButton
                      title="Приватная заметка"
                      active={inputMode === 'note'}
                      onClick={() => setInputMode(inputMode === 'note' ? 'comment' : 'note')}
                    >
                      <NoteIcon />
                    </ComposeButton>
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={threadContent}
                    onChange={(e) => {
                      setThreadContent(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
                    }}
                    placeholder={inputMode === 'comment' ? 'Сообщение студенту' : 'Приватная заметка'}
                    rows={1}
                    className={[
                      'flex-1 rounded-lg px-3 py-2 text-sm text-foreground resize-none overflow-hidden leading-normal border outline-none',
                      inputMode === 'note' ? 'bg-muted' : 'bg-background',
                    ].join(' ')}
                    style={{ minHeight: 36, maxHeight: 160 }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendThread(); }
                    }}
                  />
                  <button
                    disabled={sendingThread || !hasThreadContent}
                    onClick={handleSendThread}
                    className={[
                      'flex items-center justify-center shrink-0 border-0 rounded-full size-9 transition-colors',
                      hasThreadContent
                        ? 'bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90'
                        : 'bg-muted text-muted-foreground cursor-default',
                    ].join(' ')}
                  >
                    <SendIcon />
                  </button>
                </div>
              </div>
            </div>
          )}
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
    </>
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

/* ─── ComposeButton ─── */

function ComposeButton({ children, title, onClick, disabled, active }: {
  children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex items-center justify-center shrink-0 border-0 rounded-full size-9 transition-colors',
        active ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground',
        disabled ? 'opacity-40 cursor-default' : 'cursor-pointer hover:text-foreground',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

/* ─── ThreadBubble ─── */

function ThreadBubble({ entry, showAuthor }: { entry: ThreadEntry; showAuthor: boolean }) {
  const isAdmin = entry.author.role === 'admin';
  const isNote = entry.type === 'note';
  const date = new Date(entry.createdAt);
  const initials = entry.author.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className={[
      'flex items-end gap-2',
      isAdmin ? 'flex-row-reverse self-end' : 'flex-row self-start',
      showAuthor ? 'mt-4' : 'mt-1',
      'max-w-[85%]',
    ].join(' ')}>
      {showAuthor ? (
        <div
          className={[
            'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
            'text-xs font-mono font-bold border',
            isNote ? 'bg-muted border-dashed text-muted-foreground'
              : isAdmin ? 'bg-primary text-primary-foreground border-transparent'
              : 'bg-muted text-muted-foreground',
          ].join(' ')}
        >
          {initials}
        </div>
      ) : (
        <div className="w-8 shrink-0" />
      )}
      <div className="min-w-0">
        {showAuthor && (
          <div className={[
            'text-xs font-mono mb-1 tracking-wide uppercase',
            isNote ? 'text-muted-foreground' : isAdmin ? 'text-primary' : 'text-muted-foreground',
            isAdmin ? 'text-right' : 'text-left',
          ].join(' ')}>
            {entry.author.name}
            {isNote && <span className="ml-2">заметка</span>}
          </div>
        )}
        <div className={[
          'px-4 py-3 border',
          isNote
            ? 'bg-muted border-dashed rounded-xl'
            : isAdmin
              ? 'bg-primary text-primary-foreground border-transparent rounded-xl rounded-br-xs'
              : 'bg-muted rounded-xl rounded-bl-xs',
        ].join(' ')}>
          <div className={`text-sm leading-normal break-words ${isAdmin && !isNote ? 'text-primary-foreground' : 'text-foreground'}`}>
            {['text', 'comment', 'note'].includes(entry.type) ? (
              <span className="whitespace-pre-wrap">{entry.content}</span>
            ) : entry.type === 'file' ? (
              <div className="flex items-center gap-3">
                <span>{entry.metadata?.fileName || entry.content}</span>
                {entry.metadata?.url && (
                  <a href={entry.metadata.url} target="_blank" rel="noopener noreferrer" className="underline text-xs">
                    Скачать
                  </a>
                )}
              </div>
            ) : entry.type === 'audio' && entry.metadata?.url ? (
              <audio controls src={entry.metadata.url} className="max-w-full h-9" />
            ) : entry.type === 'link' ? (
              <a href={entry.content} target="_blank" rel="noopener noreferrer" className="underline break-all">
                {entry.content}
              </a>
            ) : null}
          </div>
          <div className={`text-[10px] mt-1 font-mono opacity-70 ${isAdmin ? 'text-left' : 'text-right'}`}>
            {date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        {entry.assignment && (
          <span className="block font-mono text-xs mt-1 text-muted-foreground">
            К заданию: {entry.assignment.title}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── SVG Icons ─── */

function PaperclipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 9.25l-7.72 7.72a4.25 4.25 0 01-6.01-6.01L11.5 3.24a2.83 2.83 0 014 4L7.78 14.96a1.42 1.42 0 01-2-2l7.22-7.22" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 3h12v14H4z" /><path d="M7 7h6M7 10h6M7 13h3" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 10l14-7-7 14v-7H3z" fill="currentColor" />
    </svg>
  );
}
