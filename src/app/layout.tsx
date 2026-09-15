import type { Metadata, Viewport } from 'next';
import { Inter, Nunito } from 'next/font/google';
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${nunito.variable}`}>
      <body>{children}</body>
    </html>
  );
}
