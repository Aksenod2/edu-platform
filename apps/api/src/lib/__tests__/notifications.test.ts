import { describe, it, expect, vi, beforeEach } from 'vitest';

// notifications.ts на верхнем уровне импортирует prisma (@platform/db) и каналы
// (email, webpush, telegram, crypto). Мокаем всё, чтобы тест был DB-free и не ходил
// в сеть. Фокус — Telegram-ветка createNotification (задача 4 эпика уведомлений).

// vi.mock хойстится в начало файла, поэтому моки объявляем через vi.hoisted,
// чтобы на них можно было ссылаться и в фабриках, и в тестах.
const {
  prismaMock,
  sendNotificationEmailMock,
  sendWebPushMock,
  sendTelegramMessageMock,
  decryptSecretMock,
  isEncryptionKeySetMock,
} = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    notificationPreference: { findUnique: vi.fn() },
    notification: { create: vi.fn() },
    pushSubscription: { findMany: vi.fn() },
    telegramIntegration: { findUnique: vi.fn() },
  },
  sendNotificationEmailMock: vi.fn((..._args: unknown[]) => Promise.resolve()),
  sendWebPushMock: vi.fn((..._args: unknown[]) => Promise.resolve()),
  sendTelegramMessageMock: vi.fn((..._args: unknown[]) => Promise.resolve(true)),
  decryptSecretMock: vi.fn((..._args: unknown[]) => 'plain-bot-token'),
  isEncryptionKeySetMock: vi.fn(() => true),
}));

vi.mock('@platform/db', () => ({
  prisma: prismaMock,
  Prisma: { JsonNull: null, InputJsonValue: {} },
}));

vi.mock('../email.js', () => ({
  sendNotificationEmail: sendNotificationEmailMock,
}));

vi.mock('../webpush.js', () => ({
  sendWebPush: sendWebPushMock,
}));

vi.mock('../telegram.js', () => ({
  sendTelegramMessage: sendTelegramMessageMock,
}));

vi.mock('../crypto.js', () => ({
  decryptSecret: decryptSecretMock,
  isEncryptionKeySet: isEncryptionKeySetMock,
}));

import { createNotification, sendPushToUser } from '../notifications.js';

const baseParams = {
  userId: 'user-1',
  type: 'NEW_SUBMISSION' as never,
  title: 'Заголовок',
  body: 'Тело',
};

const fullIntegration = {
  botTokenEnc: 'enc-token',
  chatId: '12345',
  enabled: true,
};

