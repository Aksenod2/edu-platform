'use client';

import { Checkbox } from '@/components/ui/checkbox';
import type { ConsentType } from '@/lib/api';

/**
 * Блок юридических согласий в формах регистрации (join / invite).
 * Три согласия обязательны (без них кнопка регистрации заблокирована),
 * рекламно-информационные материалы — по желанию.
 */

export interface ConsentValues {
  offer: boolean;
  personalData: boolean;
  serviceNotifications: boolean;
  marketing: boolean;
}

export const EMPTY_CONSENTS: ConsentValues = {
  offer: false,
  personalData: false,
  serviceNotifications: false,
  marketing: false,
};

export function requiredConsentsGiven(values: ConsentValues): boolean {
  return values.offer && values.personalData && values.serviceNotifications;
}

/** Отмеченные согласия → массив для body.consents (включая marketing, если отмечен). */
export function consentsToList(values: ConsentValues): ConsentType[] {
  return (Object.keys(values) as ConsentType[]).filter((type) => values[type]);
}

// Ссылка на документ открывается в новой вкладке, чтобы не потерять заполненную
// форму. Клик по ссылке внутри <label> по спецификации НЕ переключает чекбокс.
function LegalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-foreground underline underline-offset-4 hover:no-underline"
    >
      {children}
    </a>
  );
}

function ConsentRow({
  id,
  checked,
  onCheckedChange,
  children,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="mt-0.5"
      />
      <label htmlFor={id} className="text-sm leading-snug text-muted-foreground">
        {children}
      </label>
    </div>
  );
}

export function ConsentCheckboxes({
  values,
  onChange,
}: {
  values: ConsentValues;
  onChange: (values: ConsentValues) => void;
}) {
  const set = (key: keyof ConsentValues) => (checked: boolean) =>
    onChange({ ...values, [key]: checked });

  return (
    <div className="flex flex-col gap-3">
      <ConsentRow id="consent-offer" checked={values.offer} onCheckedChange={set('offer')}>
        Принимаю условия <LegalLink href="/legal/offer">Договора-оферты</LegalLink>
      </ConsentRow>
      <ConsentRow
        id="consent-personal-data"
        checked={values.personalData}
        onCheckedChange={set('personalData')}
      >
        Согласен(на) на{' '}
        <LegalLink href="/legal/pd-consent">обработку персональных данных</LegalLink>
      </ConsentRow>
      <ConsentRow
        id="consent-service"
        checked={values.serviceNotifications}
        onCheckedChange={set('serviceNotifications')}
      >
        Согласен(на) получать сервисные уведомления
      </ConsentRow>
      <ConsentRow
        id="consent-marketing"
        checked={values.marketing}
        onCheckedChange={set('marketing')}
      >
        Согласен(на) получать{' '}
        <LegalLink href="/legal/marketing-consent">рекламно-информационные материалы</LegalLink>{' '}
        (необязательно)
      </ConsentRow>
    </div>
  );
}
