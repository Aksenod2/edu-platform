import { formatChatDayLabel } from '@/lib/chat-date';

/** Чип с датой по центру ленты — разделяет группы сообщений разных дней. */
export function ChatDateSeparator({ dateIso }: { dateIso: string }) {
  return (
    <div className="my-3 flex justify-center">
      <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        {formatChatDayLabel(dateIso)}
      </span>
    </div>
  );
}
