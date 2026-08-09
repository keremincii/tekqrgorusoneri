/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker/VPS için bağımsız (standalone) çıktı: .next/standalone içinde
  // node_modules olmadan `node server.js` ile çalışan minimal bir sunucu üretir.
  output: 'standalone',
  // Framework parmak izini gizle: 'X-Powered-By: Next.js' başlığını gönderme.
  poweredByHeader: false,
  // Trace kökünü bu projeye sabitle; aksi halde üst klasörde (monorepo sezimi)
  // başka bir package.json varsa standalone çıktısı bir alt klasöre yuvalanır.
  outputFileTracingRoot: import.meta.dirname,
  experimental: {
    // Proxy katmanının istek gövdesini belleğe tamponlama üst sınırı (varsayılan 10MB).
    // Fotoğraf yükleme uygulama limiti 15MB; 18MB ile proxy buffer'ına güvenli pay bırakırız.
    proxyClientMaxBodySize: '18mb',
  },
};

export default nextConfig;
