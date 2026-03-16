import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Configure server-side packages for NSE API routes
  serverExternalPackages: [
    'node-fetch',
    'tough-cookie',
    'fetch-cookie'
  ],
  
  // Disable edge middleware - use Node.js for all server-side operations
  skipMiddlewareUrlNormalize: true,
};

export default nextConfig;
