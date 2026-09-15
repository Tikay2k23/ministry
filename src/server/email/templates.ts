import type { EmailMessage } from './email';

const escapeHtml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#FAFAF7;font-family:Arial,Helvetica,sans-serif;color:#1F2328">
<div style="max-width:520px;margin:32px auto;background:#fff;border:1px solid #E4E4DE;border-radius:10px;padding:32px">
<p style="margin:0 0 4px;font-weight:bold;color:#1F5F24">GenTouch</p>
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
${bodyHtml}
<p style="margin:24px 0 0;font-size:12px;color:#5C6370">Generation Touch Harvest International · There's a Nation Inside of You!</p>
</div></body></html>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#1F5F24;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">${escapeHtml(label)}</a></p>`;
}

export function magicLinkEmail(to: string, url: string, minutes: number): EmailMessage {
  return {
    to,
    subject: 'Your GenTouch sign-in link',
    text: `Use this link to sign in to the GenTouch Ministry System:\n\n${url}\n\nThe link works once and expires in ${minutes} minutes.\nIf you didn't ask to sign in, you can ignore this email.`,
    html: layout(
      'Sign in to GenTouch',
      `<p>Tap the button to sign in. The link works once and expires in ${minutes} minutes.</p>${button(url, 'Sign in')}<p style="font-size:13px;color:#5C6370">If you didn't ask to sign in, you can ignore this email.</p>`,
    ),
  };
}

/** Generic notification email (prayer reminders and similar). The body is plain text, escaped. */
export function notificationEmail(to: string, title: string, body: string, link: { url: string; label: string } | null): EmailMessage {
  return {
    to,
    subject: title,
    text: `${body}${link ? `\n\n${link.label}: ${link.url}` : ''}\n\n— GenTouch`,
    html: layout(title, `<p>${escapeHtml(body)}</p>${link ? button(link.url, link.label) : ''}`),
  };
}

export function invitationEmail(to: string, inviterName: string, signInUrl: string): EmailMessage {
  return {
    to,
    subject: 'You’ve been invited to the GenTouch Ministry System',
    text: `${inviterName} has invited you to the GenTouch Ministry System.\n\nOpen ${signInUrl} and sign in with this email address (${to}). We'll email you a one-time sign-in link — no password needed.`,
    html: layout(
      'You’re invited',
      `<p>${escapeHtml(inviterName)} has invited you to the GenTouch Ministry System.</p><p>Sign in with this email address (<strong>${escapeHtml(to)}</strong>). We'll send you a one-time link — no password needed.</p>${button(signInUrl, 'Go to sign in')}`,
    ),
  };
}
