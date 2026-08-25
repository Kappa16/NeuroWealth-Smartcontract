/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@stellar/stellar-sdk', '@stellar/freighter-api'],
};

module.exports = nextConfig;
