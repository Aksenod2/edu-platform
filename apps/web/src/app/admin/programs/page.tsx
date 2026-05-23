'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  getPrograms,
  createProgram,
  updateProgram,
  deleteProgram,
  type Program,
} from '@/lib/api';
import {
  ProgramFormDialog,
  type ProgramFormValues,
} from '@/components/programs/program-form-dialog';
import { ProgramCard } from '@/components/programs/program-card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

export default function ProgramsPage() {
  const { accessToken } = useAuth();

  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Диалог формы: открыт + редактируемая программа (null — создание).
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Program | null>(null);

  // Подтверждение удаления.
  const [toDelete, setToDelete] = useState<Program | null>(null);

  const fetchPrograms = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const data = await getPrograms(accessToken);
      setPrograms(data.programs);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки программ');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchPrograms();
  }, [fetchPrograms]);

  const handleSubmit = async (values: ProgramFormValues) => {
    if (!accessToken) return;
    if (editing) {
      await updateProgram(accessToken, editing.id, values);
    } else {
      await createProgram(accessToken, values);
    }
    await fetchPrograms();
  };

  const handleDelete = async () => {
    if (!accessToken || !toDelete) return;
    setError('');
    try {
      await deleteProgram(accessToken, toDelete.id);
      await fetchPrograms();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления программы');
    } finally {
      setToDelete(null);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (program: Program) => {
    setEditing(program);
    setFormOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Программы</h1>
          <p className="text-sm text-muted-foreground">Учебные планы и их типы</p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          Создать программу
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="break-all">{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : programs.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          Программ пока нет — создайте первую
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {programs.map((program) => (
            <ProgramCard
              key={program.id}
              program={program}
              onEdit={openEdit}
              onDelete={setToDelete}
            />
          ))}
        </div>
      )}

      <ProgramFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        program={editing}
        onSubmit={handleSubmit}
      />

      <AlertDialog
        open={!!toDelete}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить программу?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete && `Программа «${toDelete.name}» будет удалена безвозвратно.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
