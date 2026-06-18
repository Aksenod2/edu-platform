'use client';

import { useParams } from 'next/navigation';
import { MeetingDetail } from '@/components/meetings/meeting-detail';

export default function StudentMeetingPage() {
  const params = useParams();
  const meetingId = params.id as string;

  return (
    <MeetingDetail meetingId={meetingId} isAdmin={false} backHref="/dashboard/schedule" />
  );
}
