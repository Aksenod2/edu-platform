'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { Teacher } from '@/lib/api';

/** Инициалы из имени для аватара преподавателя. */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

// Чек-лист мультивыбора преподавателей (admins) для урока-блока.
export function TeacherPicker({
  teachers,
  selected,
  onToggle,
}: {
  teachers: Teacher[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (teachers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Нет доступных преподавателей.</p>
    );
  }
  return (
    <div className="max-h-48 overflow-y-auto rounded-lg border">
      <ul className="divide-y">
        {teachers.map((teacher) => (
          <li key={teacher.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/50">
              <Checkbox
                checked={selected.includes(teacher.id)}
                onCheckedChange={() => onToggle(teacher.id)}
              />
              <Avatar size="sm">
                <AvatarFallback>{initials(teacher.name)}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{teacher.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {teacher.email}
                </span>
              </div>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
