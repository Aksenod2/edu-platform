import * as React from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initials } from '@/lib/initials';

/**
 * Аватар пользователя: картинка при наличии `src`, иначе инициалы из имени.
 * Размеры проксируются в shadcn-компонент Avatar (default | sm | lg).
 */
export function UserAvatar({
  name,
  src,
  size = 'default',
  className,
}: {
  name: string | null | undefined;
  src?: string | null;
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}) {
  return (
    <Avatar size={size} className={className}>
      {src ? <AvatarImage src={src} alt={name ?? ''} /> : null}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
