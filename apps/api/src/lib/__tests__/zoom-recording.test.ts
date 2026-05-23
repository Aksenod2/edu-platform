import { describe, it, expect, vi, beforeEach } from 'vitest';

// zoom-recording импортирует s3.js (AWS SDK), zoom.js и @platform/db на верхнем
// уровне. Мокаем их, чтобы тесты были DB/S3/сеть-free. Методы session — vi.fn,
// чтобы покрыть атомарное застолбление обработки (M1).
vi.mock('@platform/db', () => ({
  prisma: {
    session: {
      findUnique: vi.fn(),
      findMany: vi.fn(() => Promise.resolve([])),
      update: vi.fn(() => Promise.resolve({})),
      updateMany: vi.fn(),
    },
    lessonTeacher: {
      findMany: vi.fn(() => Promise.resolve([])),
    },
  },
}));
vi.mock('../s3.js', () => ({ uploadStream: vi.fn() }));
vi.mock('../zoom.js', () => ({
  canCreateMeeting: vi.fn(() => Promise.resolve(true)),
  getMeetingRecordings: vi.fn(() => Promise.resolve([])),
  getMeetingSummary: vi.fn(() => Promise.resolve(null)),
  getZoomAccessToken: vi.fn(() => Promise.resolve('access-token')),
}));

import {
  pickMainRecording,
  buildSummaryText,
  processRecordingForSession,
  markRecordingPending,
  sweepFailedRecordings,
} from '../zoom-recording.js';
import type { ZoomRecordingFile } from '../zoom.js';
import { prisma } from '@platform/db';
import { uploadStream } from '../s3.js';
import { canCreateMeeting, getMeetingRecordings, getZoomAccessToken } from '../zoom.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const mockUpload = vi.mocked(uploadStream);
const mockGetRecordings = vi.mocked(getMeetingRecordings);
const mockGetToken = vi.mocked(getZoomAccessToken);
const mockCanCreateMeeting = vi.mocked(canCreateMeeting);

describe('pickMainRecording — выбор основного видеофайла записи', () => {
  it('пустой/отсутствующий список → null', () => {
    expect(pickMainRecording(null)).toBeNull();
    expect(pickMainRecording(undefined)).toBeNull();
    expect(pickMainRecording([])).toBeNull();
  });

  it('предпочитает shared_screen_with_speaker_view + MP4 с download_url', () => {
    const files: ZoomRecordingFile[] = [
      { file_type: 'M4A', recording_type: 'audio_only', download_url: 'a' },
      { file_type: 'MP4', recording_type: 'gallery_view', download_url: 'b' },
      { file_type: 'MP4', recording_type: 'shared_screen_with_speaker_view', download_url: 'c' },
    ];
    expect(pickMainRecording(files)?.download_url).toBe('c');
  });

  it('нет «экран+спикер» → любой MP4 со ссылкой', () => {
    const files: ZoomRecordingFile[] = [
      { file_type: 'M4A', recording_type: 'audio_only', download_url: 'a' },
      { file_type: 'MP4', recording_type: 'gallery_view', download_url: 'b' },
    ];
    expect(pickMainRecording(files)?.download_url).toBe('b');
  });

  it('распознаёт MP4 по file_extension, если file_type не задан', () => {
    const files: ZoomRecordingFile[] = [
      { recording_type: 'shared_screen_with_speaker_view', file_extension: 'mp4', download_url: 'x' },
    ];
    expect(pickMainRecording(files)?.download_url).toBe('x');
  });

  it('нет MP4 → запасной любой файл с download_url', () => {
    const files: ZoomRecordingFile[] = [
      { file_type: 'TRANSCRIPT', recording_type: 'audio_transcript', download_url: 'tr' },
    ];
    expect(pickMainRecording(files)?.download_url).toBe('tr');
  });

  it('MP4 без download_url не выбирается', () => {
    const files: ZoomRecordingFile[] = [
      { file_type: 'MP4', recording_type: 'shared_screen_with_speaker_view' },
    ];
    expect(pickMainRecording(files)).toBeNull();
  });
});

