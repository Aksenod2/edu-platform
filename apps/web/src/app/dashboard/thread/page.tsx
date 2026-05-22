'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

// Старый роут личного треда. Теперь сообщения объединены на /dashboard/messages,
// личный тред — таб "personal". Редирект сохраняет query (assignmentId/title),
// чтобы deep-links из заданий и уведомлений продолжали работать.
function ThreadRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'personal');
    router.replace(`/dashboard/messages?${params.toString()}`);
  }, [router, searchParams]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function StudentThreadRedirectPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ThreadRedirect />
    </Suspense>
  );
}
