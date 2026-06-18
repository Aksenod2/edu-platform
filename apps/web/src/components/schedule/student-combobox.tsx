'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { cn } from '@platform/ui/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { getStudents, type Student } from '@/lib/api';

/** Подпись участника в списке: имя + фамилия + email (тёзки реальны). */
function fullName(s: Student): string {
  return `${s.name}${s.lastName ? ` ${s.lastName}` : ''}`;
}

/**
 * Combobox выбора студента с серверным поиском (дебаунс).
 *
 * Источник — `getStudents(search)` (все пользователи платформы); фильтруем как
 * бэк ожидает для createMeeting: role=student и не удалён, иначе POST /meetings → 404.
 * Поиск идёт на сервере; локально не фильтруем повторно (бэк ищет по имени/email).
 */
export function StudentCombobox({
  accessToken,
  value,
  onChange,
  onEmptyChange,
  id,
}: {
  accessToken: string;
  /** id выбранного студента или '' если не выбран. */
  value: string;
  onChange: (studentId: string, student: Student | null) => void;
  /** Сообщает родителю, что студентов на платформе нет вовсе (для подсказки). */
  onEmptyChange?: (empty: boolean) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  // Запомнить выбранного для подписи в триггере, даже если он выпал из текущей выдачи поиска.
  const [selected, setSelected] = useState<Student | null>(null);

  // true, пока ни разу не приходил непустой список без поискового запроса
  // (отличаем «совсем нет студентов» от «поиск ничего не нашёл»).
  const everHadResults = useRef(false);

  // Дебаунс поискового ввода.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getStudents(accessToken, debounced || undefined)
      .then((res) => {
        if (cancelled) return;
        const list = res.users.filter((u) => u.role === 'student' && !u.deletedAt);
        setStudents(list);
        if (!debounced && list.length > 0) everHadResults.current = true;
        // «Нет студентов вовсе» определяем по пустому списку без поиска.
        if (!debounced) onEmptyChange?.(list.length === 0);
      })
      .catch(() => {
        if (!cancelled) setStudents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, debounced, onEmptyChange]);

  const triggerLabel = useMemo(() => {
    if (selected) return fullName(selected);
    const fromList = students.find((s) => s.id === value);
    return fromList ? fullName(fromList) : 'Выберите студента';
  }, [selected, students, value]);

  const handleSelect = (s: Student) => {
    setSelected(s);
    onChange(s.id, s);
    setOpen(false);
  };

  return (
    // modal: combobox живёт внутри модального Dialog — даём поповеру свой
    // pointer/focus-скоуп, иначе клики по списку «проваливаются» под оверлей диалога.
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'w-full justify-between font-normal',
            !value && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        {/* shouldFilter=false — поиск серверный, локальный фильтр Command выключаем. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Поиск по имени или email…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Загрузка…
              </div>
            ) : (
              <>
                <CommandEmpty>
                  {everHadResults.current
                    ? 'Никого не нашли'
                    : 'Студентов пока нет'}
                </CommandEmpty>
                <CommandGroup>
                  {students.map((s) => (
                    <CommandItem
                      key={s.id}
                      value={s.id}
                      onSelect={() => handleSelect(s)}
                    >
                      <Check
                        className={cn(
                          'mr-2 size-4',
                          value === s.id ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{fullName(s)}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {s.email}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
