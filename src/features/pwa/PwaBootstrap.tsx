'use client';

import { useEffect } from 'react';

export function PwaBootstrap() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => undefined);
  }, []);

  return null;
}
