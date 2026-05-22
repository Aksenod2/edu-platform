'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StreamAssignmentsManager } from '@/components/stream-assignments-manager';
import { getStream, type StreamWithCounts } from '@/lib/api';

export default function AssignmentsPage() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const params = useParams();
  const streamId = params.streamId as string;

  const [stream, setStream] = useState<StreamWithCounts | null>(null);

  const fetchStream = useCallback(async () => {
    if (!accessToken || !streamId) return;
    try {
      const { stream } = await getStream(accessToken, streamId);
      setStream(stream);
    } catch {
      setStream(null);
    }
  }, [accessToken, streamId]);

  useEffect(() => {
    if (accessToken && user?.role === 'admin') {
      fetchStream();
    }
  }, [accessToken, user, fetchStream]);

  return (
    <div className="flex flex-col">
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/admin/streams')}
          className="mb-2"
        >
          <ArrowLeft className="size-4" />
          Назад к потокам
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Задания{stream ? `: ${stream.name}` : ''}
        </h1>
      </div>

      <StreamAssignmentsManager streamId={streamId} />
    </div>
  );
}
