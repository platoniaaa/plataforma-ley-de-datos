import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Las evidencias ya no viajan por Server Actions: el navegador las sube directo a
  // Supabase Storage con una URL firmada (ver EvidenciasPregunta). Por eso no hace
  // falta subir bodySizeLimit — y hacerlo era inútil, porque la plataforma rechaza
  // igual los cuerpos de petición sobre ~4,5 MB.
};

export default nextConfig;
