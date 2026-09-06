# Demo films

One Playwright run that drives the monitor the way a hand would, records it as a single continuous
video, and writes the chapter list beside it. No editing: the take *is* the video, and the chapter
file is what goes in the description.

```bash
pnpm video:generate
```

Output lands in `e2e/demo/out/` (gitignored):

- `iknos-demo.mp4` — the take, h264, at the exact viewport size, no scaling, with the chapters
  written into the file itself
- `chapters.txt` — `0:00 Title` per line, for a human to read
- `chapters.vtt` — WebVTT, for `<track kind="chapters">` on the portfolio's own `<video>`
- `chapters.ffmeta` — ffmpeg metadata; already applied to the mp4, kept so a re-encode can reapply it
- `chapters.json` — the same marks with millisecond precision
- `shots/01-logs.png` and four more — stills at 3840×2160, for a page that wants pictures too

This is a port of Zeus's harness, which is a port of Spira's. `pacing.ts`, `recorder.ts`,
`chapters.ts` and `cursor.ts` are byte-identical to Zeus's; `fixture.ts`, `preflight.ts`,
`demo.setup.ts` and `playwright.demo.config.ts` are the same files with the Iknos-specific parts
changed. The full write-up of how it works and why — the CDP screencast, the drawn pointer, the
encode, and every trap found building it — is
[`HOW-TO-FILM-A-DEMO.md`](/Users/cosmokaat/dev/spira/front/e2e/demo/HOW-TO-FILM-A-DEMO.md) in the
Spira repo, and Zeus's `e2e/demo/README.md` carries the traps that console found. Only
`iknos.demo.ts` knows what Iknos is.

## What it needs before it will record

`preflight.ts` refuses to launch a browser until the first three are true, and names whichever one
is not. The rest it cannot check.

1. **The front on `localhost:3006`, and it must be the production build**, built with the two
   variables below — `pnpm dev` floats overlays over the page that `hideDevChrome()` does not know
   about, and a build without the variables cannot reach the API from a laptop at all:

   ```bash
   cd front && NEXT_PUBLIC_IKNOS_HOST_LABEL=web01 IKNOS_API_ORIGIN=http://127.0.0.1:4310 pnpm build
   IKNOS_API_ORIGIN=http://127.0.0.1:4310 pnpm start
   ```

   `IKNOS_API_ORIGIN` turns on the `/api/*` rewrite in a production build (`next.config.js`) —
   on ks-b nginx does that routing and the rewrite must stay off. `NEXT_PUBLIC_IKNOS_HOST_LABEL`
   is the name in the top bar: the production copy says `ks-b`, and a film of the invented fleet
   must not. Both are read at build time, so **rebuild after changing either** — and rebuild
   before filming anyway: `pnpm start` serves whatever `.next` already holds.
2. **The Nest API on `127.0.0.1:4310`** — `cd nest-api && pnpm dev`. Its `/health` lives outside
   `/api`, which is what preflight probes.
3. **`DEMO_USERNAME` / `DEMO_PASSWORD` in `front/.env.test.local`** — the house dev account,
   `local.dev@mock.io`. Copy `.env.test.local.example` beside it. Never a real credential: the video
   is for a public page.
4. **ffmpeg on `PATH`** with libx264, the mp4 muxer and the `concat` demuxer — `brew install ffmpeg`,
   or `DEMO_FFMPEG` pointing at one.
5. **The mock corpus and the fake fleet, loaded** — see below.

`settle()` in `fixture.ts` adds one more check on the real page: every stylesheet the document
asked for has loaded and `document.fonts.ready` has resolved before a frame is kept. Iknos serves
its fonts through `next/font`, so it never fires here; it is kept because the four harnesses are
copies of each other.

## The corpus, and what it must never contain

