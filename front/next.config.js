/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  reactCompiler: true,
  trailingSlash: true,
  turbopack: {
    root: __dirname,
  },
  /**
   * The front does not own `/` yet.
   *
   * nginx keeps the static mock there until the app chassis exists (IKN-5's second half), and
   * routes only the auth paths here. Landing on the front's own root is therefore a mistake — a
   * hand-typed URL, or a bookmark from a later version — and the only page that means anything
   * today is the sign-in screen.
   */
  async redirects() {
    return [{ source: "/", destination: "/login/", permanent: false }];
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
