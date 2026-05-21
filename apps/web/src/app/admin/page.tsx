import Link from 'next/link';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const QUICK_LINKS = [
  { title: 'Ученики', description: 'Список и карточки учеников', href: '/admin/students' },
  { title: 'Потоки', description: 'Учебные группы и их уроки', href: '/admin/streams' },
  { title: 'Расписание', description: 'Предстоящие занятия и сроки сдачи', href: '/admin/schedule' },
  { title: 'Задания', description: 'Управление заданиями (через потоки)', href: '/admin/assignments' },
];

export default function AdminPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Панель управления</h1>
        <p className="text-sm text-muted-foreground">
          Управление учениками, потоками и расписанием
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="no-underline">
            <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent/40">
              <CardHeader>
                <CardTitle>{link.title}</CardTitle>
                <CardDescription>{link.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
