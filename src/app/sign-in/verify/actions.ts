'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { verifySecondFactor } from '@/server/modules/iam/two-factor.service';
import { runAction } from '@/server/next/action';
import { getPortalContext } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { parseInput } from '@/server/validation';
import type { Result } from '@/server/errors';

const Input = z.object({ code: z.string().trim().min(6, 'Enter the 6-digit code').max(12) });

export async function verifyCodeAction(_prev: Result<null> | null, formData: FormData): Promise<Result<null>> {
  const portal = await getPortalContext();
  if (!portal) redirect('/sign-in');

  const result = await runAction(async () => {
    const { code } = parseInput(Input, { code: formData.get('code') });
    await verifySecondFactor(getDb(), portal.ctx, { userId: portal.user.id, sessionId: portal.sessionId, code });
    return null;
  });
  if (result.ok) redirect('/app');
  return result;
}
