import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '문장정원',
    short_name: '문장정원',
    description: '필수 회화 문장을 회상하고 반복 평가하는 학습 앱',
    start_url: '/today',
    scope: '/',
    display: 'standalone',
    background_color: '#fffefa',
    theme_color: '#1f5f57',
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
