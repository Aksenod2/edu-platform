'use client';

import { useEffect, useRef } from 'react';
import { sendVideoProgress, videoProgressUrl, type VideoProgressResult } from '@/lib/api';

// Идентификаторы трекаемого видео урока (наш загруженный файл, не внешний embed).
export interface VideoTrackTarget {
  lessonId: string;
  videoId: string;
  streamId: string;
}

interface UseVideoTrackingOptions {
  // Ref на <video>-элемент нашего плеера (VideoFileFrame).
  videoRef: React.RefObject<HTMLVideoElement | null>;
  // Идентификаторы видео + поток студента. Если null — трекинг выключен.
  target: VideoTrackTarget | null;
  accessToken: string | null;
  // Колбэк с серверным ответом (для будущего UI прогресса). Сейчас опционален.
  onProgress?: (result: VideoProgressResult) => void;
}

// Минимальная длина проигранного куска (сек), которую считаем значимой. Отсекает
// дробный «дребезг» timeupdate и микросдвиги от перемотки.
const MIN_SEGMENT_SEC = 0.3;
// Разрыв между позициями (сек), после которого считаем это скачком (перемоткой),
// а не обычным воспроизведением: текущий сегмент закрываем, новый начинаем с прыжка.
const SEEK_GAP_SEC = 1.5;
// Период троттлинга отправки по реально проигранному времени (сек).
const FLUSH_EVERY_PLAYED_SEC = 12;

// Слить пересекающиеся/смежные интервалы, чтобы не слать дубли серверу.
function mergeIntervals(intervals: [number, number][]): [number, number][] {
  if (intervals.length <= 1) return intervals;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const [start, end] = sorted[i];
    if (start <= last[1] + 0.01) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/**
 * Трекинг прогресса просмотра НАШЕГО видеофайла урока (Этап A лога активности).
 *
 * Накопление: по `timeupdate` ведём «реально проигранные» куски — фиксируем
 * сегмент между предыдущей и текущей позицией, пока идёт обычное воспроизведение.
 * Скачок (перемотка/seek) закрывает текущий сегмент и начинает новый с новой
 * точки, чтобы перемотка не засчитывалась как просмотр.
 *
 * Отправка: троттлинг ~12 сек проигрывания ИЛИ события pause/ended/скрытие
 * вкладки/размонтирование. Буфер шлём накопленными новыми интервалами; после
 * успешной обычной отправки буфер чистим. На уходе со страницы — fetch с
 * keepalive (Authorization обязателен, поэтому не sendBeacon). Пустой буфер не
 * шлём. Ошибки сети глотаем — это фоновая телеметрия.
 */
export function useVideoTracking({
  videoRef,
  target,
  accessToken,
  onProgress,
}: UseVideoTrackingOptions): void {
  // Колбэк держим в ref, чтобы не пересоздавать эффект при смене ссылки на него.
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !target || !accessToken) return;

    const { lessonId, videoId, streamId } = target;

    // Буфер новых (ещё не отправленных) интервалов + открытый сегмент.
    let buffer: [number, number][] = [];
    let segStart: number | null = null;
    let lastPos = video.currentTime || 0;
    // Сколько проигранного времени накопилось с прошлой отправки (для троттлинга).
    let playedSinceFlush = 0;
    let sending = false;

    // Закрыть текущий открытый сегмент [segStart..lastPos] и положить в буфер.
    const closeSegment = () => {
      if (segStart !== null && lastPos - segStart >= MIN_SEGMENT_SEC) {
        buffer.push([segStart, lastPos]);
      }
      segStart = null;
    };

    // Снять текущий снимок интервалов для отправки (буфер + открытый сегмент),
    // не «закрывая» сегмент в самом буфере — чтобы воспроизведение продолжалось.
    const snapshotIntervals = (): [number, number][] => {
      const snapshot = [...buffer];
      if (segStart !== null && lastPos - segStart >= MIN_SEGMENT_SEC) {
        snapshot.push([segStart, lastPos]);
      }
      return mergeIntervals(snapshot);
    };

    // Обычная отправка через api.ts. После успеха — вычищаем отправленное из
    // буфера и переносим начало открытого сегмента на текущую позицию.
    const flush = async () => {
      if (sending) return;
      const intervals = snapshotIntervals();
      if (intervals.length === 0) return;
      sending = true;
      // То, что отправляем, считаем «израсходованным»: буфер очищаем, а открытый
      // сегмент перезапускаем с текущей позиции (его кусок уже ушёл в snapshot).
      buffer = [];
      if (segStart !== null) segStart = lastPos;
      playedSinceFlush = 0;
      try {
        const result = await sendVideoProgress(accessToken, {
          lessonId,
          videoId,
          streamId,
          positionSec: video.currentTime,
          durationSec: Number.isFinite(video.duration) ? video.duration : 0,
          intervals,
        });
        onProgressRef.current?.(result);
      } catch {
        // Фоновая телеметрия — молча игнорируем сбой (вернуть интервалы в буфер
        // не пытаемся, чтобы не накапливать бесконечно при оффлайне).
      } finally {
        sending = false;
      }
    };

    // Надёжная отправка на уходе со страницы/размонтировании: keepalive-fetch с
    // Authorization (sendBeacon заголовок не ставит). ended помечает завершение.
    const flushKeepalive = (ended: boolean) => {
      closeSegment();
      const intervals = mergeIntervals(buffer);
      if (intervals.length === 0 && !ended) return;
      buffer = [];
      const body = JSON.stringify({
        streamId,
        positionSec: video.currentTime,
        durationSec: Number.isFinite(video.duration) ? video.duration : 0,
        intervals,
        ended,
      });
      try {
        void fetch(videoProgressUrl(lessonId, videoId), {
          method: 'POST',
          keepalive: true,
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body,
        }).catch(() => {});
      } catch {
        // Нет сети/keepalive недоступен — это всего лишь телеметрия.
      }
    };

    const handleTimeUpdate = () => {
      const now = video.currentTime;
      if (video.seeking) {
        lastPos = now;
        return;
      }
      const gap = now - lastPos;
      if (segStart === null) {
        segStart = now;
      } else if (gap < 0 || gap > SEEK_GAP_SEC) {
        // Скачок назад или большой вперёд = перемотка: закрываем и начинаем заново.
        closeSegment();
        segStart = now;
      } else {
        // Обычное воспроизведение: засчитываем проигранное время в троттлинг.
        playedSinceFlush += gap;
      }
      lastPos = now;
      if (playedSinceFlush >= FLUSH_EVERY_PLAYED_SEC) {
        void flush();
      }
    };

    const handleSeeking = () => {
      // Перемотка: закрываем текущий проигранный сегмент (новый откроется после).
      closeSegment();
    };

    const handleSeeked = () => {
      lastPos = video.currentTime;
      segStart = null;
    };

    const handlePause = () => {
      void flush();
    };

    const handleEnded = () => {
      flushKeepalive(true);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flushKeepalive(false);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('seeking', handleSeeking);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('seeking', handleSeeking);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      document.removeEventListener('visibilitychange', handleVisibility);
      // На размонтировании дошлём остаток буфера (keepalive переживёт unmount).
      flushKeepalive(false);
    };
    // Перезапускаем трекинг только при смене самого видео/цели/токена.
  }, [videoRef, target?.lessonId, target?.videoId, target?.streamId, accessToken]);
}
