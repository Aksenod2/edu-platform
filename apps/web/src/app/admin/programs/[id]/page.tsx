'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2, SquarePen } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  getProgram,
  updateProgram,
  PROGRAM_TYPE_LABELS,
  type Program,
  type ProgramDetail,
} from '@/lib/api';
import {
  ProgramFormDialog,
  type ProgramFormValues,
} from '@/components/programs/program-form-dialog';
import { ProgramLessonsManager } from '@/components/programs/program-lessons-manager';
import { ProgramStreamsManager } from '@/components/programs/program-streams-manager';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ProgramDetailPage() {
  const params = useParams();
  const programId = params.id as string;
  const { accessToken } = useAuth();

  const [program, setProgram] = useState<ProgramDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);

  const fetchProgram = useCallback(async () => {
    if (!accessToken || !programId) return;
    try {
      const { program } = await getProgram(accessToken, programId);
      setProgram(program);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки программы');
    } finally {
      setLoading(false);
    }
  }, [accessToken, programId]);

  useEffect(() => {
    fetchProgram();
  }, [fetchProgram]);

  // Правка через переиспользуемый ProgramFormDialog → updateProgram → рефетч.
  // Ошибку сабмита показывает сам диалог; здесь только успешный путь.
  const handleEditSubmit = async (values: ProgramFormValues) => {
    if (!accessToken || !program) return;
    await updateProgram(accessToken, program.id, values);
    await fetchProgram();
  };

  const backButton = (
    <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
      <Link href="/admin/programs">
        <ArrowLeft />
        Назад к Программам
      </Link>
    </Button>
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !program) {
    return (
      <div className="flex flex-col gap-6">
        {backButton}
        <Alert variant="destructive">
          <AlertDescription className="break-all">
            {error || 'Программа не найдена'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // ProgramFormDialog ждёт Program — собираем минимальную форму из детали.
  const programForForm: Program = {
    id: program.id,
    name: program.name,
    type: program.type,
    whatYouLearn: program.whatYouLearn,
    lessonsCount: program.lessons.length,
    streamsCount: program.streams.length,
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {backButton}
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="text-2xl font-bold tracking-tight break-words">{program.name}</h1>
              <Badge variant="secondary">{PROGRAM_TYPE_LABELS[program.type]}</Badge>
            </div>
            {program.whatYouLearn && (
              <p className="text-sm text-muted-foreground">{program.whatYouLearn}</p>
            )}
          </div>
          <Button
            variant="outline"
            className="w-full shrink-0 sm:w-auto"
            onClick={() => setEditOpen(true)}
          >
            <SquarePen />
            Редактировать
          </Button>
        </div>
      </div>

      <ProgramLessonsManager
        programId={program.id}
        lessons={program.lessons}
        onChange={fetchProgram}
      />

      <ProgramStreamsManager
        programId={program.id}
        streams={program.streams}
        onChange={fetchProgram}
      />

      <ProgramFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        program={programForForm}
        onSubmit={handleEditSubmit}
      />
    </div>
  );
}