// Утилита: дождаться выполнения fire-and-forget промисов (микротасков).
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createNotification — Telegram-ветка', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'u@example.com',
      name: 'Имя',
    });
    prismaMock.notificationPreference.findUnique.mockResolvedValue(null);
    prismaMock.notification.create.mockResolvedValue({});
    prismaMock.pushSubscription.findMany.mockResolvedValue([]);
    prismaMock.telegramIntegration.findUnique.mockResolvedValue(fullIntegration);
    decryptSecretMock.mockReturnValue('plain-bot-token');
    isEncryptionKeySetMock.mockReturnValue(true);
    sendTelegramMessageMock.mockResolvedValue(true);
  });

  it('шлёт в Telegram при выполнении всех условий (preference нет → дефолт включён)', async () => {
    await createNotification(baseParams);
    await flush();

    expect(prismaMock.telegramIntegration.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { botTokenEnc: true, chatId: true, enabled: true },
    });
    expect(decryptSecretMock).toHaveBeenCalledWith('enc-token');
    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      'plain-bot-token',
      '12345',
      '<b>Заголовок</b>\nТело',
    );
  });

  it('экранирует HTML-спецсимволы в title/body', async () => {
    await createNotification({
      ...baseParams,
      title: 'A < B & C',
      body: '<script>x</script>',
    });
    await flush();

    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      'plain-bot-token',
      '12345',
      '<b>A &lt; B &amp; C</b>\n&lt;script&gt;x&lt;/script&gt;',
    );
  });

  it('НЕ шлёт, если telegramEnabled=false (и не делает лишний запрос за интеграцией)', async () => {
    prismaMock.notificationPreference.findUnique.mockResolvedValue({
      telegramEnabled: false,
    });
    await createNotification(baseParams);
    await flush();

    expect(prismaMock.telegramIntegration.findUnique).not.toHaveBeenCalled();
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it('НЕ шлёт, если ключ шифрования не настроен (и не делает лишний запрос)', async () => {
    isEncryptionKeySetMock.mockReturnValue(false);
    await createNotification(baseParams);
    await flush();

    expect(prismaMock.telegramIntegration.findUnique).not.toHaveBeenCalled();
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it('НЕ шлёт, если интеграции нет', async () => {
    prismaMock.telegramIntegration.findUnique.mockResolvedValue(null);
    await createNotification(baseParams);
    await flush();

    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it('НЕ шлёт, если enabled=false', async () => {
    prismaMock.telegramIntegration.findUnique.mockResolvedValue({
      ...fullIntegration,
      enabled: false,
    });
    await createNotification(baseParams);
    await flush();

    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it('НЕ шлёт, если нет chatId', async () => {
    prismaMock.telegramIntegration.findUnique.mockResolvedValue({
      ...fullIntegration,
      chatId: null,
    });
    await createNotification(baseParams);
    await flush();

    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it('НЕ шлёт, если нет токена', async () => {
    prismaMock.telegramIntegration.findUnique.mockResolvedValue({
      ...fullIntegration,
      botTokenEnc: null,
    });
    await createNotification(baseParams);
    await flush();

    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it('сбой sendTelegramMessage (rejection) не валит createNotification', async () => {
    sendTelegramMessageMock.mockRejectedValue(new Error('boom'));
    await expect(createNotification(baseParams)).resolves.toBeUndefined();
    await flush();
    // in-app уведомление всё равно создано
    expect(prismaMock.notification.create).toHaveBeenCalled();
  });

  it('сбой decryptSecret (throw) не валит createNotification и не зовёт отправку', async () => {
    decryptSecretMock.mockImplementation(() => {
      throw new Error('bad key');
    });
    await expect(createNotification(baseParams)).resolves.toBeUndefined();
    await flush();
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).toHaveBeenCalled();
  });

  it('не ломает существующие каналы: создаёт in-app и шлёт email при дефолтах', async () => {
    await createNotification(baseParams);
    await flush();

    expect(prismaMock.notification.create).toHaveBeenCalled();
    expect(sendNotificationEmailMock).toHaveBeenCalled();
  });
});

describe('sendPushToUser — push без создания записи Notification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('шлёт web-push на все подписки пользователя и НЕ создаёт Notification', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([
      { id: 's1', endpoint: 'e1', p256dh: 'p1', auth: 'a1' },
      { id: 's2', endpoint: 'e2', p256dh: 'p2', auth: 'a2' },
    ]);

    await sendPushToUser('user-1', { title: 'T', body: 'B', data: { url: '/x' } });
    await flush();

    expect(prismaMock.pushSubscription.findMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(sendWebPushMock).toHaveBeenCalledTimes(2);
    expect(sendWebPushMock).toHaveBeenCalledWith(
      { id: 's1', endpoint: 'e1', p256dh: 'p1', auth: 'a1' },
      { title: 'T', body: 'B', data: { url: '/x' } },
    );
    // Лента НЕ затрагивается — это «только push».
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('нет подписок → тихо выходит, ничего не шлёт', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([]);
    await sendPushToUser('user-1', { title: 'T', body: 'B' });
    await flush();
    expect(sendWebPushMock).not.toHaveBeenCalled();
  });

  it('сбой одной подписки не валит метод (fire-and-forget)', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([
      { id: 's1', endpoint: 'e1', p256dh: 'p1', auth: 'a1' },
    ]);
    sendWebPushMock.mockRejectedValue(new Error('boom'));
    await expect(sendPushToUser('user-1', { title: 'T', body: 'B' })).resolves.toBeUndefined();
    await flush();
  });
});