describe('buildSummaryText — сборка текста итогов из резюме Zoom', () => {
  it('null → null', () => {
    expect(buildSummaryText(null)).toBeNull();
  });

  it('только overview', () => {
    expect(buildSummaryText({ summary_overview: '  Обзор урока  ' })).toBe('Обзор урока');
  });

  it('overview + details-массив секций {label, summary}', () => {
    const text = buildSummaryText({
      summary_overview: 'Главное',
      summary_details: [
        { label: 'Тема 1', summary: 'Разобрали А' },
        { label: 'Тема 2', summary: 'Разобрали Б' },
      ],
    });
    expect(text).toBe('Главное\n\nТема 1: Разобрали А\n\nТема 2: Разобрали Б');
  });

  it('details строкой', () => {
    expect(buildSummaryText({ summary_details: 'Просто текст' })).toBe('Просто текст');
  });

  it('пустые поля → null', () => {
    expect(buildSummaryText({ summary_overview: '   ', summary_details: [] })).toBeNull();
  });
});

describe('processRecordingForSession — атомарное застолбление (M1)', () => {
  const params = {
    sessionId: 'sess-1',
    meetingId: 'mtg-1',
    teacherUserId: 'teacher-1',
  };

  // Успешный fetch записи: тело-поток + ok. Возвращает функцию-восстановитель.
  function stubFetchOk(): () => void {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body: { fake: 'stream' },
      }),
    ) as never;
    return () => {
      globalThis.fetch = original;
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetToken.mockResolvedValue('access-token');
    mockGetRecordings.mockResolvedValue([]);
  });

  it('нет Session → выход без скачивания и без застолбления', async () => {
    db.session.findUnique.mockResolvedValue(null);

    await processRecordingForSession(params);

    expect(db.session.updateMany).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('videoKey уже есть → идемпотентный выход (ready), без застолбления и скачивания', async () => {
    db.session.findUnique.mockResolvedValue({ id: 'sess-1', videoKey: 'recordings/old.mp4' });

    await processRecordingForSession(params);

    // Помечаем ready, но не качаем заново и не «застолбляем».
    expect(db.session.update).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: { recordingStatus: 'ready', recordingError: null },
    });
    expect(db.session.updateMany).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('застолбление не удалось (count===0) → выход без повторного скачивания', async () => {
    db.session.findUnique.mockResolvedValue({ id: 'sess-1', videoKey: null });
    // Другая параллельная доставка уже взяла запись в работу.
    db.session.updateMany.mockResolvedValue({ count: 0 });

    await processRecordingForSession(params);

    // Атомарное условие застолбления именно такое, как требует аудит (M1).
    expect(db.session.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'sess-1',
        videoKey: null,
        OR: [{ recordingStatus: null }, { recordingStatus: { notIn: ['processing', 'ready'] } }],
      },
      data: { recordingStatus: 'processing', recordingError: null },
    });
    // Раз застолбить не вышло — НЕ качаем и НЕ заливаем в S3.
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('застолбление удалось (count===1) → качает и заливает в S3 ровно один раз', async () => {
    db.session.findUnique.mockResolvedValue({ id: 'sess-1', videoKey: null });
    db.session.updateMany.mockResolvedValue({ count: 1 });
    db.session.update.mockResolvedValue({});
    mockUpload.mockResolvedValue({ key: 'recordings/new.mp4' } as never);
    const restoreFetch = stubFetchOk();

    try {
      await processRecordingForSession({
        ...params,
        payloadFiles: [
          {
            file_type: 'MP4',
            recording_type: 'shared_screen_with_speaker_view',
            download_url: 'https://zoom.us/rec/x',
          },
        ],
      });
    } finally {
      restoreFetch();
    }

    expect(db.session.updateMany).toHaveBeenCalledTimes(1);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    // По завершении — videoKey + ready.
    expect(db.session.update).toHaveBeenLastCalledWith({
      where: { id: 'sess-1' },
      data: { videoKey: 'recordings/new.mp4', recordingStatus: 'ready', recordingError: null },
    });
  });

  it('две параллельные доставки: только одна качает (вторая видит count===0)', async () => {
    db.session.findUnique.mockResolvedValue({ id: 'sess-1', videoKey: null });
    db.session.update.mockResolvedValue({});
    mockUpload.mockResolvedValue({ key: 'recordings/new.mp4' } as never);
    // Первый застолбивший получает count===1, второй — count===0.
    db.session.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const restoreFetch = stubFetchOk();

    const files: ZoomRecordingFile[] = [
      {
        file_type: 'MP4',
        recording_type: 'shared_screen_with_speaker_view',
        download_url: 'https://zoom.us/rec/x',
      },
    ];

    try {
      await Promise.all([
        processRecordingForSession({ ...params, payloadFiles: files }),
        processRecordingForSession({ ...params, payloadFiles: files }),
      ]);
    } finally {
      restoreFetch();
    }

    // Обе попытались застолбить, но скачивание/заливка ровно одно.
    expect(db.session.updateMany).toHaveBeenCalledTimes(2);
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });
});

