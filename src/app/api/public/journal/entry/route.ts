import { z } from 'zod';
import { AppError } from '@/server/errors';
import { getOwnEntryForEdit } from '@/server/modules/journal/journal-submit.service';
import { publicJsonRoute } from '@/server/next/public-route';

/** GET /api/public/journal/entry?date=YYYY-MM-DD — your own answers, to edit before the deadline. */
export const GET = publicJsonRoute(async ({ request, db, req, requireIdentity }) => {
  const identity = await requireIdentity();
  const date = z.iso.date().safeParse(request.nextUrl.searchParams.get('date'));
  if (!date.success) throw new AppError('VALIDATION_ERROR', 'Please reload the page and try again.');
  const answers = await getOwnEntryForEdit(db, identity, date.data, req.now);
  if (!answers) throw new AppError('INVALID_STATE', 'This journal can no longer be edited here.', { meta: { reason: 'EDIT_NOT_ALLOWED' } });
  return { journalDate: date.data, answers };
});
