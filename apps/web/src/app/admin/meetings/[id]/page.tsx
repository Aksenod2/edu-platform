'use client';

import { useParams } from 'next/navigation';
import { MeetingDetail } from '@/components/meetings/meeting-detail';

export default function AdminMeetingPage() {
  const params = useParams();
  const meetingId = params.id as string;

  return (
    <MeetingDetail meetingId={meetingId} isAdmin backHref="/admin/schedule" />
  );
}
