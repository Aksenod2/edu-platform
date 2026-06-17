// Клиент Telegram Bot API на нативном fetch (без новых зависимостей).
//
// АРХИТЕКТУРА per-user: общего бота платформы НЕТ. Каждый преподаватель (admin)
// создаёт собственного бота в @BotFather и вводит ЕГО токен в настройках (как
// Zoom-секреты). Поэтому ВСЕ функции принимают botToken ПАРАМЕТРОМ — никакого
// модульного кэша username/токена (у разных пользователей разные боты).

const TELEGRAM_API_BASE = 'https://api.telegram.org';

// Базовый URL метода Bot API для конкретного токена.
function methodUrl(botToken: string, method: string): string {
  return `${TELEGRAM_API_BASE}/bot${botToken}/${method}`;
}

// getMe — проверка валидности токена и получение @username бота.
// Возвращает { username } при успехе; null при невалидном токене/сетевой ошибке
// (используется для валидации при сохранении токена — без броска).
export async function getBotInfo(botToken: string): Promise<{ username: string } | null> {
  try {
    const res = await fetch(methodUrl(botToken, 'getMe'));
    if (!res.ok) return null;
    const body = (await res.json()) as {
      ok?: boolean;
      result?: { username?: string };
    };
    if (!body.ok || !body.result?.username) return null;
    return { username: body.result.username };
  } catch (err) {
    console.warn('[telegram] getMe failed', err);
    return null;
  }
}

// getUpdates — разовая привязка chatId: берём chat.id из ПОСЛЕДНЕГО сообщения
// боту. Возвращает chat.id строкой; null если апдейтов с сообщением нет
// (пользователь ещё не открыл бота / не нажал Старт) либо при ошибке.
export async function fetchChatIdFromUpdates(botToken: string): Promise<string | null> {
  try {
    const res = await fetch(methodUrl(botToken, 'getUpdates'));
    if (!res.ok) return null;
    const body = (await res.json()) as {
      ok?: boolean;
      result?: Array<{ message?: { chat?: { id?: number | string } } }>;
    };
    if (!body.ok || !Array.isArray(body.result) || body.result.length === 0) {
      return null;
    }
    // Идём с конца: ищем последний апдейт, где есть message.chat.id.
    for (let i = body.result.length - 1; i >= 0; i -= 1) {
      const chatId = body.result[i]?.message?.chat?.id;
      if (chatId !== undefined && chatId !== null) {
        return String(chatId);
      }
    }
    return null;
  } catch (err) {
    console.warn('[telegram] getUpdates failed', err);
    return null;
  }
}

// sendMessage — отправка уведомления. parse_mode HTML по умолчанию.
// На ЛЮБОЙ ошибке (в т.ч. 403 — пользователь заблокировал/удалил бота)
// логирует и возвращает false, НЕ бросает (пригодится задаче 4 — отправка
// уведомлений не должна валить бизнес-операцию).
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  opts?: { parseMode?: 'HTML' | 'MarkdownV2' | 'Markdown'; disableWebPagePreview?: boolean },
): Promise<boolean> {
  try {
    const res = await fetch(methodUrl(botToken, 'sendMessage'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: opts?.parseMode ?? 'HTML',
        disable_web_page_preview: opts?.disableWebPagePreview ?? true,
      }),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const errBody = (await res.json()) as { description?: string };
        detail = errBody.description ?? '';
      } catch {
        // тело может быть не JSON
      }
      console.warn(`[telegram] sendMessage failed (${res.status})${detail ? `: ${detail}` : ''}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[telegram] sendMessage error', err);
    return false;
  }
}
