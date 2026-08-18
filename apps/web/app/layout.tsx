import type { Metadata, Viewport } from 'next';
import { Lora, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '../providers/AuthProvider';
import { DatabaseProvider } from '../providers/DatabaseProvider';
import { ThemeProvider } from '../providers/ThemeProvider';
import { Sidebar } from '../components/Sidebar';
import { THEME_SCRIPT } from '../lib/theme';
import { FONT_SCRIPT } from '../lib/font';

const lora = Lora({ subsets: ['latin'], variable: '--font-lora', display: 'swap' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: 'Zettelkasten',
  description: 'Sua base de conhecimento pessoal',
  applicationName: 'Zettelkasten',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Zettelkasten',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${lora.variable} ${jetbrainsMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT + FONT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <ThemeProvider>
          <AuthProvider>
            <DatabaseProvider>
              <div className="lg:flex lg:h-screen">
                <Sidebar />
                <main className="flex-1 lg:overflow-y-auto lg:h-screen">
                  {children}
                </main>
              </div>
            </DatabaseProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
