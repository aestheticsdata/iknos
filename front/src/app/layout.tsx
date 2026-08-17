import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";

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
};

export const viewport: Viewport = {
  // One colour, not a pair: the chassis is dark on every screen and does not follow the system.
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
    <body>{children}</body>
  </html>
);

export default RootLayout;
