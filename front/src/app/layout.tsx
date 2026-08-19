import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import type { Metadata, Viewport } from "next";

import "@styles/globals.css";

/**
 * Everything that is data or chrome — §3.3. On the auth screens that is all of it.
 *
 * `next/font` self-hosts the files at build time, which is what lets the eventual CSP name no font
 * CDN at all. A self-hosted monitor whose login screen calls Google is a poor advertisement for
 * itself.
 */
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

/** Card titles and prose only. IBM Plex Mono is in the mockup's font list and used nowhere — dropped. */
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Iknos",
  description: "A self-hosted monitor for the apps on ks-b",
  // A single-admin monitor for one VPS has no business in an index.
  robots: { index: false, follow: false },
  /*
   * IKN-33. Every file here is rasterised from `public/icons/favicon.svg` by `pnpm icons`; none of
   * them is drawn.
   *
   * `favicon.ico` sits next to this file and is not listed: Next special-cases that one name and
   * emits its tag whatever this field says. The 512 does not get that treatment — declaring any
   * `icon` here suppresses the file convention's own `<link>`, so an `src/app/icon.png` would
   * become a route nothing points at. It is served from `public/` and named, like the SVG, which
   * has no convention at all and which every browser that understands it prefers to the `.ico`.
   *
   * `mask-icon` is Safari's pinned tab: a monochrome glyph macOS paints in the colour given here.
   */
  icons: {
    icon: [
      { url: "/icons/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    other: [{ rel: "mask-icon", url: "/icons/safari-pinned-tab.svg", color: "#86b99a" }],
  },
  manifest: "/icons/site.webmanifest",
};

export const viewport: Viewport = {
  // One colour, not a pair: the chassis is dark on every screen and does not follow the system.
  //
  // One of the three hexes in the codebase outside `styles/tokens/` — the other two are the
  // pinned-tab colour above and the manifest's, and all three are literals for the same reason.
  // Next serialises this into a `<meta>` tag at build time, so `var(--color-chassis-deep)` here is
  // not a colour, it is a string the browser discards. It must be kept equal to that token, which
  // is why it is written in the same lowercase form the token file uses: a grep for the value
  // finds both — and finds `site.webmanifest`, whose `theme_color` has to agree with this one or
  // the installed app and the browser tab disagree about what colour Iknos is.
  themeColor: "#10151c",
};

const RootLayout = ({ children }: { children: React.ReactNode }) => (
  /*
   * The font variables go on <html>, not <body> — copied from Zeus, and not a style preference.
   *
   * Tailwind emits `--font-mono: var(--font-jetbrains-mono), …` on `:root`. next/font declares
   * `--font-jetbrains-mono` on whatever element carries `.variable`. Put that class on <body> and
   * the two live on different elements: at `:root` there is no `--font-jetbrains-mono`, so
   * `--font-mono` resolves to an invalid value and `font-family` falls all the way back to the UA
   * default — a serif. Zeus rendered its whole console in Times before this was understood.
   */
  <html
    className={`${jetbrainsMono.variable} ${ibmPlexSans.variable}`}
    lang="en"
  >
    <body>
      {/*
       * The chassis keeps the selected service and the time range in the query string, and nuqs
       * needs its adapter above every hook that reads them. Mounted at the root rather than in the
       * app group so that a future auth screen with URL state does not have to remember it.
       */}
      <NuqsAdapter>{children}</NuqsAdapter>
    </body>
  </html>
);

export default RootLayout;
