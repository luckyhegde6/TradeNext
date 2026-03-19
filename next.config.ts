import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Configure server-side packages for NSE API routes
  serverExternalPackages: [
    'node-fetch',
    'tough-cookie',
    'fetch-cookie'
  ],
};

export default nextConfig;
