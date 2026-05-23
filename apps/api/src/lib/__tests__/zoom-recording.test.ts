import { describe, it, expect, vi, beforeEach } from 'vitest';

// zoom-recording импортирует s3.js (AWS SDK), zoom.js и @platform/db на верхнем
// уровне. Мокаем их, чтобы тесты были DB/S3/сеть-free. Методы session — vi.fn,
// чтобы покрыть атомарное застолбление обработки (M1).
vi.mock('@platform/db', () => ({
  prisma: {
    session: {
      findUnique: vi.fn(),
      update: vi.fn(() => Promise.resolve({})),
      updateMany: vi.fn(),
    },
  },
}));
vi.mock('../s3.js', () => ({ uploadStream: vi.fn() }));
vi.mock('../zoom.js', () => ({
  getMeetingRecordings: vi.fn(() => Promise.resolve([])),
  getMeetingSummary: vi.fn(() => Promise.resolve(null)),
  getZoomAccessToken: vi.fn(() => Promise.resolve('access-token')),
}));

import {
  pickMainRecording,
  buildSummaryText,
  processRecordingForSession,
} from '../zoom-recording.js';
import type { ZoomRecordingFile } from '../zoom.js';
import { prisma } from '@platform/db';
import { uploadStream } from '../s3.js';
import { getMeetingRecordings, getZoomAccessToken } from '../zoom.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const mockUpload = vi.mocked(uploadStream);
const mockGetRecordings = vi.mocked(getMeetingRecordings);
const mockGetToken = vi.mocked(getZoomAccessToken);

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
