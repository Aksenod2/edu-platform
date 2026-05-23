'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Program, ProgramType } from '@/lib/api';
import { PROGRAM_TYPE_OPTIONS } from '@/components/programs/program-type';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

export interface ProgramFormValues {
  name: string;
  type: ProgramType;
  whatYouLearn: string | null;
}

interface ProgramFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Программа для режима правки; отсутствует — режим создания.
  program?: Program | null;
  onSubmit: (values: ProgramFormValues) => Promise<void>;
}

/**
 * Диалог создания/редактирования программы. Один компонент на оба сценария:
 * режим определяется наличием `program`. Поле name обязательно.
 */
export function ProgramFormDialog({
  open,
  onOpenChange,
  program,
  onSubmit,
}: ProgramFormDialogProps) {
  const isEdit = !!program;
  const [name, setName] = useState('');
  const [type, setType] = useState<ProgramType>('course');
  const [whatYouLearn, setWhatYouLearn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Сброс/заполнение формы при каждом открытии.
  useEffect(() => {
    if (!open) return;
    setName(program?.name ?? '');
    setType(program?.type ?? 'course');
    setWhatYouLearn(program?.whatYouLearn ?? '');
    setError('');
  }, [open, program]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        name: name.trim(),
        type,
        whatYouLearn: whatYouLearn.trim() || null,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения программы');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Редактировать программу' : 'Новая программа'}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? 'Измените параметры учебной программы.'
                : 'Заполните параметры новой учебной программы.'}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <Alert variant="destructive">
              <AlertDescription className="break-all">{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="program-name">Название</Label>
            <Input
              id="program-name"
              placeholder="Например: Веб-разработка с нуля"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="program-type">Тип</Label>
            <Select value={type} onValueChange={(v) => setType(v as ProgramType)}>
              <SelectTrigger id="program-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROGRAM_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="program-what">Чему научится (необязательно)</Label>
            <Textarea
              id="program-what"
              placeholder="Кратко опишите результат прохождения программы"
              value={whatYouLearn}
              onChange={(e) => setWhatYouLearn(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="animate-spin" />}
              {isEdit ? 'Сохранить' : 'Создать'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
