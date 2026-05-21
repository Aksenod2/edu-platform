/**
 * Email templates — Nothing Phone design language.
 *
 * Tokens: black (#000) bg, white (#FFF) text, red (#FF0000) accent,
 * Space Grotesk font stack, 8-point spacing grid.
 *
 * Each template exports { subject, html, text }.
 */

// ─── Design tokens (email-safe subset) ───────────────────────────
const BRAND = {
  name: 'Обучающая платформа',
  bg: '#000000',
  surface: '#0D0D0D',
  border: '#1A1A1A',
  accent: '#FF0000',
  accentDim: 'rgba(255,0,0,0.12)',
  textPrimary: '#FFFFFF',
  textSecondary: '#A0A0A0',
  textTertiary: '#606060',
  fontStack:
    "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  monoStack: "'Space Mono', 'Courier New', monospace",
  radius: '6px',
};

// ─── Shared layout ───────────────────────────────────────────────

interface LayoutOpts {
  preheader: string;
  headline: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  settingsUrl: string;
}

function layout(opts: LayoutOpts): string {
  const cta = opts.ctaLabel && opts.ctaUrl
    ? `
      <tr>
        <td style="padding: 32px 0 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="
                background-color: ${BRAND.accent};
                border-radius: ${BRAND.radius};
              ">
                <a href="${opts.ctaUrl}" target="_blank" style="
                  display: inline-block;
                  padding: 14px 32px;
                  font-family: ${BRAND.fontStack};
                  font-size: 14px;
                  font-weight: 600;
                  letter-spacing: 0.04em;
                  text-transform: uppercase;
                  color: ${BRAND.textPrimary};
                  text-decoration: none;
                ">${opts.ctaLabel}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${opts.headline}</title>
  <!--[if mso]>
  <noscript><xml>
    <o:OfficeDocumentSettings>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
  </xml></noscript>
  <![endif]-->
  <style>
    /* Reset */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; height: 100% !important; }

    /* Dark mode enforcement */
    :root { color-scheme: dark; }
    body { background-color: ${BRAND.bg} !important; color: ${BRAND.textPrimary} !important; }

    /* Responsive */
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .email-body { padding: 24px 20px !important; }
      .cta-btn { display: block !important; width: 100% !important; text-align: center !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: ${BRAND.bg}; color: ${BRAND.textPrimary}; font-family: ${BRAND.fontStack};">

  <!-- Preheader (hidden preview text) -->
  <div style="display: none; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: ${BRAND.bg};">
    ${opts.preheader}
    ${'&nbsp;&zwnj;'.repeat(30)}
  </div>

  <!-- Outer wrapper -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
    style="background-color: ${BRAND.bg};">
    <tr>
      <td align="center" style="padding: 40px 16px;">

        <!-- Email container -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"
          class="email-container" width="560"
          style="max-width: 560px; width: 100%;">

          <!-- Header: dot-matrix accent line -->
          <tr>
            <td style="padding-bottom: 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="
                    height: 2px;
                    background: linear-gradient(90deg, ${BRAND.accent} 0%, ${BRAND.accent} 40%, transparent 40%, transparent 44%, ${BRAND.accent} 44%, ${BRAND.accent} 48%, transparent 48%);
                    font-size: 0; line-height: 0;
                  ">&nbsp;</td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="
                    padding-top: 24px;
                    font-family: ${BRAND.monoStack};
                    font-size: 13px;
                    font-weight: 700;
                    letter-spacing: 0.12em;
                    text-transform: uppercase;
                    color: ${BRAND.textSecondary};
                  ">${BRAND.name}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body card -->
          <tr>
            <td class="email-body" style="
              background-color: ${BRAND.surface};
              border: 1px solid ${BRAND.border};
              border-radius: ${BRAND.radius};
              padding: 40px 36px;
            ">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">

                <!-- Headline -->
                <tr>
                  <td style="
                    font-family: ${BRAND.fontStack};
                    font-size: 22px;
                    font-weight: 600;
                    line-height: 1.3;
                    color: ${BRAND.textPrimary};
                    padding-bottom: 20px;
                  ">${opts.headline}</td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="
                    font-family: ${BRAND.fontStack};
                    font-size: 15px;
                    line-height: 1.6;
                    color: ${BRAND.textSecondary};
                  ">${opts.body}</td>
                </tr>

                <!-- CTA -->
                ${cta}

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top: 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <!-- Divider dots -->
                <tr>
                  <td style="
                    font-family: ${BRAND.monoStack};
                    font-size: 11px;
                    letter-spacing: 6px;
                    color: ${BRAND.textTertiary};
                    padding-bottom: 20px;
                  ">...</td>
                </tr>
                <tr>
                  <td style="
                    font-family: ${BRAND.fontStack};
                    font-size: 12px;
                    line-height: 1.6;
                    color: ${BRAND.textTertiary};
                  ">
                    <a href="${opts.settingsUrl}" style="color: ${BRAND.textSecondary}; text-decoration: underline;">
                      Управление уведомлениями
                    </a>
                    <br>
                    &copy; ${new Date().getFullYear()} ${BRAND.name}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Helper: plain-text footer ───────────────────────────────────

function textFooter(settingsUrl: string): string {
  return `\n---\nУправление уведомлениями: ${settingsUrl}\n© ${new Date().getFullYear()} ${BRAND.name}`;
}

// ─── Helper: escape HTML in dynamic values ───────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Template interfaces ─────────────────────────────────────────

export interface EmailMessage {
  subject: string;
  html: string;
  text: string;
}

interface BaseCtx {
  frontendUrl: string;
}

// ─── 1. Новый урок опубликован ────────────────────────────────────

interface NewLessonCtx extends BaseCtx {
  studentName: string;
  lessonTitle: string;
  streamTitle: string;
  lessonUrl: string;
}

export function newLessonPublished(ctx: NewLessonCtx): EmailMessage {
  const settingsUrl = `${ctx.frontendUrl}/settings/notifications`;
  const subject = `Новый урок: ${ctx.lessonTitle}`;

  return {
    subject,
    html: layout({
      preheader: `В потоке «${ctx.streamTitle}» опубликован новый урок`,
      headline: 'Новый урок опубликован',
      body: `
        <p style="margin: 0 0 16px;">Здравствуйте, ${esc(ctx.studentName)}!</p>
        <p style="margin: 0 0 8px;">В потоке <strong style="color: ${BRAND.textPrimary};">${esc(ctx.streamTitle)}</strong> опубликован новый урок:</p>
        <p style="margin: 0; font-size: 17px; font-weight: 500; color: ${BRAND.textPrimary};">${esc(ctx.lessonTitle)}</p>
      `,
      ctaLabel: 'Открыть урок',
      ctaUrl: ctx.lessonUrl,
      settingsUrl,
    }),
    text: `Здравствуйте, ${ctx.studentName}!\n\nВ потоке «${ctx.streamTitle}» опубликован новый урок:\n${ctx.lessonTitle}\n\nОткрыть урок: ${ctx.lessonUrl}${textFooter(settingsUrl)}`,
  };
}

// ─── 2. Новое задание добавлено ──────────────────────────────────

interface NewAssignmentCtx extends BaseCtx {
  studentName: string;
  assignmentTitle: string;
  streamTitle: string;
  deadline?: string;
  assignmentUrl: string;
}

export function newAssignmentAdded(ctx: NewAssignmentCtx): EmailMessage {
  const settingsUrl = `${ctx.frontendUrl}/settings/notifications`;
  const subject = `Новое задание: ${ctx.assignmentTitle}`;
  const deadlineRow = ctx.deadline
    ? `<p style="margin: 12px 0 0; font-family: ${BRAND.monoStack}; font-size: 13px; color: ${BRAND.textTertiary};">Дедлайн: ${esc(ctx.deadline)}</p>`
    : '';
  const deadlineText = ctx.deadline ? `\nДедлайн: ${ctx.deadline}` : '';

  return {
    subject,
    html: layout({
      preheader: `Новое задание в потоке «${ctx.streamTitle}»`,
      headline: 'Новое задание',
      body: `
        <p style="margin: 0 0 16px;">Здравствуйте, ${esc(ctx.studentName)}!</p>
        <p style="margin: 0 0 8px;">В потоке <strong style="color: ${BRAND.textPrimary};">${esc(ctx.streamTitle)}</strong> добавлено задание:</p>
        <p style="margin: 0; font-size: 17px; font-weight: 500; color: ${BRAND.textPrimary};">${esc(ctx.assignmentTitle)}</p>
        ${deadlineRow}
      `,
      ctaLabel: 'Открыть задание',
      ctaUrl: ctx.assignmentUrl,
      settingsUrl,
    }),
    text: `Здравствуйте, ${ctx.studentName}!\n\nВ потоке «${ctx.streamTitle}» добавлено задание:\n${ctx.assignmentTitle}${deadlineText}\n\nОткрыть задание: ${ctx.assignmentUrl}${textFooter(settingsUrl)}`,
  };
}

// ─── 3. Дедлайн задания — 24 часа ────────────────────────────────

interface DeadlineReminderCtx extends BaseCtx {
  studentName: string;
  assignmentTitle: string;
  deadline: string;
  assignmentUrl: string;
}

export function deadlineReminder(ctx: DeadlineReminderCtx): EmailMessage {
  const settingsUrl = `${ctx.frontendUrl}/settings/notifications`;
  const subject = `Дедлайн через 24 часа: ${ctx.assignmentTitle}`;

  return {
    subject,
    html: layout({
      preheader: `До сдачи задания «${ctx.assignmentTitle}» осталось менее 24 часов`,
      headline: 'Дедлайн через 24 часа',
      body: `
        <p style="margin: 0 0 16px;">Здравствуйте, ${esc(ctx.studentName)}!</p>
        <p style="margin: 0 0 12px;">До дедлайна задания осталось менее <strong style="color: ${BRAND.accent};">24 часов</strong>.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0;">
          <tr>
            <td style="
              background-color: ${BRAND.accentDim};
              border-left: 3px solid ${BRAND.accent};
              padding: 12px 16px;
              border-radius: 0 ${BRAND.radius} ${BRAND.radius} 0;
            ">
              <p style="margin: 0 0 4px; font-size: 15px; font-weight: 500; color: ${BRAND.textPrimary};">${esc(ctx.assignmentTitle)}</p>
              <p style="margin: 0; font-family: ${BRAND.monoStack}; font-size: 13px; color: ${BRAND.textTertiary};">${esc(ctx.deadline)}</p>
            </td>
          </tr>
        </table>
      `,
      ctaLabel: 'Открыть задание',
      ctaUrl: ctx.assignmentUrl,
      settingsUrl,
    }),
    text: `Здравствуйте, ${ctx.studentName}!\n\nДо дедлайна задания осталось менее 24 часов!\n\n${ctx.assignmentTitle}\nДедлайн: ${ctx.deadline}\n\nОткрыть задание: ${ctx.assignmentUrl}${textFooter(settingsUrl)}`,
  };
}

// ─── 4. Ответ преподавателя в треде ──────────────────────────────

interface TeacherReplyCtx extends BaseCtx {
  studentName: string;
  threadSubject: string;
  replyPreview: string;
  threadUrl: string;
}

export function teacherReply(ctx: TeacherReplyCtx): EmailMessage {
  const settingsUrl = `${ctx.frontendUrl}/settings/notifications`;
  const subject = `Ответ преподавателя: ${ctx.threadSubject}`;

  return {
    subject,
    html: layout({
      preheader: `Преподаватель ответил в треде «${ctx.threadSubject}»`,
      headline: 'Новый ответ преподавателя',
      body: `
        <p style="margin: 0 0 16px;">Здравствуйте, ${esc(ctx.studentName)}!</p>
        <p style="margin: 0 0 12px;">Преподаватель оставил ответ в треде <strong style="color: ${BRAND.textPrimary};">${esc(ctx.threadSubject)}</strong>:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0; width: 100%;">
          <tr>
            <td style="
              border-left: 3px solid ${BRAND.border};
              padding: 12px 16px;
              font-style: italic;
              color: ${BRAND.textSecondary};
            ">${esc(ctx.replyPreview)}</td>
          </tr>
        </table>
      `,
      ctaLabel: 'Открыть тред',
      ctaUrl: ctx.threadUrl,
      settingsUrl,
    }),
    text: `Здравствуйте, ${ctx.studentName}!\n\nПреподаватель оставил ответ в треде «${ctx.threadSubject}»:\n\n> ${ctx.replyPreview}\n\nОткрыть тред: ${ctx.threadUrl}${textFooter(settingsUrl)}`,
  };
}

// ─── 5. Задание проверено / оценка выставлена ────────────────────

interface AssignmentReviewedCtx extends BaseCtx {
  studentName: string;
  assignmentTitle: string;
  grade?: string;
  feedbackPreview?: string;
  assignmentUrl: string;
}

export function assignmentReviewed(ctx: AssignmentReviewedCtx): EmailMessage {
  const settingsUrl = `${ctx.frontendUrl}/settings/notifications`;
  const subject = ctx.grade
    ? `Оценка за «${ctx.assignmentTitle}»: ${ctx.grade}`
    : `Задание проверено: ${ctx.assignmentTitle}`;

  const gradeRow = ctx.grade
    ? `<p style="margin: 12px 0 0;">Оценка: <span style="font-family: ${BRAND.monoStack}; font-size: 20px; font-weight: 700; color: ${BRAND.accent};">${esc(ctx.grade)}</span></p>`
    : '';

  const feedbackRow = ctx.feedbackPreview
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 16px 0 0; width: 100%;">
        <tr>
          <td style="
            border-left: 3px solid ${BRAND.border};
            padding: 12px 16px;
            font-style: italic;
            color: ${BRAND.textSecondary};
          ">${esc(ctx.feedbackPreview)}</td>
        </tr>
      </table>`
    : '';

  const feedbackText = ctx.feedbackPreview ? `\n\nКомментарий преподавателя:\n> ${ctx.feedbackPreview}` : '';
  const gradeText = ctx.grade ? `\nОценка: ${ctx.grade}` : '';

  return {
    subject,
    html: layout({
      preheader: `Ваше задание «${ctx.assignmentTitle}» проверено`,
      headline: 'Задание проверено',
      body: `
        <p style="margin: 0 0 16px;">Здравствуйте, ${esc(ctx.studentName)}!</p>
        <p style="margin: 0;">Ваше задание <strong style="color: ${BRAND.textPrimary};">${esc(ctx.assignmentTitle)}</strong> проверено.</p>
        ${gradeRow}
        ${feedbackRow}
      `,
      ctaLabel: 'Открыть задание',
      ctaUrl: ctx.assignmentUrl,
      settingsUrl,
    }),
    text: `Здравствуйте, ${ctx.studentName}!\n\nВаше задание «${ctx.assignmentTitle}» проверено.${gradeText}${feedbackText}\n\nОткрыть задание: ${ctx.assignmentUrl}${textFooter(settingsUrl)}`,
  };
}

