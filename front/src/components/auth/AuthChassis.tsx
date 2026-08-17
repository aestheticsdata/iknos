import { ROUTES } from "@lib/routes";
import { AUTH_TEXT } from "@text/auth";
import Link from "next/link";

export type AuthPage = "login" | "register" | "recover" | "about";

/**
 * The width of the card, per page — the mockup's own three.
 *
 * Register is wider because it is the only screen with paired fields; about is wider than login
 * because its second column is an address. Sizing them all to the widest would leave the sign-in
 * form — the screen used every day, by one person, forever — with two hands' width of empty card.
 */
const CARD_WIDTH: Record<AuthPage, string> = {
  login: "w-[420px]",
  register: "w-[520px]",
  recover: "w-[420px]",
  about: "w-[480px]",
};

const COPY: Record<AuthPage, { kicker: string; title: string }> = {
  login: AUTH_TEXT.login,
  register: AUTH_TEXT.register,
  recover: AUTH_TEXT.recover,
  about: AUTH_TEXT.about,
};

/**
 * The shell all four auth screens share — §5.7.
 *
 * A server component with no state of its own: the backdrop, the chrome bar and the footer are the
 * same on every page, and the only thing that varies is which form is in the card. That keeps the
 * client bundle on `/login` down to the form itself.
 */
export const AuthChassis = ({ page, children }: { page: AuthPage; children: React.ReactNode }) => {
  const { kicker, title } = COPY[page];
  const onAbout = page === "about";

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-chassis-deep font-mono">
      {/*
       * The backdrop: two washes and the wordmark, bled off the bottom-left corner.
       *
       * `pointer-events-none` because the wordmark is 208px tall and overlaps the card on a short
       * viewport — without it, a click that lands on a letter instead of the input does nothing and
       * feels broken. `select-none` for the same reason a drag-select of the word is never wanted.
       */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden select-none"
      >
        <div className="absolute inset-0 bg-[radial-gradient(760px_520px_at_50%_42%,rgba(134,185,154,0.10),rgba(16,21,28,0)_68%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(900px_600px_at_88%_96%,rgba(127,168,196,0.07),rgba(16,21,28,0)_70%)]" />
        <div className="absolute bottom-[34px] left-6 text-[208px] leading-[0.8] font-bold tracking-[0.04em] whitespace-nowrap text-transparent [-webkit-text-stroke:1.5px_rgba(143,169,154,0.11)]">
          IKNOS
        </div>
      </div>

      <header className="relative flex h-[38px] flex-none items-center gap-3.5 border-b border-chassis-raised bg-chassis-surface/80 px-3.5">
        <span className="text-ui font-bold tracking-[0.14em] text-chassis-text">IKNOS</span>
        <span className="text-row tracking-chrome text-chassis-text-dim">
          {onAbout ? AUTH_TEXT.chrome.crumbAbout : AUTH_TEXT.chrome.crumb}
        </span>
        <span className="flex-1" />
        <span className="text-row tracking-control text-chassis-text-dim">{AUTH_TEXT.chrome.host}</span>
        {/*
         * The liveness dot is decorative here and nowhere else in the product.
         *
         * On this page nothing has been fetched yet, so it cannot report anything: it says "the
         * front is being served", which the presence of the page already said. It earns its keep in
         * the top bar, where it is wired to the collector's lag.
         */}
        <span
          aria-hidden
          className="size-[7px] animate-pulse-live rounded-full bg-chassis-accent"
        />
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center py-10">
        <div className={`flex flex-col ${CARD_WIDTH[page]} max-w-[calc(100vw-2rem)]`}>
          <div className="mb-[7px] text-kicker tracking-[0.18em] text-chassis-text-dim">{kicker}</div>
          <h1 className="mb-5 text-title font-bold tracking-[-0.01em] text-chassis-text-bright">{title}</h1>

          <div className="rounded-overlay border border-chassis-border bg-chassis-surface/95 px-[22px] py-5 shadow-overlay backdrop-blur-[3px]">
            {children}
          </div>

          <p className="mt-4 text-row/[1.75] text-chassis-border-focus">{AUTH_TEXT.tagline}</p>

          <div className="mt-3 flex items-center gap-4">
            <Link
              className="text-label tracking-control text-chassis-accent/70 hover:text-chassis-text"
              href={onAbout ? ROUTES.login : ROUTES.about}
            >
              {onAbout ? AUTH_TEXT.aboutBack : AUTH_TEXT.aboutLink}
            </Link>
            <span className="text-micro text-chassis-border-strong">{AUTH_TEXT.posture}</span>
          </div>
        </div>
      </div>
    </main>
  );
};
