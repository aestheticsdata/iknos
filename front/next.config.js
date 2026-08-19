/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  reactCompiler: true,
  trailingSlash: true,
  turbopack: {
    root: __dirname,
  },
  /**
   * In development only, `/api/*` is proxied to the Nest API so the browser sees one origin — which
   * is exactly what nginx does in production, and the reason the API needs no CORS configuration at
   * all. A cross-origin dev setup would mean shipping `credentials` support on a production server
   * to make a laptop work.
   *
   * `trailingSlash: true` still 308s `/api/auth/login` to `…/login/` on the way in, and the rewrite
   * is applied to the slashed path — which Express matches anyway, since strict routing is off. So
   * each dev API call costs one extra hop and works. `beforeFiles` keeps the rewrite ahead of the
   * filesystem; it does not, despite appearances, skip that redirect.
   */
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];

    // Keep in step with `src/lib/apiOrigin.ts`, which resolves the same thing for the server
    // components. This file cannot import it — `next.config.js` is CommonJS and loaded before the
    // TypeScript pipeline exists — so the development port is written out in both places.
    const api = process.env.IKNOS_API_ORIGIN ?? "http://127.0.0.1:4310";
    return { beforeFiles: [{ source: "/api/:path*", destination: `${api}/api/:path*` }] };
  },
  /**
   * No CSP here yet. It wants a per-request nonce to be worth anything, and a header declared in
   * this file is the same string on every response — Zeus moved its own out to a proxy for exactly
   * that reason. The four below are worth having unconditionally and cost nothing.
   */
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
