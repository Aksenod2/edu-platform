import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// zoom.ts на верхнем уровне импортирует prisma (@platform/db) и crypto.js.
// Мокаем их, чтобы тест был DB-free: getZoomIntegration вернёт «настроенную»
// интеграцию, decryptSecret — расшифрованный секрет. Сеть (fetch) мокаем точечно
// в тестах getMeetingSummary.
vi.mock('@platform/db', () => ({
  prisma: {
    zoomIntegration: {
      findUnique: vi.fn(() =>
        Promise.resolve({
          userId: 'teacher-1',
          accountId: 'acc-1',
          clientId: 'client-1',
          clientSecretEnc: 'enc-secret',
        }),
      ),
    },
  },
}));
vi.mock('../crypto.js', () => ({
  decryptSecret: vi.fn(() => 'client-secret'),
  isEncryptionKeySet: vi.fn(() => true),
}));

import { encodeMeetingPathParam, getMeetingSummary } from '../zoom.js';

describe('encodeMeetingPathParam — кодирование идентификатора встречи для пути API', () => {
  it('числовой id («1234567890») кодируется один раз', () => {
    const id = '1234567890';
    expect(encodeMeetingPathParam(id)).toBe(encodeURIComponent(id));
  });

  it('UUID без слэша — один раз', () => {
    const id = 'abc123==';
    expect(encodeMeetingPathParam(id)).toBe(encodeURIComponent(id));
  });

  it("UUID, начинающийся с '/' (например '/abc==') — дважды", () => {
    const id = '/abc==';
    expect(encodeMeetingPathParam(id)).toBe(encodeURIComponent(encodeURIComponent(id)));
  });

  it("UUID, содержащий '//' (например 'a//b==') — дважды", () => {
    const id = 'a//b==';
    expect(encodeMeetingPathParam(id)).toBe(encodeURIComponent(encodeURIComponent(id)));
  });
});

describe('getMeetingSummary — формирование URL с meetingId/UUID', () => {
  // Имитируем последовательность вызовов fetch: сначала OAuth-токен, затем
  // meeting_summary. Запоминаем URL запроса резюме для проверки кодирования.
  function mockFetchSequence(summaryResponse: Response) {
    const tokenResponse = new Response(JSON.stringify({ access_token: 'access-token' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse) // getZoomAccessToken
      .mockResolvedValueOnce(summaryResponse); // getMeetingSummary
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("UUID со слэшем ('/abc==') → сегмент пути дважды кодирован", async () => {
    const summaryResponse = new Response(JSON.stringify({ summary_overview: 'Итог' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const fetchMock = mockFetchSequence(summaryResponse);

    const result = await getMeetingSummary('teacher-1', '/abc==');
    expect(result).toEqual({ summary_overview: 'Итог' });

    // Второй вызов fetch — meeting_summary. URL первого аргумента — строка.
    const summaryUrl = String(fetchMock.mock.calls[1][0]);
    const doubleEncoded = encodeURIComponent(encodeURIComponent('/abc=='));
    expect(summaryUrl).toContain(`/meetings/${doubleEncoded}/meeting_summary`);
    // Прямой одиночно кодированный сегмент со слэшем тут быть НЕ должен.
    expect(summaryUrl).not.toContain(`/meetings/${encodeURIComponent('/abc==')}/meeting_summary`);
  });

  it('числовой id → сегмент пути кодирован один раз', async () => {
    const summaryResponse = new Response(JSON.stringify({ summary_overview: 'Итог' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const fetchMock = mockFetchSequence(summaryResponse);

    await getMeetingSummary('teacher-1', '1234567890');

    const summaryUrl = String(fetchMock.mock.calls[1][0]);
    expect(summaryUrl).toContain(`/meetings/${encodeURIComponent('1234567890')}/meeting_summary`);
  });

  it('404 (резюме недоступно/не готово) → null, без броска', async () => {
    const summaryResponse = new Response(null, { status: 404 });
    mockFetchSequence(summaryResponse);

    const result = await getMeetingSummary('teacher-1', '1234567890');
    expect(result).toBeNull();
  });
});
