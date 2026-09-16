import type { Metadata, Viewport } from 'next';
import { Inter, Nunito } from 'next/font/google';
import { connection } from 'next/server';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const nunito = Nunito({ subsets: ['latin'], weight: ['700', '800'], variable: '--font-nunito', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'GenTouch Ministry System', template: '%s · GenTouch' },
  description: 'Generation Touch Harvest International — ministry management and accountability.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#1f5f24',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Every page is rendered per request, so its scripts get this request's CSP nonce (src/proxy.ts).
  // A page prerendered at build time would carry no nonce, and the browser would block its scripts.
  await connection();
  return (
    <html lang="en" className={`${inter.variable} ${nunito.variable}`}>
      <body>{children}</body>
    </html>
  );
}
