import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Обучающая платформа',
  description: 'Платформа для обмена заданиями и обратной связью',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
