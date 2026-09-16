import type { MetadataRoute } from 'next';

/**
 * /robots.txt: nothing here is for search engines. The portal is private, and public journal and
 * prayer pages are reached through QR codes and personal links, never through search.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
