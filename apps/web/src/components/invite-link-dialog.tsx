'use client';

import { useState } from 'react';
import { Copy, Link2, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { getStreamJoinLink, regenerateStreamJoinLink } from '@/lib/api';

/**
 * Диалог инвайт-ссылки вступления в группу. По открытии лениво получает ссылку
 * (идемпотентный POST: вернёт существующую или сгенерирует). Даёт скопировать
 * и перевыпустить (со сбросом старой ссылки).
 */
export function InviteLinkDialog({
  streamId,
  streamName,
  accessToken,
}: {
  streamId: string;
  streamName: string;
  accessToken: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  async function loadLink() {
    setLoading(true);
    setError('');
    try {
      const { joinUrl } = await getStreamJoinLink(accessToken, streamId);
      setJoinUrl(joinUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось получить ссылку');
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Подгружаем ссылку при первом открытии (не повторяем, если уже есть).
    if (next && !joinUrl && !loading) {
      void loadLink();
    }
  }

  async function copy() {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      toast.success('Ссылка скопирована');
    } catch {
      toast.error('Не удалось скопировать ссылку');
    }
  }

  async function regenerate() {
    setRegenerating(true);
    setError('');
    try {
      const { joinUrl } = await regenerateStreamJoinLink(accessToken, streamId);
      setJoinUrl(joinUrl);
      toast.success('Ссылка перевыпущена — старая больше не работает');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось перевыпустить ссылку');
    } finally {
      setRegenerating(false);
      setConfirmRegen(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full shrink-0 sm:w-auto">
            <Link2 />
            Пригласить ссылкой
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Пригласить в группу ссылкой</DialogTitle>
            <DialogDescription>
              Отправьте ссылку студентам (например в Telegram). По ней они сами
              зарегистрируются и автоматически попадут в группу «{streamName}».
            </DialogDescription>
          </DialogHeader>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {loading ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : joinUrl ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Label className="text-xs text-muted-foreground">
                  Ссылка-приглашение
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    readOnly
                    value={joinUrl}
                    className="flex-1 font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={copy}
                  >
                    <Copy className="size-4" />
                    Копировать
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Ссылка постоянная — её можно использовать для нескольких студентов.
                Если ссылка попала не туда, перевыпустите её: старая перестанет
                работать.
              </p>
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setConfirmRegen(true)}
                  disabled={regenerating}
                >
                  {regenerating ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  Перевыпустить ссылку
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRegen} onOpenChange={setConfirmRegen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Перевыпустить ссылку?</AlertDialogTitle>
            <AlertDialogDescription>
              Текущая ссылка перестанет работать — все, у кого она есть, больше не
              смогут зарегистрироваться по ней. Будет создана новая ссылка.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={regenerating}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void regenerate();
              }}
              disabled={regenerating}
            >
              Перевыпустить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
