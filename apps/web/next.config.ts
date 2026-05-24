import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@platform/db', '@platform/shared', '@platform/ui'],
  async redirects() {
    return [{ source: '/promo', destination: '/', permanent: true }];
  },
  async rewrites() {
    return {
      beforeFiles: [{ source: '/', destination: '/promo.html' }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
