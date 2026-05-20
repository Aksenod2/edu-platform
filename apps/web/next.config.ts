import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@platform/db', '@platform/ui'],
};

export default nextConfig;
