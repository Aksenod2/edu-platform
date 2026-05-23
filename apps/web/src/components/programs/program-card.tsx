'use client';

import { BookOpen, GraduationCap, MoreHorizontal, SquarePen, Trash2 } from 'lucide-react';
import type { Program } from '@/lib/api';
import { PROGRAM_TYPE_LABELS } from '@/components/programs/program-type';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ProgramCardProps {
  program: Program;
  onEdit: (program: Program) => void;
  onDelete: (program: Program) => void;
}

/** Карточка программы: название, тип, счётчики и меню действий. */
export function ProgramCard({ program, onEdit, onDelete }: ProgramCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="line-clamp-2">{program.name}</CardTitle>
        <Badge variant="secondary" className="mt-1">
          {PROGRAM_TYPE_LABELS[program.type]}
        </Badge>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8">
                <MoreHorizontal />
                <span className="sr-only">Действия</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => onEdit(program)}>
                <SquarePen />
                Редактировать
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete(program)}>
                <Trash2 />
                Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <BookOpen className="size-4" />
          {program.lessonsCount} уроков
        </span>
        <span className="flex items-center gap-1.5">
          <GraduationCap className="size-4" />
          {program.streamsCount} потоков
        </span>
      </CardContent>
    </Card>
  );
}
