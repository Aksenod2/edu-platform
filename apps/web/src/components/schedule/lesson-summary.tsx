import { Sparkles, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/**
 * Бейдж источника итогов занятия (Session.summarySource):
 *   - 'zoom_ai' → «Сформировано Zoom AI» (Sparkles);
 *   - 'manual'  → «Отредактировано вручную» (Pencil);
 *   - иначе/null → ничего.
 */
export function SummarySourceBadge({
  source,
  className,
}: {
  source?: string | null;
  className?: string;
}) {
  if (source === 'zoom_ai') {
    return (
      <Badge variant="secondary" className={className}>
        <Sparkles className="size-3" />
        Сформировано Zoom AI
      </Badge>
    );
  }
  if (source === 'manual') {
    return (
      <Badge variant="outline" className={className}>
        <Pencil className="size-3" />
        Отредактировано вручную
      </Badge>
    );
  }
  return null;
}
