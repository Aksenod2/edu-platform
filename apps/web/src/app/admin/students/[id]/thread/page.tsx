'use client';

import { useParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { BackButton } from '@/components/back-button';
import { ThreadConversation } from '@/components/thread-conversation';

export default function AdminStudentThreadPage() {
  const params = useParams();
  const studentId = params.id as string;

  return (
    <div className="-mx-4 -mb-4 flex w-full max-w-3xl flex-1 flex-col min-h-0 md:mx-auto md:-mb-6">
      <div className="border-b px-4 pt-4 pb-3">
        <BackButton
          fallbackHref="/admin/students"
          className="mb-2 -ml-2 h-auto px-2 text-muted-foreground"
          icon={<ChevronLeft className="size-4" />}
        >
          К списку учеников
        </BackButton>
        <h1 className="text-lg font-bold tracking-tight">Тред ученика</h1>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <ThreadConversation studentId={studentId} />
      </div>
    </div>
  );
}
