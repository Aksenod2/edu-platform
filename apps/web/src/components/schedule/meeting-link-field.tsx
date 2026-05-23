'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Copy, ExternalLink, Video } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Field, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getZoomIntegration, type ZoomIntegrationConfig } from '@/lib/api';

/**
 * Поле «Ссылка на созвон» с автогенерацией Zoom.
 *
 * Делает очевидным, что ссылку можно создать автоматически:
 *  - если интеграция Zoom включена и полностью настроена — показывает переключатель
 *    «Создать ссылку Zoom автоматически» (по умолчанию = autoCreateMeeting). Состояние
 *    переключателя родитель кладёт в payload как generateMeeting;
 *  - если не настроена — мелкий хинт со ссылкой на настройки. Ручное поле доступно всегда.
 *
 * Переключатель скрываем, когда ссылку ввели вручную (бэк её не перезатирает —
 * навязывать генерацию незачем).
 */
export function MeetingLinkField({
  accessToken,
  inputId,
  value,
  onValueChange,
  generateMeeting,
  onGenerateMeetingChange,
  onConfigLoaded,
  savedMeetingUrl,
  generationFailed,
}: {
  accessToken: string;
  /** id для связки label↔input (формы на одной странице должны различаться). */
  inputId: string;
  /** Ручная ссылка (контролируемое значение). */
  value: string;
  onValueChange: (value: string) => void;
  /** Состояние переключателя автогенерации (контролируемое). */
  generateMeeting: boolean;
  onGenerateMeetingChange: (value: boolean) => void;
  /**
   * Колбэк после загрузки статуса интеграции — отдаёт дефолт автогенерации
   * (autoCreateMeeting, если Zoom готов; иначе false), чтобы родитель один раз
   * проставил начальное значение переключателя.
   */
  onConfigLoaded?: (defaultGenerate: boolean) => void;
  /** Сохранённая ссылка занятия (read-only результат последнего сохранения) или null. */
  savedMeetingUrl?: string | null;
  /** Запрашивали генерацию, но meetingUrl вернулся null — показать неблокирующий Alert. */
  generationFailed?: boolean;
}) {
  const [config, setConfig] = useState<ZoomIntegrationConfig | null>(null);
  const [loading, setLoading] = useState(true);

  // Колбэк держим в ref, чтобы эффект загрузки не перезапускался от смены ссылки.
  const onConfigLoadedRef = useRef(onConfigLoaded);
  onConfigLoadedRef.current = onConfigLoaded;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getZoomIntegration(accessToken)
      .then((res) => {
        if (cancelled) return;
        setConfig(res);
        const ready =
          res.enabled &&
          !!res.accountId &&
          !!res.clientId &&
          res.secretSet &&
          res.encryptionKeySet;
        onConfigLoadedRef.current?.(ready ? res.autoCreateMeeting : false);
      })
      // Статус интеграции — необязательный: при ошибке просто прячем переключатель
      // (ручное поле остаётся), сохранение не блокируем.
      .catch(() => {
        if (!cancelled) setConfig(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const zoomReady =
    !!config &&
    config.enabled &&
    !!config.accountId &&
    !!config.clientId &&
    config.secretSet &&
    config.encryptionKeySet;

  const hasManualUrl = value.trim().length > 0;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Ссылка скопирована');
    } catch {
      toast.error('Не удалось скопировать ссылку');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor={inputId}>Ссылка на созвон</FieldLabel>
        <Input
          id={inputId}
          type="url"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder="https://zoom.us/j/..."
        />
      </Field>

      {loading ? (
        <Skeleton className="h-9 w-full" />
      ) : zoomReady ? (
        // Автогенерацию предлагаем, только когда ручную ссылку не вводили.
        !hasManualUrl && (
          <div className="flex flex-col gap-2 rounded-md border bg-card p-3">
            <div className="flex items-center justify-between gap-3">
              <Label
                htmlFor={`${inputId}-generate`}
                className="flex items-center gap-2 font-normal"
              >
                <Video className="size-4 text-muted-foreground" />
                Создать ссылку Zoom автоматически
              </Label>
              <Switch
                id={`${inputId}-generate`}
                checked={generateMeeting}
                onCheckedChange={onGenerateMeetingChange}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Ссылка на созвон будет создана в вашем аккаунте Zoom при сохранении.
            </p>
          </div>
        )
      ) : (
        // Интеграция выключена/не настроена — неблокирующий хинт.
        <p className="text-xs text-muted-foreground">
          Zoom не настроен — введите ссылку вручную.{' '}
          <Link
            href="/admin/system/zoom"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Настроить
          </Link>
        </p>
      )}

      {/* Генерацию запрашивали, но ссылка не пришла — мягкая ошибка, без срыва сохранения. */}
      {generationFailed && (
        <Alert variant="destructive">
          <AlertDescription>
            Не удалось создать ссылку Zoom — попробуйте ещё раз или вставьте вручную.
          </AlertDescription>
        </Alert>
      )}

      {/* Read-only результат: появилась ссылка занятия — даём скопировать/открыть. */}
      {savedMeetingUrl && (
        <div className="flex flex-col gap-2 rounded-md border bg-card p-3">
          <Label className="text-xs text-muted-foreground">Ссылка на созвон</Label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              readOnly
              value={savedMeetingUrl}
              className="flex-1 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1 sm:flex-none"
                onClick={() => copy(savedMeetingUrl)}
              >
                <Copy className="size-4" />
                Скопировать
              </Button>
              <Button asChild type="button" variant="outline" size="sm" className="flex-1 sm:flex-none">
                <a href={savedMeetingUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" />
                  Открыть
                </a>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
