import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './providers/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  // Escuro pelo sistema (como antes) OU forçado por um ancestral `.dark` — é o
  // que deixa os painéis de Configurações/Tags/Passkeys escuros dentro dos
  // modais da galáxia sem reescrevê-los. `:where()` não soma especificidade:
  // as regras `dark:` competem com `hover:` etc. exatamente como no `media`.
  darkMode: ['variant', ['@media (prefers-color-scheme: dark) { & }', '&:where(.dark, .dark *)']],
  theme: {
    extend: {
      fontFamily: {
        newsreader: ['var(--font-vt323)', 'ui-monospace', 'monospace'],
        geist: ['var(--font-vt323)', 'ui-monospace', 'monospace'],
        vt323: ['var(--font-vt323)', 'ui-monospace', 'monospace'],
        plex: ['var(--font-vt323)', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Tema ZK//OS (valores espelhados em app/zkos.css).
        zk: {
          bg: '#05070d',
          panel: '#070b14',
          inset: '#04060b',
          line: '#1b4a57',
          text: '#cfe9ee',
          dim: '#7fb0c0',
          cyan: '#19f2ff',
          magenta: '#ff2bd6',
          pink: '#ff4de0',
          amber: '#ffb000',
          green: '#39ff88',
        },
        brand: 'rgb(var(--color-brand) / <alpha-value>)',
        'brand-light': 'rgb(var(--color-brand-light) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};

export default config;
