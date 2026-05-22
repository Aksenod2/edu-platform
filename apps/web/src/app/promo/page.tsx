import type { CSSProperties } from 'react';

export const metadata = {
  title: 'OCHOBA — промо (превью)',
  description: 'Две версии промо-страницы OCHOBA для сравнения.',
};

const wrap: CSSProperties = {
  minHeight: '100dvh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '2.5rem',
  padding: '4rem 1.5rem',
  background: '#0f0f10',
  color: '#fafafa',
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  textAlign: 'center',
};

const grid: CSSProperties = {
  display: 'grid',
  gap: '1.25rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  width: '100%',
  maxWidth: 760,
};

const card: CSSProperties = {
  display: 'block',
  textDecoration: 'none',
  color: 'inherit',
  border: '1px solid #2a2a2d',
  borderRadius: 16,
  padding: '1.75rem',
  background: '#161618',
  textAlign: 'left',
};

const tag: CSSProperties = {
  fontSize: 12,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#9a9aa2',
};

export default function PromoChooser() {
  return (
    <main style={wrap}>
      <div style={{ maxWidth: 640 }}>
        <p style={tag}>OCHOBA · превью промо-страницы</p>
        <h1 style={{ fontSize: 34, fontWeight: 600, margin: '0.6rem 0 0.5rem' }}>
          Две версии для сравнения
        </h1>
        <p style={{ color: '#b6b6bd', margin: 0, lineHeight: 1.6 }}>
          Откройте обе и сравните подачу. Версии можно дорабатывать дальше.
        </p>
      </div>

      <div style={grid}>
        <a href="/promo/v1.html" style={card}>
          <p style={tag}>Версия 1</p>
          <h2 style={{ fontSize: 22, margin: '0.5rem 0 0.4rem' }}>Редакционная</h2>
          <p style={{ color: '#b6b6bd', margin: 0, lineHeight: 1.6 }}>
            Выразительная: акцидентный шрифт, зелёный акцент, светлая и тёмная
            темы. Со своим характером.
          </p>
        </a>

        <a href="/promo/v2.html" style={card}>
          <p style={tag}>Версия 2</p>
          <h2 style={{ fontSize: 22, margin: '0.5rem 0 0.4rem' }}>
            Минимал на shadcn/ui
          </h2>
          <p style={{ color: '#b6b6bd', margin: 0, lineHeight: 1.6 }}>
            Спокойная и нейтральная: базовые компоненты shadcn/ui, максимум
            воздуха, только светлая тема.
          </p>
        </a>
      </div>
    </main>
  );
}
