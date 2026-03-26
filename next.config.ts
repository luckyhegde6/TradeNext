import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Configure server-side packages for NSE API routes
  serverExternalPackages: [
    'node-fetch',
    'tough-cookie',
    'fetch-cookie'
  ],
  // Ensure proper headers for production
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
