import { describe, it, expect, vi } from 'vitest';

// zoom-recording импортирует s3.js (AWS SDK) и @platform/db на верхнем уровне.
// Для unit-тестов ЧИСТЫХ функций (pickMainRecording/buildSummaryText) поднимать
// их не нужно — мокаем, чтобы импорт модуля был DB/S3-free.
vi.mock('@platform/db', () => ({ prisma: {} }));
vi.mock('../s3.js', () => ({ uploadStream: vi.fn() }));

import { pickMainRecording, buildSummaryText } from '../zoom-recording.js';
import type { ZoomRecordingFile } from '../zoom.js';

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
