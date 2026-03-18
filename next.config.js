/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '110mb',
    },
    serverComponentsExternalPackages: ['ffmpeg-static'],
  },
};

module.exports = nextConfig;