// ─── 6. Новое событие в расписании ───────────────────────────────

interface NewScheduleEventCtx extends BaseCtx {
  studentName: string;
  eventTitle: string;
  eventDate: string;
  eventTime?: string;
  streamTitle: string;
  scheduleUrl: string;
}

export function newScheduleEvent(ctx: NewScheduleEventCtx): EmailMessage {
  const settingsUrl = `${ctx.frontendUrl}/settings/notifications`;
  const subject = `Новое событие: ${ctx.eventTitle}`;
  const timeStr = ctx.eventTime ? `, ${esc(ctx.eventTime)}` : '';

  return {
    subject,
    html: layout({
      preheader: `Новое событие в расписании потока «${ctx.streamTitle}»`,
      headline: 'Новое событие в расписании',
      body: `
        <p style="margin: 0 0 16px;">Здравствуйте, ${esc(ctx.studentName)}!</p>
        <p style="margin: 0 0 12px;">В расписание потока <strong style="color: ${BRAND.textPrimary};">${esc(ctx.streamTitle)}</strong> добавлено событие:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0;">
          <tr>
            <td style="
              background-color: ${BRAND.accentDim};
              border-left: 3px solid ${BRAND.accent};
              padding: 12px 16px;
              border-radius: 0 ${BRAND.radius} ${BRAND.radius} 0;
            ">
              <p style="margin: 0 0 4px; font-size: 15px; font-weight: 500; color: ${BRAND.textPrimary};">${esc(ctx.eventTitle)}</p>
              <p style="margin: 0; font-family: ${BRAND.monoStack}; font-size: 13px; color: ${BRAND.textTertiary};">${esc(ctx.eventDate)}${timeStr}</p>
            </td>
          </tr>
        </table>
      `,
      ctaLabel: 'Открыть расписание',
      ctaUrl: ctx.scheduleUrl,
      settingsUrl,
    }),
    text: `Здравствуйте, ${ctx.studentName}!\n\nВ расписание потока «${ctx.streamTitle}» добавлено событие:\n\n${ctx.eventTitle}\n${ctx.eventDate}${ctx.eventTime ? ', ' + ctx.eventTime : ''}\n\nОткрыть расписание: ${ctx.scheduleUrl}${textFooter(settingsUrl)}`,
  };
}

