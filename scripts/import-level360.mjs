/**
 * Импорт студентов потока level360.
 *
 * Создаёт студентов через админ-API (по одному, без дублей), задаёт каждому
 * временный пароль и печатает таблицу email → пароль для рассылки. Также
 * создаёт поток (Stream) с именем "level360", если его ещё нет.
 *
 * Запуск (ничего не коммитим с ключом — он берётся из окружения):
 *
 *   API_URL="https://<api-host>" \
 *   API_KEY="sk_..." \
 *   node scripts/import-level360.mjs
 *
 * API_URL — базовый URL API. Подойдёт и прокси веба:
 *   API_URL="https://<web-host>/api-proxy"
 *
 * Требуется Node 18+ (используется глобальный fetch).
 */

const API_URL = (process.env.API_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.API_KEY || '';
const STREAM_NAME = process.env.STREAM_NAME || 'level360';

if (!API_URL || !API_KEY) {
  console.error('Заполни переменные окружения API_URL и API_KEY. Пример:');
  console.error('  API_URL="https://<web-host>/api-proxy" API_KEY="sk_..." node scripts/import-level360.mjs');
  process.exit(1);
}

const STUDENTS = [
  { name: 'Бикташев Евгений Валерьевич', email: 'mr.bikt89@gmail.com' },
  { name: 'Симоновская Ольга Александровна', email: 'olgasimanovskaia@gmail.com' },
  { name: 'Завельская Виктория Дмитриевна', email: 'zavelskaya.design@gmail.com' },
  { name: 'Петрова Анна Владимировна', email: 'petrovaaann@gmail.com' },
  { name: 'Довлетгириева Лариса Магомедовна', email: 'larisa.dovl@yandex.ru' },
  { name: 'Спиридонов Владислав', email: 'hello.vlsp@yandex.ru' },
  { name: 'Зайнутдинов Артур', email: 'dethurik@gmail.com' },
  { name: 'Татьяна Дуо', email: 'tanyadyo13@gmail.com' },
  { name: 'Хохлова Наталия Юрьевна', email: 'minina.nataliya@inbox.ru' },
  { name: 'Павлов Сергей Владимирович', email: 'svpmbox@yandex.ru' },
  { name: 'Кухтерина Ирина Владимировна', email: 'kuhterinairina@gmail.com' },
  { name: 'Ольга Полякова', email: 'ovwpolyakova@gmail.com' },
  { name: 'Королев Артем Сергеевич', email: 'artem.korolevvvv@gmail.com' },
  { name: 'Петренок Павел Михайлович', email: 'p.putrenok@gmail.com' },
  { name: 'Малинина Алёна Романовна', email: 'iammalinina@gmail.com' },
  { name: 'Железцова Алена', email: 'alyena_yurk@mail.ru' },
  { name: 'Демченко Ирина Александровна', email: 'iravereina@gmail.com' },
];

async function api(path, init = {}) {
  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    ...(init.headers || {}),
  };
  // Content-Type ставим только при наличии тела: Fastify отклоняет пустое
  // JSON-тело (HTTP 400) — из-за этого падал bodyless POST (reset-password).
  if (init.body !== undefined && init.body !== null) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

async function ensureStream() {
  const list = await api('/streams');
  if (!list.ok) {
    console.warn(`! Не удалось получить список потоков (HTTP ${list.status}). Поток не создаю.`);
    return;
  }
  const existing = (list.body?.streams || []).find((s) => s.name === STREAM_NAME);
  if (existing) {
    console.log(`• Поток "${STREAM_NAME}" уже существует (${existing.id}).`);
    return existing.id;
  }
  const created = await api('/streams', {
    method: 'POST',
    body: JSON.stringify({ name: STREAM_NAME }),
  });
  if (created.ok) {
    const id = created.body?.stream?.id;
    console.log(`✓ Создан поток "${STREAM_NAME}" (${id}).`);
    return id;
  }
  console.warn(`! Не удалось создать поток "${STREAM_NAME}" (HTTP ${created.status}): ${JSON.stringify(created.body)}`);
  return null;
}

async function findStudentIdByEmail(email) {
  const res = await api(`/users?search=${encodeURIComponent(email)}`);
  if (!res.ok) return null;
  const match = (res.body?.users || []).find(
    (u) => (u.email || '').toLowerCase() === email.toLowerCase(),
  );
  return match?.id ?? null;
}

async function run() {
  console.log(`API_URL=${API_URL}`);
  const streamId = await ensureStream();

  const results = [];
  const enrollIds = [];
  for (const student of STUDENTS) {
    const row = { name: student.name, email: student.email, password: '', note: '' };
    try {
      const created = await api('/users', {
        method: 'POST',
        body: JSON.stringify({ email: student.email, name: student.name }),
      });

      let userId = null;
      if (created.ok) {
        userId = created.body?.user?.id;
        row.note = 'создан';
      } else if (created.status === 409) {
        userId = await findStudentIdByEmail(student.email);
        row.note = 'уже был';
      } else {
        row.note = `ошибка создания HTTP ${created.status}`;
      }

      if (userId) {
        enrollIds.push(userId);
        const reset = await api(`/users/${userId}/reset-password`, { method: 'POST' });
        if (reset.ok) {
          row.password = reset.body?.tempPassword || '';
        } else {
          row.note += ` | сброс пароля HTTP ${reset.status}`;
        }
      }
    } catch (err) {
      row.note = `исключение: ${err instanceof Error ? err.message : String(err)}`;
    }
    results.push(row);
    console.log(`  ${row.email} → ${row.password || '—'} (${row.note})`);
  }

  // Зачисляем созданных студентов в поток level360
  if (streamId && enrollIds.length) {
    const enroll = await api(`/streams/${streamId}/students`, {
      method: 'POST',
      body: JSON.stringify({ studentIds: enrollIds }),
    });
    if (enroll.ok) {
      console.log(`\n✓ Зачислено в поток "${STREAM_NAME}": ${enrollIds.length}.`);
    } else {
      console.warn(`\n! Не удалось зачислить в поток (HTTP ${enroll.status}): ${JSON.stringify(enroll.body)}. Возможно, миграция БД ещё не применилась на проде — повтори позже.`);
    }
  }

  console.log('\n================ ИТОГ (email | пароль | статус) ================');
  for (const r of results) {
    console.log(`${r.email}\t${r.password || '—'}\t${r.note}`);
  }
  const ok = results.filter((r) => r.password).length;
  console.log(`\nГотово: с паролем ${ok} из ${results.length}.`);
}

run().catch((err) => {
  console.error('Фатальная ошибка:', err);
  process.exit(1);
});
