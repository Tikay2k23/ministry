'use server';

import { z } from 'zod';
import { confirmTotpSetup, startTotpSetup } from '@/server/modules/iam/two-factor.service';
import { runAction } from '@/server/next/action';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { parseInput } from '@/server/validation';

export async function startSetupAction() {
  const { user } = await requirePortal();
  return runAction(async () => {
    const setup = await startTotpSetup(getDb(), { id: user.id, email: user.email });
    // Rendered as an <img> data URL on the client (no innerHTML).
    return {
      qrDataUrl: `data:image/svg+xml;base64,${Buffer.from(setup.qrSvg).toString('base64')}`,
      manualKey: setup.manualKey,
    };
  });
}

const ConfirmInput = z.object({ code: z.string().trim().min(6, 'Enter the 6-digit code').max(8) });

export async function confirmSetupAction(code: string) {
  const { ctx, user, sessionId } = await requirePortal();
  return runAction(async () => {
    const input = parseInput(ConfirmInput, { code });
    return confirmTotpSetup(getDb(), ctx, { userId: user.id, sessionId, code: input.code });
  });
}
