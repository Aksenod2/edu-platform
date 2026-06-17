'use client';

import { type ComponentProps, useEffect, useState } from 'react';
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
  Wallet,
  Banknote,
  User,
  Settings,
  Video,
  Send,
  LogOut,
  ChevronsUpDown,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getAdminTopUpRequests, getMessagesUnreadCount } from '@/lib/api';
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';

// Ключ счётчика-бейджа. Привязывает пункт меню к источнику числа, без хардкода href.
type BadgeKey = 'topups' | 'messages';
type NavItem = { label: string; href: string; icon: LucideIcon; badge?: BadgeKey };
type NavGroup = { label: string; items: NavItem[] };

// Человекочитаемая расшифровка бейджа для скринридеров (склонение по числу).
const BADGE_SR_LABEL: Record<BadgeKey, (n: number) => string> = {
  topups: (n) => `${n} ${plural(n, 'заявка на пополнение', 'заявки на пополнение', 'заявок на пополнение')}`,
  messages: (n) =>
    `${n} ${plural(n, 'непрочитанное сообщение', 'непрочитанных сообщения', 'непрочитанных сообщений')}`,
};

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

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
      { label: 'Группы', href: '/admin/streams', icon: Layers },
      { label: 'Расписание', href: '/admin/schedule', icon: CalendarDays },
    ],
  },
  {
    label: 'Люди',
    items: [
      { label: 'Студенты', href: '/admin/students', icon: Users },
      { label: 'Задания', href: '/admin/assignments', icon: ClipboardCheck },
      { label: 'Сообщения', href: '/admin/messages', icon: MessagesSquare, badge: 'messages' },
      { label: 'Пополнения', href: '/admin/topups', icon: Banknote, badge: 'topups' },
    ],
  },
  {
    label: 'Система',
    items: [
      { label: 'API-доступ', href: '/admin/api-access', icon: KeyRound },
      { label: 'Интеграция Zoom', href: '/admin/system/zoom', icon: Video },
      { label: 'Уведомления в Telegram', href: '/admin/system/telegram', icon: Send },
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
    ],
  },
  {
    label: 'Личное',
    items: [
      { label: 'Сообщения', href: '/dashboard/messages', icon: MessagesSquare, badge: 'messages' },
      { label: 'Баланс', href: '/dashboard/balance', icon: Wallet },
    ],
  },
];

const ROLE_LABEL: Record<'admin' | 'student', string> = {
  admin: 'Администратор',
  student: 'Студент',
};

export function AppSidebar({
  role,
  ...props
}: ComponentProps<typeof Sidebar> & { role: 'admin' | 'student' }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const nav = role === 'admin' ? ADMIN_NAV : STUDENT_NAV;
  const rootHref = role === 'admin' ? '/admin' : '/dashboard';
  const counters = useSidebarCounters(role, pathname);

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
              {group.items.map((item) => {
                const count = item.badge ? counters[item.badge] : 0;
                const srLabel = item.badge && count > 0 ? BADGE_SR_LABEL[item.badge](count) : null;
                return (
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
                    {srLabel ? (
                      <>
                        {/* Развёрнутое меню и мобилка (Sheet): числовой бейдж.
                            Тон bg-primary — «очередь/внимание»; на активном пункте
                            переопределяем унаследованный text-sidebar-accent-foreground. */}
                        <SidebarMenuBadge className="bg-primary text-primary-foreground peer-data-[active=true]/menu-button:text-primary-foreground">
                          <span aria-hidden>{count > 99 ? '99+' : count}</span>
                          <span className="sr-only">{srLabel}</span>
                        </SidebarMenuBadge>
                        {/* Свёрнутое (icon) меню: числовой бейдж скрыт через
                            display:none (group-data-[collapsible=icon]:hidden) →
                            его sr-only текст тоже недоступен. Показываем точку-маркер
                            поверх иконки и даём ей собственную sr-only расшифровку. */}
                        <span
                          aria-hidden
                          className="pointer-events-none absolute top-1.5 right-1.5 hidden size-2 rounded-full bg-primary ring-2 ring-sidebar group-data-[collapsible=icon]:block"
                        />
                        <span className="sr-only hidden group-data-[collapsible=icon]:inline">
                          {srLabel}
                        </span>
                      </>
                    ) : null}
                  </SidebarMenuItem>
                );
              })}
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

// Как часто мягко обновлять счётчики-бейджи фоновым опросом.
const SIDEBAR_COUNTERS_POLL_MS = 45_000;

// Какие источники счётчиков актуальны для роли.
// topups — только admin (заявки на пополнение «на рассмотрении»);
// messages — admin и student (суммарно непрочитанные сообщения).
const COUNTER_SOURCES: Record<
  BadgeKey,
  { roles: ReadonlyArray<'admin' | 'student'>; fetch: (token: string) => Promise<number> }
> = {
  topups: {
    roles: ['admin'],
    fetch: (token) => getAdminTopUpRequests(token, 'pending').then((d) => d.requests.length),
  },
  messages: {
    roles: ['admin', 'student'],
    fetch: (token) => getMessagesUnreadCount(token).then((d) => d.unreadCount),
  },
};

// Счётчики-бейджи сайдбара. Один общий хук опрашивает все источники, актуальные
// для роли. Тихо игнорируем ошибки — бейджи необязательны. Авто-обновление без
// перезагрузки: при смене маршрута (pathname), мягким polling'ом и при возврате
// фокуса/видимости вкладки — чтобы бейдж не «застревал» после модерации/прочтения.
// При старте и смене токена счётчики держим в 0 (не показываем чужое).
function useSidebarCounters(
  role: 'admin' | 'student',
  pathname: string,
): Record<BadgeKey, number> {
  const { accessToken } = useAuth();
  const [counts, setCounts] = useState<Record<BadgeKey, number>>({ topups: 0, messages: 0 });

  // Сброс при смене токена — чтобы не мелькнули чужие числа до первого ответа.
  useEffect(() => {
    setCounts({ topups: 0, messages: 0 });
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;

    let active = true;

    const refresh = () => {
      for (const key of Object.keys(COUNTER_SOURCES) as BadgeKey[]) {
        const source = COUNTER_SOURCES[key];
        if (!source.roles.includes(role)) continue;
        source
          .fetch(accessToken)
          .then((value) => {
            if (active) setCounts((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
          })
          .catch(() => {
            /* бейдж необязателен — молча игнорируем */
          });
      }
    };

    refresh();

    const interval = setInterval(refresh, SIDEBAR_COUNTERS_POLL_MS);

    // Возврат на вкладку — повод сразу освежить счётчики.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);

    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
    // pathname в зависимостях: переход по разделам пересоздаёт эффект и
    // мгновенно перезапрашивает счётчики (в т.ч. после модерации/прочтения).
  }, [role, accessToken, pathname]);

  return counts;
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
