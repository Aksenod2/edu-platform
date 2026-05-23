'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, FileText, Link as LinkIcon, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field';
import { uploadAssignmentMaterial, type AssignmentMaterial } from '@/lib/api';
import { formatSize } from '@/components/lessons/lesson-materials-section';

// Материалы задания: прикрепить файл (загрузка в S3) или внешнюю ссылку.
// Контролируемый список — сохраняется вместе с уроком (assignmentMaterials).
export function AssignmentMaterialsField({
  accessToken,
  materials,
  onChange,
}: {
  accessToken: string;
  materials: AssignmentMaterial[];
  onChange: (materials: AssignmentMaterial[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const { material } = await uploadAssignmentMaterial(accessToken, file);
      onChange([...materials, material]);
      toast.success('Файл прикреплён');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки файла');
    } finally {
      setUploading(false);
    }
  };

  const addLink = () => {
    const url = linkUrl.trim();
    if (!url) {
      toast.error('Укажите ссылку');
      return;
    }
    onChange([...materials, { type: 'url', name: linkName.trim() || url, url }]);
    setLinkUrl('');
    setLinkName('');
  };

  const removeAt = (i: number) => onChange(materials.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>Материалы задания</FieldLabel>

      {materials.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {materials.map((m, i) => (
            <div
              key={`${m.type}-${m.s3Key ?? m.url}-${i}`}
              className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-sm"
            >
              {m.type === 'file' ? (
                <FileText className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <LinkIcon className="size-4 shrink-0 text-muted-foreground" />
              )}
              {m.url ? (
                <a
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 truncate text-foreground underline underline-offset-4"
                >
                  {m.name}
                </a>
              ) : (
                <span className="flex-1 truncate text-foreground">{m.name}</span>
              )}
              {m.size ? (
                <span className="shrink-0 text-xs text-muted-foreground">{formatSize(m.size)}</span>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-destructive hover:text-destructive"
                onClick={() => removeAt(i)}
              >
                <X className="size-4" />
                <span className="sr-only">Убрать материал</span>
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Материалы не прикреплены.</p>
      )}

      <label
        className={`inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-dashed bg-card px-3 py-1.5 text-sm ${uploading ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        {uploading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Загрузка...
          </>
        ) : (
          <>
            <Paperclip className="size-4" />
            Прикрепить файл
          </>
        )}
        <input
          type="file"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              handleUpload(file);
              e.target.value = '';
            }
          }}
        />
      </label>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="https://..."
          type="url"
          className="w-full"
        />
        <Input
          value={linkName}
          onChange={(e) => setLinkName(e.target.value)}
          placeholder="Название (необязательно)"
          className="w-full"
        />
        <Button
          type="button"
          variant="outline"
          onClick={addLink}
          className="w-full shrink-0 sm:w-auto"
        >
          <LinkIcon className="size-4" />
          Добавить ссылку
        </Button>
      </div>
    </div>
  );
}
