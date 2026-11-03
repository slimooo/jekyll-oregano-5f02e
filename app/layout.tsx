import type { Metadata, Viewport } from 'next';
import './globals.css';
import Nav from '@/components/Nav';

export const metadata: Metadata = {
  title: 'Valeur Fondamentale',
  description: 'Faut-il acheter cette action ? Analyse fondamentale selon les critères de Warren Buffett et Benjamin Graham.',
  appleWebApp: { capable: true, title: 'Valeur', statusBarStyle: 'default' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#2456d6' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <main className="wrap">{children}</main>
        <Nav />
      </body>
    </html>
  );
}