describe('processRecordingForSession — токен скачивания (#3)', () => {
  const params = {
    sessionId: 'sess-1',
    meetingId: 'mtg-1',
    teacherUserId: 'teacher-1',
  };

  const files: ZoomRecordingFile[] = [
    {
      file_type: 'MP4',
      recording_type: 'shared_screen_with_speaker_view',
      download_url: 'https://zoom.us/rec/x',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    db.session.findUnique.mockResolvedValue({ id: 'sess-1', videoKey: null });
    db.session.updateMany.mockResolvedValue({ count: 1 });
    db.session.update.mockResolvedValue({});
    mockUpload.mockResolvedValue({ key: 'recordings/new.mp4' } as never);
    mockGetToken.mockResolvedValue('access-token');
  });

  // Перехватывает URL вызова fetch (токен передаётся query-параметром access_token).
  function stubFetchCapture(sink: { url: string }): () => void {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn((input: unknown) => {
      sink.url = String(input);
      return Promise.resolve({ ok: true, status: 200, body: { fake: 'stream' } });
    }) as never;
    return () => {
      globalThis.fetch = original;
    };
  }

  it('download_token из вебхука уходит в access_token, OAuth-токен не запрашивается', async () => {
    const sink = { url: '' };
    const restore = stubFetchCapture(sink);
    try {
      await processRecordingForSession({ ...params, payloadFiles: files, downloadToken: 'dl-token' });
    } finally {
      restore();
    }

    expect(sink.url).toContain('access_token=dl-token');
    // Не Bearer-заголовок, а query-параметр (иначе теряется на редиректе → 401).
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('без download_token — фолбэк на OAuth-токен, тоже через access_token', async () => {
    const sink = { url: '' };
    const restore = stubFetchCapture(sink);
    try {
      await processRecordingForSession({ ...params, payloadFiles: files });
    } finally {
      restore();
    }

    expect(mockGetToken).toHaveBeenCalledTimes(1);
    expect(sink.url).toContain('access_token=access-token');
  });
});

describe('processRecordingForSession — recordingError без сырых деталей (M3)', () => {
  const params = {
    sessionId: 'sess-1',
    meetingId: 'mtg-1',
    teacherUserId: 'teacher-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db.session.findUnique.mockResolvedValue({ id: 'sess-1', videoKey: null });
    db.session.updateMany.mockResolvedValue({ count: 1 });
    db.session.update.mockResolvedValue({});
    mockGetToken.mockResolvedValue('access-token');
  });

  it('нет подходящего файла → обобщённый текст в recordingError (без URL)', async () => {
    mockGetRecordings.mockResolvedValue([]);

    await expect(
      processRecordingForSession({ ...params, payloadFiles: [] }),
    ).rejects.toThrow();

    const failCall = db.session.update.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c[0]?.data?.recordingStatus === 'failed',
    );
    expect(failCall).toBeTruthy();
    expect(failCall[0].data.recordingError).toBe('В записи Zoom нет подходящего видеофайла (MP4)');
  });

  it('системная ошибка (например fetch с URL в message) → нейтральный текст', async () => {
    // Подсунем download_url с разрешённого хоста, но fetch упадёт с «сырым» текстом.
    const files: ZoomRecordingFile[] = [
      {
        file_type: 'MP4',
        recording_type: 'shared_screen_with_speaker_view',
        download_url: 'https://zoom.us/rec/secret-token-in-url',
      },
    ];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error('connect ECONNREFUSED https://zoom.us/rec/secret-token-in-url')),
    ) as never;

    try {
      await expect(
        processRecordingForSession({ ...params, payloadFiles: files }),
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }

    const failCall = db.session.update.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c[0]?.data?.recordingStatus === 'failed',
    );
    expect(failCall).toBeTruthy();
    // Нейтральный текст — без URL/хоста/токена.
    expect(failCall[0].data.recordingError).toBe('Не удалось обработать запись Zoom');
    expect(failCall[0].data.recordingError).not.toContain('zoom.us');
    expect(failCall[0].data.recordingError).not.toContain('secret-token');
  });
});

