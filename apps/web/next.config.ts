import type { NextConfig } from 'next';

const apiDestination = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@platform/db', '@platform/ui'],
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/api-proxy/:path*',
          destination: `${apiDestination}/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
