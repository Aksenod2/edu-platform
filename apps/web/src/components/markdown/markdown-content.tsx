'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@platform/ui/lib/utils';

// Кастомные стили элементов markdown на семантических токенах (плагина prose
// в проекте нет, поэтому стилизуем напрямую). Размер — text-sm, мягкий leading.
const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-6 mb-3 text-xl font-semibold text-foreground first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-5 mb-2 text-lg font-semibold text-foreground first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-4 mb-2 text-base font-semibold text-foreground first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-3 mb-1.5 text-sm font-semibold text-foreground first:mt-0">{children}</h4>
  ),
  p: ({ children }) => <p className="my-2 leading-relaxed text-foreground">{children}</p>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-4"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-foreground">{children}</ul>,
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 text-foreground">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-border pl-4 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  // Инлайн-код и блоки кода различаем по наличию переноса строки в содержимом.
  code: ({ className, children }) => {
    const isBlock = /\n/.test(String(children));
    if (isBlock) {
      return (
        <code className={cn('block font-mono text-xs text-foreground', className)}>{children}</code>
      );
    }
    return (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
        {children}
      </code>
    );
  },
  // Блок кода скроллится по горизонтали — на узких экранах нет выезда вёрстки.
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-md border bg-muted p-3">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-left text-foreground">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-muted px-2 py-1 font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
  img: ({ src, alt }) => (
    <img
      src={typeof src === 'string' ? src : undefined}
      alt={alt ?? ''}
      className="my-3 max-w-full rounded-md"
    />
  ),
};

/**
 * Рендер markdown на семантических токенах (заголовки, списки, код, таблицы и т.п.).
 * Поддерживает GFM (таблицы, чек-листы, ~зачёркивание~). Сырой HTML НЕ рендерится
 * (нет rehype-raw / dangerouslySetInnerHTML) — защита от XSS. Размер текста и перенос
 * слов задаются снаружи через className на обёртке.
 */
export function MarkdownContent({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={cn('text-sm break-words', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
