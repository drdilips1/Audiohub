# AudioYam — notes for AI coding sessions

AudioYam (formerly Audiohub, earlier Inkwell) is an audiobook, ebook and podcast player.
Preact + Vite, packaged for Android with Capacitor 8, also published as a web app on GitHub
Pages (listen.audiohubapp.com). One person builds it, mostly with AI help, so **these notes
and the tests are the project's memory**. Read this before changing anything.

## Before you finish any change

1. `npm test` must pass (Vitest, `tests/`). Don't delete, skip or loosen a test to make it pass.
   If a test is truly wrong, say so and explain why before changing it.
2. `npm run lint` must show no problems (it catches names that don't exist and unused code).
3. `npx vite build` must succeed.
4. If you changed a rule listed under "Behaviour that must not regress", add or update a test.
5. Pushing to `main` **publishes**: the web app deploys and an Android release goes out to
   everyone's in-app updater. `test` only builds an APK to try. Never push to `main` unless asked.

## Layout

- `src/app.jsx`, `src/main.jsx` — app shell and entry.
- `src/screens/` — one file per screen (`Book.jsx`, `Settings.jsx`, `Home.jsx`, …).
- `src/components/` — shared UI pieces and sheets.
- `src/lib/` — logic. Key files:
  - `player.js` — the global player: tracks, resume, switching copies, the safety net that
    plays another copy when one fails, phone-copy-first, Audiobookshelf session sync.
  - `place.js` — pure arithmetic for your place in a book (part lengths, the same point in
    another copy, the server's place). **Tested.**
  - `match.js` — title/author matching, phone-copy matching, Audible copycat ordering. **Tested.**
  - `works.js` — one book, many copies: grouping and which copy opens. **Tested.**
  - `store.js` — tiny reactive store persisted to `localStorage`.
  - `ai.js` — AI providers (user brings their own key, stored on their device).
- `src/sources/` — every place books come from (`audiobookshelf.js`, `debrid.js` for
  TorBox / Real-Debrid, `local.js` for phone folders, `catalogs.js` for Audible / Google
  Books, …). `index.js` is the registry (`SOURCES`).
- `relay/index.ts` — Supabase Edge Function that forwards requests browsers block (CORS).
- `android/` — Capacitor Android project, including native plugins.
- `.github/workflows/` — `web.yml` (Pages) and `android.yml` (APK + release).

## Behaviour that must not regress

These have each been fixed more than once. Most are covered by tests in `tests/`.

- **Phone copy first, only when resuming.** Continue, the mini player and Library resume
  from the copy in the phone's folders when it exists and its file is still there. Tapping a
  specific copy on the book page or in sources plays *that* copy (`exact`). Phone match:
  title or folder name *starts with* the book's main title (an author name in front is
  allowed) and the author fits — "12 Rules for Life An Antidote to Chaos" yes,
  "Beyond Order: 12 More Rules for Life" no. (`samePhoneBook`, `phoneCopy`)
- **Switching copies keeps your place.** Same length → same time. Different length (another
  edition) → the same *percent*, never past the end (max 99.5%). Lengths not known yet →
  pick the part by file sizes, else as equal parts. (`copyPlace`, `partByPercent`)
- **A copy the app switched to that ends at once is not "finished"** and doesn't start Up next.
- **The server's place** is used only when it's newer, and scaled only when lengths are within
  6%; otherwise it's another edition and ignored. (`fitted`)
- **Audible copycats** (unrated, another author, borrowing a rated book's title) sit below the
  real book; the real author's own unrated editions and new releases keep their place.
  (`sinkCopycats`)
- **A cover the user chose is never replaced** by an automatic cover.
- **Fallback when the server is slow/down:** after ~6 s a copy ready in TorBox / Real-Debrid
  is raced against it; the fallback never searches by a title that is just the author's name.

## Things you must not rename

The app was renamed twice; user data and installs depend on the old names staying:

- `localStorage` keys use the `inkwell:` prefix (`store.js`). Changing it wipes everyone's
  library, progress and settings.
- Android `appId` `app.audiohub.player`, native plugin names like `InkwellDownloads`, and the
  `Downloads/Audiohub` folder. Changing them breaks updates or loses downloads.
- `package.json` `name` is `audiohub`; leave it.

## Conventions

- Plain JavaScript (ES modules) and JSX with Preact; no TypeScript in `src/`.
- Comments and UI text are written in plain, user-facing English and say *why*, often with a
  real example ("Rich Dad, Poor Dad" matches "Kiyosaki - Rich Dad Poor Dad (2017) [MP3]").
  Keep that style.
- Commit messages describe the change from the listener's point of view.
- User-visible changes go in `src/components/whats-new.jsx`: add a card and change `EDITION`
  so everyone sees it once.
- Put new pure logic (no player state, no network) in a small module under `src/lib/` and
  test it, rather than inline in `player.js` or a screen.
- Prefer changing existing code over adding another special case next to it. If a fix needs
  a new branch, check whether an older one is now dead and remove it.
- No secrets in the repo. `.env.*` files are empty templates; AI keys are entered by the user.
