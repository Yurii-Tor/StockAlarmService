/**
 * Outbound email.
 *
 * Phase 1 needs this only for magic-link sign-in. Phase 7 builds the full
 * NotificationChannel abstraction (spec §H.2) on top of the same Resend
 * transport; this port is deliberately narrow until then.
 *
 * Workers cannot open SMTP sockets, so the transport is an HTTP API (ADR-0006).
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/**
 * Development fallback. Writes the message to the log instead of sending.
 *
 * This exists so sign-in works locally with no API key, and it is chosen
 * ONLY when RESEND_API_KEY is absent -- never as a silent fallback when a
 * real send fails, which would hide a broken login flow.
 */
export class ConsoleMailer implements Mailer {
  readonly name = 'console';

  async send(message: EmailMessage): Promise<void> {
    console.log(
      `[email:console] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`,
    );
  }
}

export class ResendMailer implements Mailer {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });

    if (!response.ok) {
      // Fail loudly. A swallowed error here means users cannot sign in and
      // nothing in the system says so.
      const body = await response.text().catch(() => '<unreadable>');
      throw new Error(`Resend rejected the message (${response.status}): ${body}`);
    }
  }
}

export function createMailer(env: {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}): Mailer {
  if (env.RESEND_API_KEY) {
    return new ResendMailer(
      env.RESEND_API_KEY,
      env.EMAIL_FROM ?? 'StockAlarm <noreply@stockalarm.torproduction.com>',
    );
  }
  return new ConsoleMailer();
}
