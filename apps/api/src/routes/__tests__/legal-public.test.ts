// Тесты публичного чтения юридических документов (Волна 1 «правовой минимум»):
// GET /public/legal (список с признаком опубликованной версии) и
// GET /public/legal/:slug (текст актуальной версии; 404 на неизвестный slug;
// body=null, пока версий нет — фронт покажет заглушку). DB-free: prisma мокнута.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('@platform/db', () => ({
  prisma: {
    legalDocument: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));

import { legalPublicRoutes } from '../legal.js';
import { prisma } from '@platform/db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const PUBLISHED_AT = new Date('2026-06-01T00:00:00.000Z');

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(legalPublicRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /public/legal — список документов', () => {
  it('отдаёт slug, title и сводку актуальной версии (или null, если версий нет)', async () => {
    db.legalDocument.findMany.mockResolvedValueOnce([
      {
        slug: 'offer',
        title: 'Договор-оферта',
        versions: [{ versionNumber: 2, publishedAt: PUBLISHED_AT }],
      },
      { slug: 'requisites', title: 'Реквизиты', versions: [] },
    ]);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/public/legal' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      documents: [
        {
          slug: 'offer',
          title: 'Договор-оферта',
          currentVersion: { versionNumber: 2, publishedAt: PUBLISHED_AT.toISOString() },
        },
        { slug: 'requisites', title: 'Реквизиты', currentVersion: null },
      ],
    });
  });
});

describe('GET /public/legal/:slug — документ с текстом актуальной версии', () => {
  it('опубликованная версия → 200 с body (markdown) и метаданными версии', async () => {
    db.legalDocument.findUnique.mockResolvedValueOnce({
      slug: 'offer',
      title: 'Договор-оферта',
      versions: [{ versionNumber: 3, publishedAt: PUBLISHED_AT, body: '# Оферта\n\nТекст.' }],
    });

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/public/legal/offer' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      document: {
        slug: 'offer',
        title: 'Договор-оферта',
        versionNumber: 3,
        publishedAt: PUBLISHED_AT.toISOString(),
        body: '# Оферта\n\nТекст.',
      },
    });
    // Берём именно АКТУАЛЬНУЮ версию: сортировка по versionNumber desc, take 1.
    const arg = db.legalDocument.findUnique.mock.calls[0][0];
    expect(arg.select.versions).toMatchObject({
      orderBy: { versionNumber: 'desc' },
      take: 1,
    });
  });

  it('версий ещё нет → 200 с body=null (заглушка на фронте)', async () => {
    db.legalDocument.findUnique.mockResolvedValueOnce({
      slug: 'requisites',
      title: 'Реквизиты',
      versions: [],
    });

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/public/legal/requisites' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      document: {
        slug: 'requisites',
        title: 'Реквизиты',
        versionNumber: null,
        publishedAt: null,
        body: null,
      },
    });
  });

  it('неизвестный slug → 404', async () => {
    db.legalDocument.findUnique.mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/public/legal/nope' });

    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('Документ не найден');
  });
});
