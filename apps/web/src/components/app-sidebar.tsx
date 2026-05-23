'use client';

import { type ComponentProps } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutGrid,
  Users,
  Layers,
  Calendar,
  CalendarDays,
  KeyRound,
  BookOpen,
  GraduationCap,
  ClipboardList,
  ClipboardCheck,
  MessagesSquare,
  FolderOpen,
  Wallet,
  User,
  Settings,
  Video,
  LogOut,
  ChevronsUpDown,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
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

// Версия сборки. NEXT_PUBLIC_APP_VERSION прокидывается build-аргументом при
// деплое (см. scripts/vps-up.sh) и инлайнится в бандл — обновляется каждый push.
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';

const ADMIN_NAV: NavGroup[] = [
  {
    label: '',
    items: [{ label: 'Обзор', href: '/admin', icon: LayoutGrid }],
  },
  {
    label: 'Контент',
    items: [
      { label: 'Программы', href: '/admin/programs', icon: GraduationCap },
      { label: 'Уроки', href: '/admin/lessons', icon: BookOpen },
    ],
  },
  {
    label: 'Обучение',
    items: [
      { label: 'Потоки', href: '/admin/streams', icon: Layers },
      { label: 'Расписание', href: '/admin/schedule', icon: CalendarDays },
    ],
  },
  {
    label: 'Люди',
    items: [
      { label: 'Студенты', href: '/admin/students', icon: Users },
      { label: 'Задания', href: '/admin/assignments', icon: ClipboardCheck },
      { label: 'Сообщения', href: '/admin/messages', icon: MessagesSquare },
    ],
  },
  {
    label: 'Система',
    items: [
      { label: 'API-доступ', href: '/admin/api-access', icon: KeyRound },
      { label: 'Интеграция Zoom', href: '/admin/system/zoom', icon: Video },
    ],
  },
];

const STUDENT_NAV: NavGroup[] = [
  {
    label: '',
    items: [{ label: 'Обзор', href: '/dashboard', icon: LayoutGrid }],
  },
  {
    label: 'Обучение',
    items: [
      { label: 'Расписание', href: '/dashboard/schedule', icon: Calendar },
      { label: 'Уроки', href: '/dashboard/lessons', icon: BookOpen },
      { label: 'Задания', href: '/dashboard/assignments', icon: ClipboardList },
      { label: 'Материалы', href: '/dashboard/materials', icon: FolderOpen },
    ],
  },
  {
    label: 'Личное',
    items: [
      { label: 'Сообщения', href: '/dashboard/messages', icon: MessagesSquare },
      { label: 'Баланс', href: '/dashboard/balance', icon: Wallet },
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
  const { isMobile, setOpenMobile } = useSidebar();
  const nav = role === 'admin' ? ADMIN_NAV : STUDENT_NAV;
  const rootHref = role === 'admin' ? '/admin' : '/dashboard';

  function closeOnMobile() {
    if (isMobile) setOpenMobile(false);
  }

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
              <Link href={rootHref} onClick={closeOnMobile}>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold tracking-tight">OCHOBA</span>
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
        {nav.map((group, i) => (
          <SidebarGroup key={group.label || `group-${i}`}>
            {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.href)}
                    tooltip={item.label}
                  >
                    <Link href={item.href} onClick={closeOnMobile}>
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
        <div className="px-2 pb-1 text-center text-[10px] tabular-nums text-muted-foreground group-data-[collapsible=icon]:hidden">
          {APP_VERSION}
        </div>
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
  const { isMobile, setOpenMobile } = useSidebar();
  const router = useRouter();

  if (!user) return null;

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  function closeOnMobile() {
    if (isMobile) setOpenMobile(false);
  }

  // Аккаунт-ссылки (профиль, настройки) живут в меню пользователя, а не в
  // основной навигации.
  const accountItems: NavItem[] =
    user.role === 'admin'
      ? [{ label: 'Профиль', href: '/admin/profile', icon: User }]
      : [
          { label: 'Профиль', href: '/dashboard/profile', icon: User },
          { label: 'Настройки', href: '/dashboard/settings', icon: Settings },
        ];

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
                {user.avatarUrl ? (
                  <AvatarImage src={user.avatarUrl} alt={user.name} className="rounded-lg" />
                ) : null}
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
                  {user.avatarUrl ? (
                    <AvatarImage src={user.avatarUrl} alt={user.name} className="rounded-lg" />
                  ) : null}
                  <AvatarFallback className="rounded-lg">{initials(user.name)}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {accountItems.map((item) => (
              <DropdownMenuItem key={item.href} asChild>
                <Link href={item.href} onClick={closeOnMobile}>
                  <item.icon />
                  {item.label}
                </Link>
              </DropdownMenuItem>
            ))}
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
