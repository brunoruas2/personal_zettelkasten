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
        newsreader: ['var(--font-newsreader)', 'Georgia', 'serif'],
        geist: ['var(--font-geist)', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: 'rgb(var(--color-brand) / <alpha-value>)',
        'brand-light': 'rgb(var(--color-brand-light) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};

export default config;
