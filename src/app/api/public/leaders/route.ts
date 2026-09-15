import { searchPublicLeaders } from '@/server/modules/public/participants.service';
import { publicJsonRoute } from '@/server/next/public-route';

/** GET /api/public/leaders?q=name — leaders who accept new members (first name + initial only). */
export const GET = publicJsonRoute(async ({ request, db, req }) => ({
  leaders: await searchPublicLeaders(db, req, request.nextUrl.searchParams.get('q') ?? ''),
}));
