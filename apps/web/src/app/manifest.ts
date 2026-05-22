import type { MetadataRoute } from 'next';

// Web App Manifest (Next 15 metadata route → /manifest.webmanifest)
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'OCHOBA — платформа',
    short_name: 'OCHOBA',
    description: 'Платформа для обмена заданиями и обратной связью',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    lang: 'ru',
    dir: 'ltr',
    theme_color: '#ffffff',
    background_color: '#ffffff',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icon-192-maskable.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
