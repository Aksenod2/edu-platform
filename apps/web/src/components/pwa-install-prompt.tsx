'use client';

/**
 * PwaInstallPrompt — ненавязчивый дровер с предложением установить приложение.
 *
 * Поведение:
 * - НЕ показывается, если приложение уже запущено как standalone (Android/iOS).
 * - НЕ показывается, если пользователь ранее скрыл (localStorage).
 * - Android/Chrome: ловит beforeinstallprompt, показывает кнопку «Установить».
 * - iOS Safari: программного prompt нет → показывает инструкцию «Поделиться → На экран „Домой“».
 * - Появляется отложенно (~10с), чтобы не наслаиваться на push-prompt (30с).
 */

import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { IosInstallSteps } from '@/components/install-instructions';

const DISMISSED_KEY = 'pwa_install_dismissed';
// Чуть позже монтирования, но раньше push-prompt (30с), чтобы не наслаивались.
const SHOW_DELAY_MS = 10_000;

// Минимальный тип события beforeinstallprompt (нет в стандартных lib.dom).
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mql = window.matchMedia('(display-mode: standalone)').matches;
  // iOS Safari использует нестандартный navigator.standalone.
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mql || iosStandalone;
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPhone/iPad/iPod + iPadOS (выдаёт себя за Mac, но имеет touch).
  const iDevice = /iphone|ipad|ipod/i.test(ua);
  const iPadOs = /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  return iDevice || iPadOs;
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (!isIos()) return false;
  const ua = navigator.userAgent;
  // Исключаем встроенные браузеры/Chrome/Firefox на iOS (у них нет «На экран Домой»).
  const isOtherBrowser = /crios|fxios|edgios|opios|brave/i.test(ua);
  return !isOtherBrowser;
}

export function PwaInstallPrompt() {
  const [open, setOpen] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const shown = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandalone()) return;
    if (window.localStorage.getItem(DISMISSED_KEY) === 'true') return;

    const ios = isIosSafari();

    // Android/Chrome: сохраняем событие, чтобы предложить установку программно.
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);

    // Если приложение установили — больше не предлагаем.
    const onAppInstalled = () => {
      window.localStorage.setItem(DISMISSED_KEY, 'true');
      setOpen(false);
    };
    window.addEventListener('appinstalled', onAppInstalled);

    const timer = setTimeout(() => {
      if (shown.current) return;
      if (isStandalone()) return;
      if (window.localStorage.getItem(DISMISSED_KEY) === 'true') return;

      if (deferredPrompt.current) {
        // Android: есть нативный prompt — показываем кнопку «Установить».
        shown.current = true;
        setShowIosHint(false);
        setOpen(true);
      } else if (ios) {
        // iOS Safari: программного prompt нет — показываем инструкцию.
        shown.current = true;
        setShowIosHint(true);
        setOpen(true);
      }
      // Иначе (не-iOS без beforeinstallprompt) — не показываем ничего.
    }, SHOW_DELAY_MS);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  function dismiss() {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DISMISSED_KEY, 'true');
    }
    setOpen(false);
  }

  async function handleInstall() {
    const prompt = deferredPrompt.current;
    if (!prompt) return;
    await prompt.prompt();
    try {
      await prompt.userChoice;
    } finally {
      deferredPrompt.current = null;
      // В любом случае больше не докучаем — выбор сделан.
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(DISMISSED_KEY, 'true');
      }
      setOpen(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // Закрытие свайпом/оверлеем/крестиком трактуем как «Не сейчас».
        if (!next) dismiss();
        else setOpen(true);
      }}
    >
      <SheetContent side="bottom" className="mx-auto max-w-md">
        <SheetHeader>
          <SheetTitle>Установите приложение</SheetTitle>
          <SheetDescription>
            Добавьте OCHOBA на главный экран — быстрый запуск, работа в отдельном
            окне и push-уведомления о новых заданиях и ответах.
          </SheetDescription>
        </SheetHeader>

        {showIosHint ? (
          <div className="px-4">
            <IosInstallSteps />
          </div>
        ) : (
          <div className="px-4">
            <Button className="w-full" onClick={handleInstall}>
              <Download className="size-4" aria-hidden />
              Установить
            </Button>
          </div>
        )}

        <SheetFooter>
          <SheetClose asChild>
            <Button variant="ghost" onClick={dismiss}>
              Не сейчас
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
