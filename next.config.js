/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    turbo: {}
  },
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  }
};

module.exports = nextConfig;