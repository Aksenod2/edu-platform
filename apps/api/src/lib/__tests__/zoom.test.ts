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

import {
  encodeMeetingPathParam,
  getMeetingSummary,
  getMeetingRecordings,
  getMeetingDetail,
  createZoomMeeting,
} from '../zoom.js';

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

  it('400 «Invalid meeting id» (запрошен по числовому id без UUID) → null, БЕЗ броска (трактуем как «ещё недоступно»)', async () => {
    const summaryResponse = new Response(
      JSON.stringify({ code: 300, message: 'Invalid meeting id' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
    mockFetchSequence(summaryResponse);

    const result = await getMeetingSummary('teacher-1', '1234567890');
    // Раньше тут бросалось «400 Invalid meeting id» — теперь это processing-сигнал.
    expect(result).toBeNull();
  });

  it('403 (нет доступа/scope) → бросок (реальная ошибка, не маскируем под «недоступно»)', async () => {
    const summaryResponse = new Response(
      JSON.stringify({ message: 'нет scope' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
    mockFetchSequence(summaryResponse);

    await expect(getMeetingSummary('teacher-1', 'uuid==')).rejects.toThrow();
  });
});

describe('getMeetingRecordings — формирование URL с meetingId/UUID (#188)', () => {
  // Имитируем fetch: сначала OAuth-токен, затем listing recordings.
  function mockFetchSequence(recordingsResponse: Response) {
    const tokenResponse = new Response(JSON.stringify({ access_token: 'access-token' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse) // getZoomAccessToken
      .mockResolvedValueOnce(recordingsResponse); // getMeetingRecordings
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("UUID со слэшем ('/abc==') → сегмент пути дважды кодирован (как у meeting_summary)", async () => {
    const recordingsResponse = new Response(JSON.stringify({ recording_files: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const fetchMock = mockFetchSequence(recordingsResponse);

    await getMeetingRecordings('teacher-1', '/abc==');

    const url = String(fetchMock.mock.calls[1][0]);
    const doubleEncoded = encodeURIComponent(encodeURIComponent('/abc=='));
    expect(url).toContain(`/meetings/${doubleEncoded}/recordings`);
    // Сырой одиночно кодированный сегмент со слэшем (старый encodeURIComponent) недопустим.
    expect(url).not.toContain(`/meetings/${encodeURIComponent('/abc==')}/recordings`);
  });

  it('числовой id → сегмент пути кодирован один раз', async () => {
    const recordingsResponse = new Response(JSON.stringify({ recording_files: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const fetchMock = mockFetchSequence(recordingsResponse);

    await getMeetingRecordings('teacher-1', '1234567890');

    const url = String(fetchMock.mock.calls[1][0]);
    expect(url).toContain(`/meetings/${encodeURIComponent('1234567890')}/recordings`);
  });

  it('404 (записи ещё нет) → ZoomApiHttpError со status 404 (вызывающий трактует как processing)', async () => {
    const recordingsResponse = new Response(null, { status: 404 });
    mockFetchSequence(recordingsResponse);

    await expect(getMeetingRecordings('teacher-1', '1234567890')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('getMeetingDetail — ленивый доезд UUID встречи по числовому id', () => {
  function mockFetchSequence(detailResponse: Response) {
    const tokenResponse = new Response(JSON.stringify({ access_token: 'access-token' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse) // getZoomAccessToken
      .mockResolvedValueOnce(detailResponse); // getMeetingDetail
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET /meetings/{numericId} вернул uuid → возвращаем его', async () => {
    const detailResponse = new Response(
      JSON.stringify({ id: 1234567890, uuid: 'UUID-from-detail==' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    const fetchMock = mockFetchSequence(detailResponse);

    const result = await getMeetingDetail('teacher-1', '1234567890');
    expect(result).toEqual({ uuid: 'UUID-from-detail==' });

    // Запрос по числовому id (кодируется один раз), без хвоста meeting_summary.
    const detailUrl = String(fetchMock.mock.calls[1][0]);
    expect(detailUrl).toContain(`/meetings/${encodeURIComponent('1234567890')}`);
    expect(detailUrl).not.toContain('/meeting_summary');
  });

  it('404 (встречи уже нет / неверный id) → { uuid: null }, без броска', async () => {
    mockFetchSequence(new Response(null, { status: 404 }));
    const result = await getMeetingDetail('teacher-1', '1234567890');
    expect(result).toEqual({ uuid: null });
  });

  it('403 (реальная ошибка доступа) → бросок ZoomApiHttpError', async () => {
    mockFetchSequence(
      new Response(JSON.stringify({ message: 'нет доступа' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(getMeetingDetail('teacher-1', '1234567890')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('ответ без uuid → { uuid: null }', async () => {
    mockFetchSequence(
      new Response(JSON.stringify({ id: 1234567890 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await getMeetingDetail('teacher-1', '1234567890');
    expect(result).toEqual({ uuid: null });
  });
});

describe('createZoomMeeting — захват UUID встречи при создании', () => {
  function mockFetchSequence(createResponse: Response) {
    const tokenResponse = new Response(JSON.stringify({ access_token: 'access-token' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse) // getZoomAccessToken
      .mockResolvedValueOnce(createResponse); // createZoomMeeting POST
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ответ Zoom с uuid → возвращаем joinUrl + meetingId + meetingUuid', async () => {
    mockFetchSequence(
      new Response(
        JSON.stringify({ id: 1234567890, uuid: 'NEW-UUID==', join_url: 'https://zoom.us/j/123' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const result = await createZoomMeeting('teacher-1', { topic: 'Урок', startTime: null });
    expect(result).toEqual({
      joinUrl: 'https://zoom.us/j/123',
      meetingId: '1234567890',
      meetingUuid: 'NEW-UUID==',
    });
  });

  it('ответ без uuid → meetingUuid=null (доедет лениво/вебхуком), создание не падает', async () => {
    mockFetchSequence(
      new Response(JSON.stringify({ id: 1234567890, join_url: 'https://zoom.us/j/123' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await createZoomMeeting('teacher-1', { topic: 'Урок', startTime: null });
    expect(result.meetingUuid).toBeNull();
    expect(result.meetingId).toBe('1234567890');
  });
});
