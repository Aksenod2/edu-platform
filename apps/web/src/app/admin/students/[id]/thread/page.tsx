'use client';

import { useRouter, useParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThreadConversation } from '@/components/thread-conversation';

export default function AdminStudentThreadPage() {
  const router = useRouter();
  const params = useParams();
  const studentId = params.id as string;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col min-h-0">
      <div className="border-b px-4 pt-4 pb-3">
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 -ml-2 h-auto px-2 text-muted-foreground"
          onClick={() => router.push('/admin/students')}
        >
          <ChevronLeft className="size-4" />
          К списку учеников
        </Button>
        <h1 className="text-lg font-bold tracking-tight">Тред ученика</h1>
      </div>

      <div className="min-h-0 flex-1">
        <ThreadConversation studentId={studentId} />
      </div>
    </div>
  );
}
