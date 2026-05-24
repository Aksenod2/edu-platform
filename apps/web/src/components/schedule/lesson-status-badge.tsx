import { cn } from '@platform/ui/lib/utils';
import { Badge } from '@/components/ui/badge';
import { LESSON_STATUS_LABELS, type LessonStatus } from '@/lib/api';
import { STATUS_BADGE_VARIANT } from '@/components/schedule/utils';

/**
 * «Живая» точка для статуса «Идёт» — занятие в эфире.
 *
 * Два слоя: расходящееся кольцо (animate-ping) + сплошное ядро поверх, чтобы
 * пульсация читалась и на цветном фоне бейджа. Цвет — currentColor (наследуем
 * от бейджа), поэтому корректно смотрится в обеих темах.
 */
export function LivePulseDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('relative inline-flex size-2 shrink-0 items-center justify-center', className)}
    >
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-75" />
      <span className="relative inline-flex size-1.5 rounded-full bg-current" />
    </span>
  );
}

/**
 * Единый бейдж статуса занятия для read-only мест (списки/карточки/календарь).
 *
 * Для статуса 'live' рендерит «живой» вид: акцентный бейдж + пульсирующая точка.
 * Для остальных статусов — обычный Badge по STATUS_BADGE_VARIANT, чтобы не
 * ломать общий подход к вариантам.
 */
export function LessonStatusBadge({
  status,
  className,
}: {
  status: LessonStatus;
  className?: string;
}) {
  if (status === 'live') {
    return (
      <Badge
        variant="default"
        className={cn('w-fit gap-1.5 font-medium', className)}
      >
        <LivePulseDot />
        {LESSON_STATUS_LABELS.live}
      </Badge>
    );
  }

  return (
    <Badge variant={STATUS_BADGE_VARIANT[status]} className={cn('w-fit', className)}>
      {LESSON_STATUS_LABELS[status]}
    </Badge>
  );
}
