import { magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Browser-side Better Auth client (portal sign-in / sign-out only). */
export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});
