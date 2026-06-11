'use client';

import { useState } from 'react';
import { cn } from '@platform/ui/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { LegalDocumentLightbox } from '@/components/legal-document-lightbox';
import type { ConsentType } from '@/lib/api';

/**
 * Блок юридических согласий в формах регистрации (join / invite).
 * Четыре согласия обязательны (без них кнопка регистрации заблокирована),
 * рекламно-информационные материалы — по желанию.
 */

export interface ConsentValues {
  offer: boolean;
  personalData: boolean;
  personalDataPolicy: boolean;
  serviceNotifications: boolean;
  marketing: boolean;
}

export const EMPTY_CONSENTS: ConsentValues = {
  offer: false,
  personalData: false,
  personalDataPolicy: false,
  serviceNotifications: false,
  marketing: false,
};

/**
 * Обязательные согласия на фронте — ЕДИНСТВЕННОЕ место объявления (страница
 * /consents импортирует отсюда). Зеркало REQUIRED_CONSENT_TYPES на сервере
 * (apps/api/src/lib/consents.ts); источник истины в рантайме — серверный
 * pendingConsents, этот список нужен только для UI (валидация формы, lockedTypes).
 */
export const REQUIRED_CONSENT_TYPES: ConsentType[] = [
  'offer',
  'personalData',
  'personalDataPolicy',
  'serviceNotifications',
];

export function requiredConsentsGiven(values: ConsentValues): boolean {
  return REQUIRED_CONSENT_TYPES.every((type) => values[type]);
}

/** Отмеченные согласия → массив для body.consents (включая marketing, если отмечен). */
export function consentsToList(values: ConsentValues): ConsentType[] {
  return (Object.keys(values) as ConsentType[]).filter((type) => values[type]);
}

// Обычный клик открывает документ в полноэкранном лайтбоксе, чтобы не потерять
// заполненную форму. Это настоящая <a href>, поэтому средняя кнопка, Ctrl/Cmd+клик
// и контекстное меню работают как у обычной ссылки.
// Клик по ссылке внутри <label> по спецификации НЕ переключает чекбокс.
function LegalLink({
  slug,
  onOpen,
  children,
}: {
  slug: string;
  onOpen: (slug: string) => void;
  children: React.ReactNode;
}) {
  return (
    <a
      href={`/legal/${slug}`}
      className="text-foreground underline underline-offset-4 hover:no-underline"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpen(slug);
      }}
    >
      {children}
    </a>
  );
}

function ConsentRow({
  id,
  checked,
  locked,
  onCheckedChange,
  children,
}: {
  id: string;
  checked: boolean;
  locked?: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={locked || checked}
        disabled={locked}
        aria-disabled={locked || undefined}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="mt-0.5"
      />
      <label
        htmlFor={id}
        className={cn('text-sm leading-snug text-muted-foreground', locked && 'opacity-60')}
      >
        {children}
      </label>
    </div>
  );
}

export function ConsentCheckboxes({
  values,
  onChange,
  lockedTypes = [],
}: {
  values: ConsentValues;
  onChange: (values: ConsentValues) => void;
  /** Уже данные согласия: рендерятся отмеченными и заблокированными (гейт /consents). */
  lockedTypes?: ConsentType[];
}) {
  const set = (key: keyof ConsentValues) => (checked: boolean) =>
    onChange({ ...values, [key]: checked });
  const locked = (type: ConsentType) => lockedTypes.includes(type);

  // Один лайтбокс на блок; slug не сбрасываем при закрытии, чтобы документ
  // не исчезал во время анимации закрытия.
  const [docSlug, setDocSlug] = useState<string | null>(null);
  const [docOpen, setDocOpen] = useState(false);
  const openDoc = (slug: string) => {
    setDocSlug(slug);
    setDocOpen(true);
  };

  return (
    <div className="flex flex-col gap-3">
      <ConsentRow
        id="consent-offer"
        checked={values.offer}
        locked={locked('offer')}
        onCheckedChange={set('offer')}
      >
        Принимаю условия{' '}
        <LegalLink slug="offer" onOpen={openDoc}>
          Договора-оферты
        </LegalLink>
      </ConsentRow>
      <ConsentRow
        id="consent-personal-data"
        checked={values.personalData}
        locked={locked('personalData')}
        onCheckedChange={set('personalData')}
      >
        Согласен(на) на{' '}
        <LegalLink slug="pd-consent" onOpen={openDoc}>
          обработку персональных данных
        </LegalLink>
      </ConsentRow>
      <ConsentRow
        id="consent-personal-data-policy"
        checked={values.personalDataPolicy}
        locked={locked('personalDataPolicy')}
        onCheckedChange={set('personalDataPolicy')}
      >
        Ознакомлен(а) с{' '}
        <LegalLink slug="personal-data-policy" onOpen={openDoc}>
          Политикой обработки персональных данных
        </LegalLink>
      </ConsentRow>
      <ConsentRow
        id="consent-service"
        checked={values.serviceNotifications}
        locked={locked('serviceNotifications')}
        onCheckedChange={set('serviceNotifications')}
      >
        Согласен(на) получать сервисные уведомления
      </ConsentRow>
      <ConsentRow
        id="consent-marketing"
        checked={values.marketing}
        locked={locked('marketing')}
        onCheckedChange={set('marketing')}
      >
        Согласен(на) получать{' '}
        <LegalLink slug="marketing-consent" onOpen={openDoc}>
          рекламно-информационные материалы
        </LegalLink>{' '}
        (необязательно)
      </ConsentRow>
      <LegalDocumentLightbox slug={docSlug} open={docOpen} onOpenChange={setDocOpen} />
    </div>
  );
}
