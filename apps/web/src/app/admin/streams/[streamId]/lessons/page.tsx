'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LessonsManager } from '@/components/lessons-manager';

export default function LessonsPage() {
  const router = useRouter();
  const params = useParams();
  const streamId = params.streamId as string;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit -ml-2"
          onClick={() => router.push('/admin/streams')}
        >
          <ArrowLeft />
          Назад
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Уроки потока</h1>
        <p className="text-sm text-muted-foreground">Управление уроками потока</p>
      </div>

      <LessonsManager streamId={streamId} />
    </div>
  );
}
