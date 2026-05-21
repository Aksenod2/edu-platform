'use client';

import { type ComponentProps } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutGrid,
  Users,
  Layers,
  Calendar,
  Bell,
  KeyRound,
  BookOpen,
  ClipboardList,
  MessagesSquare,
  FolderOpen,
  User,
  Settings,
  LogOut,
  ChevronsUpDown,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  Avatar,
  AvatarFallback,
} from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';

type NavItem = { label: string; href: string; icon: LucideIcon };
type NavGroup = { label: string; items: NavItem[] };

const ADMIN_NAV: NavGroup[] = [
  {
    label: 'Управление',
    items: [
      { label: 'Обзор', href: '/admin', icon: LayoutGrid },
      { label: 'Ученики', href: '/admin/students', icon: Users },
      { label: 'Потоки', href: '/admin/streams', icon: Layers },
      { label: 'Расписание', href: '/admin/schedule', icon: Calendar },
      { label: 'Уведомления', href: '/admin/notifications', icon: Bell },
      { label: 'API-доступ', href: '/admin/api-access', icon: KeyRound },
    ],
  },
];

const STUDENT_NAV: NavGroup[] = [
  {
    label: 'Обучение',
    items: [
      { label: 'Обзор', href: '/dashboard', icon: LayoutGrid },
      { label: 'Уроки', href: '/dashboard/lessons', icon: BookOpen },
      { label: 'Задания', href: '/dashboard/assignments', icon: ClipboardList },
      { label: 'Тред', href: '/dashboard/thread', icon: MessagesSquare },
      { label: 'Расписание', href: '/dashboard/schedule', icon: Calendar },
      { label: 'Уведомления', href: '/dashboard/notifications', icon: Bell },
      { label: 'Материалы', href: '/dashboard/materials', icon: FolderOpen },
      { label: 'Профиль', href: '/dashboard/profile', icon: User },
      { label: 'Настройки', href: '/dashboard/settings', icon: Settings },
    ],
  },
];

const ROLE_LABEL: Record<'admin' | 'student', string> = {
  admin: 'Администратор',
  student: 'Ученик',
};

export function AppSidebar({
  role,
  ...props
}: ComponentProps<typeof Sidebar> & { role: 'admin' | 'student' }) {
  const pathname = usePathname();
  const nav = role === 'admin' ? ADMIN_NAV : STUDENT_NAV;
  const rootHref = role === 'admin' ? '/admin' : '/dashboard';

  function isActive(href: string) {
    if (href === rootHref) return pathname === rootHref;
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href={rootHref}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <LayoutGrid className="size-4" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold tracking-tight">PLATFORM</span>
                  <span className="text-xs text-muted-foreground">
                    {role === 'admin' ? 'Админ-панель' : 'Кабинет'}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {nav.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.href)}
                    tooltip={item.label}
                  >
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function NavUser() {
  const { user, logout } = useAuth();
  const { isMobile } = useSidebar();
  const router = useRouter();

  if (!user) return null;

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg">{initials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {ROLE_LABEL[user.role]}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="size-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">{initials(user.name)}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleLogout}>
              <LogOut />
              Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