// ─── 7. Студент сдал задание (для Админа) ────────────────────────

interface SubmissionReceivedCtx extends BaseCtx {
  adminName: string;
  studentName: string;
  assignmentTitle: string;
  streamTitle: string;
  submissionUrl: string;
}

export function submissionReceived(ctx: SubmissionReceivedCtx): EmailMessage {
  const settingsUrl = `${ctx.frontendUrl}/settings/notifications`;
  const subject = `Сдано задание: ${ctx.studentName} — ${ctx.assignmentTitle}`;

  return {
    subject,
    html: layout({
      preheader: `${ctx.studentName} сдал задание «${ctx.assignmentTitle}»`,
      headline: 'Студент сдал задание',
      body: `
        <p style="margin: 0 0 16px;">Здравствуйте, ${esc(ctx.adminName)}!</p>
        <p style="margin: 0 0 12px;">Студент <strong style="color: ${BRAND.textPrimary};">${esc(ctx.studentName)}</strong> сдал задание на проверку:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0;">
          <tr>
            <td style="
              background-color: ${BRAND.accentDim};
              border-left: 3px solid ${BRAND.accent};
              padding: 12px 16px;
              border-radius: 0 ${BRAND.radius} ${BRAND.radius} 0;
            ">
              <p style="margin: 0 0 4px; font-size: 15px; font-weight: 500; color: ${BRAND.textPrimary};">${esc(ctx.assignmentTitle)}</p>
              <p style="margin: 0; font-family: ${BRAND.monoStack}; font-size: 13px; color: ${BRAND.textTertiary};">Поток: ${esc(ctx.streamTitle)}</p>
            </td>
          </tr>
        </table>
      `,
      ctaLabel: 'Проверить задание',
      ctaUrl: ctx.submissionUrl,
      settingsUrl,
    }),
    text: `Здравствуйте, ${ctx.adminName}!\n\nСтудент ${ctx.studentName} сдал задание на проверку:\n\n${ctx.assignmentTitle}\nПоток: ${ctx.streamTitle}\n\nПроверить задание: ${ctx.submissionUrl}${textFooter(settingsUrl)}`,
  };
}

