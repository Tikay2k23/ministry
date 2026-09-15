import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { E2E_OUTBOX_DIR } from './e2e-env';

/** An email written by EMAIL_PROVIDER=file (src/server/email/email.ts). */
export interface OutboxMessage {
  to: string;
  subject: string;
  text: string;
  sentAt: string;
}

async function readOutbox(): Promise<OutboxMessage[]> {
  const files = await readdir(E2E_OUTBOX_DIR).catch(() => [] as string[]);
  return Promise.all(
    files.filter((file) => file.endsWith('.json')).map(async (file) => JSON.parse(await readFile(path.join(E2E_OUTBOX_DIR, file), 'utf8')) as OutboxMessage),
  );
}

/** Waits for the newest email to `to` sent at or after `since`. */
export async function waitForEmail(to: string, since: Date): Promise<OutboxMessage> {
  let found: OutboxMessage | undefined;
  await expect
    .poll(
      async () => {
        const messages = await readOutbox();
        found = messages
          .filter((message) => message.to.toLowerCase() === to.toLowerCase() && new Date(message.sentAt) >= since)
          .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
        return found !== undefined;
      },
      { message: `an email to ${to}`, timeout: 20_000 },
    )
    .toBe(true);
  return found!;
}

export function firstLink(text: string): string {
  const match = /https?:\/\/[^\s<>"]+/.exec(text);
  if (!match) throw new Error('The email has no link.');
  return match[0];
}
