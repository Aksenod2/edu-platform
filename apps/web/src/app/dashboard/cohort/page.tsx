'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

// Старый роут чата потока. Теперь сообщения объединены на /dashboard/messages,
// чат потока — таб "cohort". Редирект сохраняет остальные query на всякий случай.
function CohortRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'cohort');
    router.replace(`/dashboard/messages?${params.toString()}`);
  }, [router, searchParams]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function StudentCohortRedirectPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <CohortRedirect />
    </Suspense>
  );
}