// ─── 8. Приглашение на платформу (системный, переработанный) ─────

interface InviteCtx extends BaseCtx {
  name: string;
  inviteUrl: string;
  expiresIn?: string;
}

export function platformInvite(ctx: InviteCtx): EmailMessage {
  const settingsUrl = `${ctx.frontendUrl}/settings/notifications`;
  const subject = `Приглашение на обучающую платформу`;
  const expiryNote = ctx.expiresIn || '72 часа';

  return {
    subject,
    html: layout({
      preheader: 'Вас пригласили на обучающую платформу — завершите регистрацию',
      headline: 'Добро пожаловать!',
      body: `
        <p style="margin: 0 0 16px;">Здравствуйте, ${esc(ctx.name)}!</p>
        <p style="margin: 0 0 8px;">Вас пригласили на <strong style="color: ${BRAND.textPrimary};">${BRAND.name}</strong>.</p>
        <p style="margin: 0;">Нажмите кнопку ниже, чтобы завершить регистрацию. Ссылка действительна <strong style="color: ${BRAND.textPrimary};">${esc(expiryNote)}</strong>.</p>
      `,
      ctaLabel: 'Принять приглашение',
      ctaUrl: ctx.inviteUrl,
      settingsUrl,
    }),
    text: `Здравствуйте, ${ctx.name}!\n\nВас пригласили на ${BRAND.name}.\n\nПерейдите по ссылке для регистрации: ${ctx.inviteUrl}\n\nСсылка действительна ${expiryNote}.${textFooter(settingsUrl)}`,
  };
}

