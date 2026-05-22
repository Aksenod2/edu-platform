import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@platform/db', '@platform/ui'],
  async rewrites() {
    return [{ source: '/promo', destination: '/promo.html' }];
  },
};

export default nextConfig;