The take films the invented fleet from IKN-67 — the nineteen services of `nest-api/mock/profiles.ts`,
named after the house fleet every project's mock shares (`atlas-api`, `beacon-api`, `cinder-front`,
`dovetail-api`, `ember-front`, `fathom-api`, `gale-front`, `harbor-api`, `ivory-api`, `juniper`,
`keystone-api`…), on a host called `web01`, with documentation addresses and `example.net`
upstreams. **No real project name, machine name, IP, upstream or path appears anywhere in it**, and
that is the precondition for putting the result on a public page.

⚠️ **This was got wrong once.** The first Iknos take was filmed against a corpus generated from the
production registry, so the real fleet was on screen in every frame and every still, and the
sentence that excused it — "the service names are the real apps and are inherent to the product" —
was exactly the rationalisation that must never be accepted. The loader now seeds the dev registry
from `profiles.ts` and removes every registry row outside the mock fleet, so `pnpm mock` cannot put
the production seed on camera. Before a take is called done, grep the corpus, the stills' DOM and
the chrome for the real names; a hit is a defect whatever the reason it is there.

In `nest-api/`, in this order:

```bash
pnpm mock        # loads the seven-day corpus, re-anchored on now; seeds the mock registry
pnpm mock:fleet  # nineteen fake processes under their own pm2 daemon — the live half
```

The fleet keeps writing under the camera, and the running API groups its error lines into issues
by the same fingerprint the corpus was authored with. That is why the loader **upserts** issues by
fingerprint rather than creating them: between its reset and its insert the collector can already
have re-created `beacon-api`'s `FetchError` issue from a live line, and a plain create died on
`issue_fingerprint_key`. The corpus wins on every scalar; the live row's events stay beside it.

⚠️ **A fingerprint is a function of the error template.** `pnpm mock:author` recomputes them, and
the storyboard's `ISSUE` constant is one of them — re-author the corpus and the constant is stale.
`author.ts` prints the digest of the beacon `FetchError` issue; copy it into `iknos.demo.ts`.

## The take

Five chapters, **143.0s — two minutes twenty-three**, at the default `DEMO_SPEED=1`.

| | |
|---|---|
| 0:00 The fleet at a glance | the rail hovered, the week's histogram swept bucket by bucket and its anomaly marker read, a bucket pinned and unpinned, the range switched to 24h and back, the stream scrolled, then ⌘K and `beacon` typed — the one thing the take types outside a field |
| 0:36 One service | `beacon-api`'s header chips and health pills read, the four signal tiles and the charts under three of them swept, the runtime tile's two meters |
| 1:10 A line, its detail, its trace | the recurring `FetchError` line opened, its detail read, its trace opened and walked |
| 1:29 Issues | the grouped issue, its 49 events, its detail modal |
| 1:55 Alerts | the `health_down` rule's card, its state band, its modal |

`beacon-api` is the through-line: a 5xx burst four days back, a Redis outage and a restart three
hours back, `restarts 7` on its chip, the 49-count `FetchError` issue and the one critical alert
whose state band has transitions.

## The stills

`demo.shot("name")` marks five screens. It takes no picture at the time — it writes down the URL,
and the pictures are taken at the very end, once the recorder has stopped and the mp4 is closed, by
sending the same signed-in page back to each URL. They come out at 3840×2160, lossless PNG,
animations frozen, caret hidden, the harness's overlays painted out.

Since TRE-148, `shot(name, prepare?)` also takes a step to run on the revisited page before the
shutter — open a modal, type into the palette, pick files — for a still that a URL alone cannot
reach. It drives the real page with plain Playwright, never the drawn pointer, and must be
repeatable and must not write. Trekker uses it for six of its stills; the other harness copies
carry the same `fixture.ts` so a storyboard here can too.

## Running it again

**The take writes nothing** — no resolve, ignore, reopen, acknowledge, silence, no filter removed,
nothing copied, nobody signed out — which is why there is no `arrange.ts` beside this file. The
dangerous keys are global: ⌘⇧L signs out, ⌘C copies the selected row. Nothing is typed outside the
palette's input.

