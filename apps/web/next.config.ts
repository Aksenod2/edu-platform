import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@platform/db', '@platform/shared', '@platform/ui'],
  async redirects() {
    return [{ source: '/promo', destination: '/', permanent: true }];
  },
  async rewrites() {
    // /files/* → API. На проде это перехватывает Caddy (handle /files/*), здесь —
    // в основном для локального dev (Caddy нет): same-origin /files форвардим в API.
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    return {
      beforeFiles: [{ source: '/', destination: '/promo.html' }],
      afterFiles: [{ source: '/files/:path*', destination: `${apiUrl}/files/:path*` }],
      fallback: [],
    };
  },
};

export default nextConfig;