describe('markRecordingPending — пометка записи «готовится» на meeting.ended (P5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.session.updateMany.mockResolvedValue({ count: 1 });
  });

  it('ставит pending атомарно через updateMany c защитным WHERE-условием', async () => {
    await markRecordingPending({ sessionId: 'sess-1' });

    // Условие должно пускать pending ТОЛЬКО при videoKey IS NULL и статусе вне
    // ['processing','ready','pending','failed'] — иначе перетёрли бы обработку.
    expect(db.session.updateMany).toHaveBeenCalledTimes(1);
    expect(db.session.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'sess-1',
        videoKey: null,
        OR: [
          { recordingStatus: null },
          { recordingStatus: { notIn: ['processing', 'ready', 'pending', 'failed'] } },
        ],
      },
      data: { recordingStatus: 'pending' },
    });
  });

  it('не выполняет update() напрямую — только условный updateMany (без перетирания)', async () => {
    await markRecordingPending({ sessionId: 'sess-1' });

    // Никакого безусловного session.update — единственный путь записи это updateMany
    // с WHERE-фильтром, что и обеспечивает идемпотентность/безопасность.
    expect(db.session.update).not.toHaveBeenCalled();
  });

  it('count===0 (статус уже processing/ready/pending/failed) → ничего не падает', async () => {
    // WHERE не совпал → 0 обновлённых строк; функция просто завершается без ошибки.
    db.session.updateMany.mockResolvedValue({ count: 0 });

    await expect(markRecordingPending({ sessionId: 'sess-1' })).resolves.toBeUndefined();
    expect(db.session.update).not.toHaveBeenCalled();
  });
});

