import Link from 'next/link';

// Реестр публичных юридических документов. Slug'и и названия зеркалят сид
// (packages/db/prisma/seed.ts) — список стабильный, поэтому в подвале он
// статический, без похода в API с каждой страницы.
export const LEGAL_DOCUMENT_LINKS: ReadonlyArray<{ slug: string; title: string }> = [
  { slug: 'offer', title: 'Договор-оферта' },
  { slug: 'personal-data-policy', title: 'Политика обработки персональных данных' },
  { slug: 'cookie-policy', title: 'Политика использования файлов cookie' },
  { slug: 'portal-rules', title: 'Правила пользования порталом' },
  { slug: 'service-regulations', title: 'Регламент оказания услуг' },
  { slug: 'requisites', title: 'Реквизиты' },
  { slug: 'pd-consent', title: 'Согласие на обработку персональных данных' },
  { slug: 'marketing-consent', title: 'Согласие на получение рекламно-информационных рассылок' },
];

// Реквизиты — из документа заказчика «Реквизиты ИП Гуров» (полные банковские
// реквизиты — на странице /legal/requisites; здесь только идентифицирующие).
const REQUISITES = {
  name: 'ИП Гуров Сергей Валерьевич',
  inn: '781134419902',
  ogrnip: '318784700224175',
  email: 'bugrov.studio@yandex.ru',
} as const;

/**
 * Подвал сайта с реквизитами и ссылками на юридические документы.
 *
 * - `variant="full"` (по умолчанию) — для публичных страниц (вход, регистрация,
 *   /legal): блок «Документы» со всеми ссылками + реквизиты.
 * - `variant="compact"` — одна строка для контентной области ЛК: ссылка
 *   «Документы и реквизиты» + копирайт.
 */
export function SiteFooter({ variant = 'full' }: { variant?: 'full' | 'compact' }) {
  const year = new Date().getFullYear();

  if (variant === 'compact') {
    return (
      <footer className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
        <Link
          href="/legal"
          className="underline-offset-4 hover:text-foreground hover:underline"
        >
          Документы и реквизиты
        </Link>
        <span>
          © {year} {REQUISITES.name}
        </span>
      </footer>
    );
  }

  return (
    <footer className="border-t">
      {/* max-w-2xl — в одну колонну с контентом /legal (layout раздела). */}
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
        <nav aria-label="Юридические документы">
          <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Документы
          </h2>
          <ul className="mt-3 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
            {LEGAL_DOCUMENT_LINKS.map((doc) => (
              <li key={doc.slug}>
                <Link
                  href={`/legal/${doc.slug}`}
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {doc.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <p>{REQUISITES.name}</p>
          <p>
            ИНН: {REQUISITES.inn} · ОГРНИП: {REQUISITES.ogrnip}
          </p>
          <p>
            <a
              href={`mailto:${REQUISITES.email}`}
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {REQUISITES.email}
            </a>
          </p>
          <p>
            © {year} {REQUISITES.name}
          </p>
        </div>
      </div>
    </footer>
  );
}
