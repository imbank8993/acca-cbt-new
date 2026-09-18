import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['mammoth', 'pdfjs-dist', 'docx', 'jszip', 'openai', 'mathjax-full'],
  typescript: {
    ignoreBuildErrors: false,
  },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: 'img.youtube.com' },
      // Cloudflare R2 — satu-satunya penyimpanan berkas.
      //
      // `*.r2.dev` adalah domain publik bawaan bucket. PERINGATAN: sebagian ISP
      // Indonesia (mis. XL Axiata) memblokir seluruh zona r2.dev di tingkat DNS,
      // jadi berkas yang disajikan dari sana tidak terbuka di jaringan peserta.
      // Solusinya memasang custom domain pada bucket lalu mengarahkan
      // CLOUDFLARE_R2_PUBLIC_URL ke sana — `*.icgowa.sch.id` sudah disiapkan.
      { protocol: 'https', hostname: '*.r2.dev' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
      { protocol: 'https', hostname: 'icgowa.sch.id' },
      { protocol: 'https', hostname: '*.icgowa.sch.id' },
      { protocol: 'https', hostname: '**.googleusercontent.com' },
      { protocol: 'https', hostname: '**.amazonaws.com' },
      { protocol: 'https', hostname: '**.cloudinary.com' },
      { protocol: 'https', hostname: '**.imgix.net' },
    ],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
