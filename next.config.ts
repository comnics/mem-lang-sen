import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', '[::1]'],
  poweredByHeader: false,
  serverExternalPackages: ['pg'],
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          ...securityHeaders,
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      { source: '/:path*', headers: securityHeaders },
    ];
  },
};

export default nextConfig;
