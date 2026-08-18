import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Zettelkasten',
    short_name: 'Zettelkasten',
    description: 'Sua base de conhecimento pessoal',
    start_url: '/',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#7C3AED',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