// ─── Сброс пароля (системный, переработанный) ────────────────────

interface PasswordResetCtx extends BaseCtx {
  resetUrl: string;
}

export function passwordReset(ctx: PasswordResetCtx): EmailMessage {
  const settingsUrl = `${ctx.frontendUrl}/settings/notifications`;
  const subject = 'Сброс пароля — Обучающая платформа';

  return {
    subject,
    html: layout({
      preheader: 'Запрос на сброс пароля — нажмите для продолжения',
      headline: 'Сброс пароля',
      body: `
        <p style="margin: 0 0 16px;">Вы запросили сброс пароля.</p>
        <p style="margin: 0 0 8px;">Нажмите кнопку ниже, чтобы установить новый пароль. Ссылка действительна <strong style="color: ${BRAND.textPrimary};">1 час</strong>.</p>
        <p style="margin: 0; font-size: 13px; color: ${BRAND.textTertiary};">Если вы не запрашивали сброс — проигнорируйте это письмо.</p>
      `,
      ctaLabel: 'Сбросить пароль',
      ctaUrl: ctx.resetUrl,
      settingsUrl,
    }),
    text: `Вы запросили сброс пароля.\n\nПерейдите по ссылке для сброса: ${ctx.resetUrl}\n\nСсылка действительна 1 час.\n\nЕсли вы не запрашивали сброс — проигнорируйте это письмо.${textFooter(settingsUrl)}`,
  };
}
