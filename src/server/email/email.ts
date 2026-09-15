import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getEnv } from '../env';

/**
 * Minimal email abstraction used by authentication (magic links, invitations).
 * The provider-agnostic notification framework (docs/02 §6) builds on this in M2.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/** Development only: prints the message (including magic links) to the server log. */
class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    const line = '─'.repeat(72);
    console.info(`\n${line}\n✉  To: ${message.to}\n   Subject: ${message.subject}\n${line}\n${message.text}\n${line}\n`);
  }
}

/** End-to-end tests: writes each message as a JSON file into EMAIL_OUTBOX_DIR, where the test finds the link. */
class FileEmailProvider implements EmailProvider {
  constructor(private readonly directory: string) {}

  async send(message: EmailMessage): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, `${Date.now()}-${randomUUID()}.json`);
    await writeFile(file, JSON.stringify({ ...message, sentAt: new Date().toISOString() }, null, 2));
  }
}

class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: message.to, subject: message.subject, text: message.text, html: message.html }),
    });
    if (!response.ok) throw new Error(`Email provider rejected the message (HTTP ${response.status}).`);
  }
}

let provider: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (provider) return provider;
  const env = getEnv();
  provider =
    env.EMAIL_PROVIDER === 'resend'
      ? new ResendEmailProvider(env.EMAIL_API_KEY!, env.EMAIL_FROM)
      : env.EMAIL_PROVIDER === 'file'
        ? new FileEmailProvider(env.EMAIL_OUTBOX_DIR)
        : new ConsoleEmailProvider();
  return provider;
}

/** Test hook. */
export function setEmailProvider(custom: EmailProvider | undefined): void {
  provider = custom;
}
