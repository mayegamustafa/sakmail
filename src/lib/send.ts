/**
 * Sends mail over Brevo's HTTPS API.
 *
 * Deliberately not SMTP. Hosting platforms routinely block outbound 587 and 465
 * to stop their machines being used as spam relays, and the failure looks like a
 * connection timeout, which reads like a wrong password and sends people hunting
 * in the wrong place. This was measured on the sister project: Brevo answered on
 * 587 from an ordinary network and never from the host. Port 443 is never
 * blocked.
 */

export type Attachment = { fileName: string; url: string; mimeType?: string };

export type SendInput = {
  from: { name: string; email: string };
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Our own Message-ID, so a reply threads back to the right conversation. */
  messageId?: string;
  headers?: Record<string, string>;
  attachments?: Attachment[];
};

export type SendResult = { sent: boolean; error?: string };

export function isSendConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY);
}

export async function sendMail(input: SendInput): Promise<SendResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return { sent: false, error: 'Sending is not connected. Add a Brevo API key in Setup.' };
  }

  const headers: Record<string, string> = { ...(input.headers ?? {}) };
  // Brevo honours a supplied Message-Id, which keeps threading exact rather
  // than leaning on the subject fallback.
  if (input.messageId) headers['Message-Id'] = input.messageId;

  const payload = {
    sender: input.from,
    to: input.to.map((email) => ({ email })),
    cc: input.cc?.length ? input.cc.map((email) => ({ email })) : undefined,
    bcc: input.bcc?.length ? input.bcc.map((email) => ({ email })) : undefined,
    subject: input.subject,
    htmlContent: input.html,
    textContent: input.text,
    replyTo: input.replyTo ? { email: input.replyTo } : undefined,
    headers: Object.keys(headers).length ? headers : undefined,
    // Brevo fetches each file itself, so nothing is buffered in this process.
    attachment: input.attachments?.length
      ? input.attachments.map((a) => ({ url: a.url, name: a.fileName }))
      : undefined,
  };

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return { sent: true };

    const body = await res.text().catch(() => '');
    if (res.status === 401) {
      return { sent: false, error: 'Brevo rejected the API key. Check it, and that IP restriction is off.' };
    }
    if (res.status === 400 && /sender/i.test(body)) {
      return {
        sent: false,
        error: 'Brevo will not send as this address. Authenticate the domain under Senders, domains, IPs.',
      };
    }
    return { sent: false, error: `Brevo ${res.status}: ${body.slice(0, 300)}` };
  } catch (e) {
    return { sent: false, error: `Could not reach Brevo: ${(e as Error).message}` };
  }
}

/** Confirms the key works without sending anything. */
export async function verifySending(): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, error: 'No Brevo API key set.' };
  try {
    const res = await fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? { ok: true } : { ok: false, error: `Brevo rejected the key (${res.status}).` };
  } catch (e) {
    return { ok: false, error: `Could not reach Brevo: ${(e as Error).message}` };
  }
}