describe('processRecordingForSession — авто-ретрай транзиентного сбоя скачивания', () => {
  const params = {
    sessionId: 'sess-1',
    meetingId: 'mtg-1',
    teacherUserId: 'teacher-1',
    // Без реальных задержек: нулевые паузы + мгновенный sleep, чтобы тест не висел.
    retryDelaysMs: [0, 0],
    sleep: () => Promise.resolve(),
  };

  const files: ZoomRecordingFile[] = [
    {
      file_type: 'MP4',
      recording_type: 'shared_screen_with_speaker_view',
      download_url: 'https://zoom.us/rec/x',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    db.session.findUnique.mockResolvedValue({ id: 'sess-1', videoKey: null });
    db.session.updateMany.mockResolvedValue({ count: 1 });
    db.session.update.mockResolvedValue({});
    mockUpload.mockResolvedValue({ key: 'recordings/new.mp4' } as never);
    mockGetToken.mockResolvedValue('access-token');
  });

  // Возвращает мок fetch, отдающий по очереди заданные ответы.
  function fetchSequence(responses: Array<{ ok: boolean; status: number; body?: unknown }>) {
    let i = 0;
    return vi.fn(() => {
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return Promise.resolve(r);
    });
  }

  it('транзиентный 401 на первой попытке → повтор → успех (заливка в S3 один раз)', async () => {
    const original = globalThis.fetch;
    const fetchMock = fetchSequence([
      { ok: false, status: 401 }, // 1-я попытка: транзиентный сбой
      { ok: true, status: 200, body: { fake: 'stream' } }, // 2-я: успех
    ]);
    globalThis.fetch = fetchMock as never;

    try {
      await processRecordingForSession({ ...params, payloadFiles: files });
    } finally {
      globalThis.fetch = original;
    }

    // Дважды дёрнули fetch (сбой → повтор), залили запись один раз, статус ready.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(db.session.update).toHaveBeenLastCalledWith({
      where: { id: 'sess-1' },
      data: { videoKey: 'recordings/new.mp4', recordingStatus: 'ready', recordingError: null },
    });
    // failed промежуточно не выставлялся.
    const failCall = db.session.update.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c[0]?.data?.recordingStatus === 'failed',
    );
    expect(failCall).toBeUndefined();
  });

  it('транзиентный 404 дважды, затем успех (исчерпали обе паузы, но дотянулись)', async () => {
    const original = globalThis.fetch;
    const fetchMock = fetchSequence([
      { ok: false, status: 404 },
      { ok: false, status: 404 },
      { ok: true, status: 200, body: { fake: 'stream' } },
    ]);
    globalThis.fetch = fetchMock as never;

    try {
      await processRecordingForSession({ ...params, payloadFiles: files });
    } finally {
      globalThis.fetch = original;
    }

    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 ретрая
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('транзиентный сбой исчерпал ретраи → failed с безопасным текстом (HTTP-код)', async () => {
    const original = globalThis.fetch;
    // Всегда 500 — все попытки (1 + 2 ретрая) проваливаются.
    const fetchMock = fetchSequence([{ ok: false, status: 500 }]);
    globalThis.fetch = fetchMock as never;

    try {
      await expect(
        processRecordingForSession({ ...params, payloadFiles: files }),
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = original;
    }

    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 ретрая
    expect(mockUpload).not.toHaveBeenCalled();
    const failCall = db.session.update.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c[0]?.data?.recordingStatus === 'failed',
    );
    expect(failCall).toBeTruthy();
    // Текст безопасный: только код, без URL/токена.
    expect(failCall[0].data.recordingError).toBe('Не удалось скачать запись Zoom (HTTP 500)');
    expect(failCall[0].data.recordingError).not.toContain('zoom.us');
  });

  it('нетранзиентный 403 → НЕ ретраим, сразу failed', async () => {
    const original = globalThis.fetch;
    const fetchMock = fetchSequence([{ ok: false, status: 403 }]);
    globalThis.fetch = fetchMock as never;

    try {
      await expect(
        processRecordingForSession({ ...params, payloadFiles: files }),
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = original;
    }

    // 403 не входит в транзиентные (401/404/5xx) → ровно одна попытка, без повторов.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('нетранзиентная ошибка «нет MP4» → НЕ ретраим, без fetch вообще', async () => {
    const original = globalThis.fetch;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as never;
    mockGetRecordings.mockResolvedValue([]);

    try {
      await expect(
        processRecordingForSession({ ...params, payloadFiles: [] }),
      ).rejects.toThrow('В записи Zoom нет подходящего видеофайла (MP4)');
    } finally {
      globalThis.fetch = original;
    }

    // Файла нет → до скачивания не дошли, ретраить нечего.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sweepFailedRecordings — фоновый свипер недокачанных записей', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.session.findUnique.mockResolvedValue({ id: 'whatever', videoKey: null });
    db.session.updateMany.mockResolvedValue({ count: 1 });
    db.session.update.mockResolvedValue({});
    mockUpload.mockResolvedValue({ key: 'recordings/new.mp4' } as never);
    mockGetToken.mockResolvedValue('access-token');
    mockCanCreateMeeting.mockResolvedValue(true);
    db.lessonTeacher.findMany.mockResolvedValue([{ userId: 'teacher-1' }]);
    // Свипер не передаёт payloadFiles — запись тянется через API Zoom. Отдаём
    // валидный MP4, чтобы дойти до скачивания (а не упасть на «нет MP4»).
    mockGetRecordings.mockResolvedValue([
      {
        file_type: 'MP4',
        recording_type: 'shared_screen_with_speaker_view',
        download_url: 'https://zoom.us/rec/x',
      },
    ]);
  });

  const sweepOpts = { retryDelaysMs: [], sleep: () => Promise.resolve() };

  it('выборка: zoomMeetingId != null, videoKey null, failed/pending в окне ИЛИ зависший processing', async () => {
    db.session.findMany.mockResolvedValue([]);

    await sweepFailedRecordings({ now: new Date('2026-05-23T12:00:00Z'), ...sweepOpts });

    expect(db.session.findMany).toHaveBeenCalledTimes(1);
    const arg = db.session.findMany.mock.calls[0][0];
    expect(arg.where.zoomMeetingId).toEqual({ not: null });
    expect(arg.where.videoKey).toBeNull();
    expect(arg.where.OR).toHaveLength(2);
    // 1-я ветка — failed/pending в окне.
    expect(arg.where.OR[0].recordingStatus).toEqual({ in: ['failed', 'pending'] });
    expect(arg.where.OR[0].updatedAt.gte).toBeInstanceOf(Date);
    // 2-я ветка — зависший processing (старше порога).
    expect(arg.where.OR[1].recordingStatus).toBe('processing');
    expect(arg.where.OR[1].updatedAt.lt).toBeInstanceOf(Date);
    // Ограничение пачки.
    expect(arg.take).toBe(20);
  });

  it('failed-занятие в окне → вызывает processRecordingForSession с teacherUserId из каскада', async () => {
    db.session.findMany.mockResolvedValue([
      {
        id: 'sess-1',
        streamId: 'str-1',
        lessonId: 'les-1',
        zoomMeetingId: 'mtg-1',
        recordingStatus: 'failed',
      },
    ]);
    // Запись успешно докачивается с первой попытки.
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, body: { fake: 'stream' } }),
    ) as never;

    let started: number;
    try {
      started = await sweepFailedRecordings({ now: new Date(), ...sweepOpts });
    } finally {
      globalThis.fetch = original;
    }

    expect(started).toBe(1);
    expect(db.lessonTeacher.findMany).toHaveBeenCalledWith({
      where: { lessonId: 'les-1' },
      select: { userId: true },
    });
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('зависший processing → сброс в failed (атомарно) перед повтором', async () => {
    db.session.findMany.mockResolvedValue([
      {
        id: 'sess-stuck',
        streamId: 'str-1',
        lessonId: 'les-1',
        zoomMeetingId: 'mtg-1',
        recordingStatus: 'processing',
      },
    ]);
    // updateMany: сначала сброс зависшего (count 1), потом claim внутри обработки (count 1).
    db.session.updateMany.mockResolvedValue({ count: 1 });
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, body: { fake: 'stream' } }),
    ) as never;

    try {
      await sweepFailedRecordings({ now: new Date(), ...sweepOpts });
    } finally {
      globalThis.fetch = original;
    }

    // Был вызов сброса зависшего processing с защитным WHERE-условием.
    const resetCall = db.session.updateMany.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) =>
        c[0]?.where?.recordingStatus === 'processing' &&
        c[0]?.data?.recordingStatus === 'failed',
    );
    expect(resetCall).toBeTruthy();
    expect(resetCall[0].where.videoKey).toBeNull();
  });

  it('зависший processing, но сброс не прошёл (count 0) → занятие пропускается', async () => {
    db.session.findMany.mockResolvedValue([
      {
        id: 'sess-stuck',
        streamId: 'str-1',
        lessonId: 'les-1',
        zoomMeetingId: 'mtg-1',
        recordingStatus: 'processing',
      },
    ]);
    db.session.updateMany.mockResolvedValue({ count: 0 }); // загрузка уже дошла — не трогаем

    const started = await sweepFailedRecordings({ now: new Date(), ...sweepOpts });

    expect(started).toBe(0);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('нет преподавателя с рабочей интеграцией → занятие пропускается', async () => {
    db.session.findMany.mockResolvedValue([
      {
        id: 'sess-1',
        streamId: 'str-1',
        lessonId: 'les-1',
        zoomMeetingId: 'mtg-1',
        recordingStatus: 'failed',
      },
    ]);
    mockCanCreateMeeting.mockResolvedValue(false); // ни один преподаватель не подходит

    const started = await sweepFailedRecordings({ now: new Date(), ...sweepOpts });

    expect(started).toBe(0);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('ошибка на одном занятии не валит весь проход (глотается, продолжаем)', async () => {
    db.session.findMany.mockResolvedValue([
      { id: 's1', streamId: 'str', lessonId: 'les-1', zoomMeetingId: 'm1', recordingStatus: 'failed' },
      { id: 's2', streamId: 'str', lessonId: 'les-1', zoomMeetingId: 'm2', recordingStatus: 'failed' },
    ]);
    // На первом занятии падаем при поиске преподавателя, на втором — всё ок.
    db.lessonTeacher.findMany
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValue([{ userId: 'teacher-1' }]);
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, body: { fake: 'stream' } }),
    ) as never;

    let started: number;
    try {
      started = await sweepFailedRecordings({ now: new Date(), ...sweepOpts });
    } finally {
      globalThis.fetch = original;
    }

    // Первое глотнули, второе обработали.
    expect(started).toBe(1);
  });
});
