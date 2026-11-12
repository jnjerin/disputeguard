/**
 * PURPOSE
 * Next.js configuration for the DisputeGuard dashboard.
 * - `serverExternalPackages` keeps Prisma out of the server bundle (it ships native engines).
 * - `typedRoutes` is off to keep the build fast on a low-memory laptop.
 */
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "prisma"],
  // Evidence uploads (images/PDFs) go through server actions; allow a few MB.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
