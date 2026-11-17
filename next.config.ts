import type { NextConfig } from 'next';

const config: NextConfig = {
  experimental: { cpus: 1 },
  poweredByHeader: false,

  // Add only explicitly trusted development origins for your own environment.

  serverExternalPackages: ['@prisma/client', 'bcryptjs'],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'Referrer-Policy',
            value: 'same-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()'
          }
        ]
      }
    ];
  }
};

export default config;