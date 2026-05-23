'use client';

import { Suspense, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { StudentThreadView } from '@/components/student-thread-view';
import { StudentCohortView } from '@/components/student-cohort-view';

type MessagesTab = 'personal' | 'cohort';

function isMessagesTab(value: string | null): value is MessagesTab {
  return value === 'personal' || value === 'cohort';
}

function StudentMessagesContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get('tab');
  const activeTab: MessagesTab = isMessagesTab(tabParam) ? tabParam : 'personal';

  // Смена таба пишет ?tab=... в URL, сохраняя остальные query (assignmentId/title).
  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', value);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="-m-4 flex flex-1 min-h-0 flex-col gap-0 md:-m-6"
    >
      <div className="border-b px-4 py-3">
        <h1 className="mb-3 text-xl font-bold tracking-tight">Сообщения</h1>
        <div className="-m-1.5 overflow-x-auto p-1.5">
          <TabsList>
            <TabsTrigger value="personal">С преподавателем</TabsTrigger>
            <TabsTrigger value="cohort">Чат группы</TabsTrigger>
          </TabsList>
        </div>
      </div>

      <TabsContent value="personal" className="flex min-h-0 flex-1 flex-col">
        <StudentThreadView />
      </TabsContent>

      <TabsContent value="cohort" className="flex min-h-0 flex-1 flex-col">
        <StudentCohortView />
      </TabsContent>
    </Tabs>
  );
}

export default function StudentMessagesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <StudentMessagesContent />
    </Suspense>
  );
}
