'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  getMyConsents,
  setMarketingConsent,
  CONSENT_ACTION_LABELS,
  CONSENT_TYPE_LABELS,
  type UserConsent,
} from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';

/**
 * Карточка «Мои согласия» в профиле (участник и админ): история юридических
 * согласий + тумблер рекламно-информационных материалов. Журнал append-only:
 * текущий статус рекламной рассылки = последняя запись типа marketing.
 */
export function MyConsentsCard({ accessToken }: { accessToken: string }) {
  const [consents, setConsents] = useState<UserConsent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState(false);

  // Защита от гонки перезагрузок: при быстрых переключениях тумблера устаревший
  // ответ GET не должен перезаписать более свежий список.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const data = await getMyConsents(accessToken);
      if (seq !== loadSeq.current) return;
      setConsents(data.consents);
      setError('');
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setError(err instanceof Error ? err.message : 'Ошибка загрузки согласий');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  // Записи приходят новыми сверху — первая запись marketing и есть текущий статус.
  const lastMarketing = consents.find((c) => c.consentType === 'marketing');
  const marketingGranted = lastMarketing?.action === 'granted';

  const handleMarketingToggle = async (granted: boolean) => {
    setToggling(true);
    try {
      await setMarketingConsent(accessToken, granted);
      toast.success(
        granted
          ? 'Согласие на рекламно-информационные материалы дано'
          : 'Согласие на рекламно-информационные материалы отозвано',
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось изменить согласие');
    } finally {
      setToggling(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Мои согласия</CardTitle>
        <CardDescription>
          История юридических согласий: документ, действие и дата фиксации
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Тумблер рекламной рассылки — управляется в любой момент. */}
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="marketing-toggle" className="cursor-pointer leading-snug">
            Рекламно-информационные материалы
          </Label>
          <Switch
            id="marketing-toggle"
            checked={marketingGranted}
            disabled={loading || toggling || !!error}
            onCheckedChange={handleMarketingToggle}
            aria-label="Согласие на рекламно-информационные материалы"
          />
        </div>

        <Separator />

        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-col items-start gap-2">
              {error}
              <Button variant="outline" size="sm" onClick={load}>
                Повторить
              </Button>
            </AlertDescription>
          </Alert>
        ) : consents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Согласия не зафиксированы.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {consents.map((consent) => (
              <li key={consent.id} className="flex flex-col gap-1 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {CONSENT_TYPE_LABELS[consent.consentType] ?? consent.consentType}
                  </span>
                  <Badge variant={consent.action === 'granted' ? 'default' : 'destructive'}>
                    {CONSENT_ACTION_LABELS[consent.action] ?? consent.action}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {consent.document.title} — редакция №{consent.document.versionNumber}
                </span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {new Date(consent.createdAt).toLocaleString('ru-RU')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