⚠️ **The one real cost: Iknos keeps ONE live session per account.** The setup project's sign-in
revokes every other one, so your own Iknos tab is signed out the moment a take starts, and a
sign-in of yours mid-take bounces the filmed page to `/login/?expired=1`.

Nothing that moves is asserted. Every timestamp, every `N ago`, the recency dots, the collector
pill, the rail sparklines, the health pills, the runtime tile and the status bar's `q Nms` are live.
Waits are on a message, a trace, a fingerprint, a rule title.

## Iknos-specific traps

**Every dialog is a native `<dialog>` on the top layer**, opened with `showModal()`, and six of
them are mounted CLOSED on every route with their last content latched. A closed one is still in
the DOM, so a modal is only ever addressed as `dialog[open][data-testid="…"]`, and Escape — which
the browser handles natively, innermost first — is how each one closes. The drawn pointer is a
manual popover re-promoted onto the top layer for the same reason: a plain fixed div is painted
under every open dialog.

**Some marks exist only when they have something to say.** `tile-header` renders only while a tile
has a hint (the p95 tile before its reference lands, and the runtime tile without a heap total,
render bare); `ip-copy` is absent on error lines. The storyboard checks the count and hovers the
tile itself when the header is not there, so a take never waits on a bubble that was never coming.

**The first `FetchError` row is not always a corpus row.** The fleet writes the same message live,
without a trace. The storyboard filters the line it opens with `{ has: log-trace }`.

**An alert card shows the rule's expression, not its title.** Address it by `[data-rule="…"]`.

**The screencast used to open on ten white frames.** The recorder starts over `about:blank`, and
whether that blank frame is ever seen depends on how fast the app's first paint follows it — Zeus
opened on its ground, Iknos on 0.17s of white. `Demo.open` now rebases the film and the chapter
clock to the instant the first navigation settles (`CdpRecorder.rebase`), so every take opens on
a painted page. The fix is in all four harness copies.

## Knobs

The same as Zeus's, all environment variables: `DEMO_SPEED`, `DEMO_HEADED=1`, `DEMO_WIDTH` /
`DEMO_HEIGHT`, `DEMO_SCALE=1`, `DEMO_TITLES=on`, `DEMO_CURSOR=off`, `DEMO_FPS`, `DEMO_CRF`,
`DEMO_FFMPEG`, `DEMO_RECORDER=playwright`, `E2E_BASE_URL` (default `http://localhost:3006`).

## What this run actually measured

On an 8-core M1, at 1920×1080 with the default 2× supersampling.

| | |
|---|---|
| The take | 143.0s, 5 chapters, **8494 frames at 59.4fps** — the live fleet repaints something every frame, so this console reaches the screencast's ceiling where Zeus sat at ~20fps |
| The file | **14.3 MB** (14,310,024 bytes), h264, 1920×1080, chapters inside it |
| Stills | 5 × 3840×2160 PNG, 222–760 KB each, 2.7 MB the set |
| Repeatability | the previous run of the same storyboard came out at 149.1s; the chapter marks moved by the ~6s the clock rebase removed from the front of the film, not by drift |

## What this ticket changed outside the harness

- `next.config.js`: the `/api/*` rewrite is on in development and, in any other build, only when
  `IKNOS_API_ORIGIN` is set — a laptop production build could not reach the API before.
- `TopBar.tsx`: the host label reads `NEXT_PUBLIC_IKNOS_HOST_LABEL` before the production copy.
- `nest-api/mock/load.ts`: seeds the registry from `profiles.ts` (never `prisma/seed.ts`), removes
  registry rows outside the mock fleet, and upserts issues by fingerprint.
- `nest-api/mock/profiles.ts`, `author.ts`, `fleet.ts`, `logs/`: the corpus re-authored on the
  invented fleet and `web01`.
- ~170 `data-testid`s across `src/components/`, with the `ui/` primitives spreading their rest
  props so an attribute handed to them lands on the element.
