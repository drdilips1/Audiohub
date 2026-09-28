# Audiohub

**An audiobook, ebook and podcast app for Android (and the web) that plays from your own
Audiobookshelf server and your own cloud storage — with smart recommendations, ratings,
read-aloud voices and a polished player.**

Built with Preact + Vite, packaged for Android with Capacitor 8.

📖 **New here? Read the [FAQ](FAQ.md)** — setup for Audiobookshelf, Tailscale, qBittorrent, debrid, sync and the web relay, plus troubleshooting.

---

## Features

**Your library, wherever it lives**
- **Audiobookshelf** — sign in with a password or API key, browse and stream your library, progress syncs both ways. Add a second address (e.g. Tailscale) and the app switches automatically — even mid-book, continuing from the same second.
- **TorBox / Real-Debrid** — browse and stream what's already in your cloud; links are fetched just before playback so they don't expire mid-book.
- **qBittorrent (home server)** — optionally forward new cloud audiobooks to your server, skipping books your Audiobookshelf already has; ebooks go to a separate folder.
- **Podcasts** — subscribe, search, OPML import/export, and a Podcasts tab in the library.
- **Hardcover** shelves and **Goodreads** export import.

**Discover**
- Genre pages with *For you*, *Bestsellers*, *Trending* and *Best of (year)* tabs, plus an "I have N hours" length filter.
- **Recommendations that learn your taste** — rate books (❤️ / 👍 / 😐 / 👎 / didn't finish, with story and narration scores); picks show a match % and a "why this pick" line, skip what you already have, and hold back poorly narrated titles.
- **AI bookseller** — ask in plain words ("atmospheric sci-fi under 12 hours like Project Hail Mary"). Works with a free Groq or OpenRouter key.
- **Key ideas** summaries on book pages (AI), and **Goodreads ratings** on every tile.

**Player**
- Background playback with lock-screen controls, chapters, 0.5×–3× speed, bookmarks, sleep timer (fade-out, end of chapter, and sleep detection).
- Player backgrounds: cover, living gradient, bundled wallpapers or your own photo.
- Live transcript (on-device speech recognition).

**Ebooks**
- EPUB reader with themes, Send to Kindle, and **read-aloud** with natural voices (Microsoft Edge neural voices, on-device Sherpa/Piper voices, or any installed TTS engine) that keeps going with the screen off.

**Looks**
- Dark, black and light modes, many accent palettes, dynamic colour from cover art.

**Optional: add-ons and trackers (at your own risk)**
- You can add **source add-ons** (your own search sources) and your own **tracker site** (the app opens it in a built-in browser and sends downloads you tap to your qBittorrent).
- Audiohub **ships with no sources or trackers**. What you add, and what you download through it, is your choice and your responsibility. Respect copyright, your tracker's rules, and the laws where you live.

---

## Install

Download the latest `Audiohub-v….apk` from **[Releases](../../releases)**, open it on your phone and allow "Install unknown apps" when asked.

The web version (for iPhone/iPad/desktop) is published on GitHub Pages by the *Web app* workflow.

---

## Build it yourself

```bash
npm ci
npm run build          # web app → dist/
npx cap sync android   # copy it into the Android project
cd android && ./gradlew assembleRelease
```

Or let GitHub Actions do it: every push to `main` runs **Android APK** (`.github/workflows/android.yml`), which builds a release APK and publishes it as a GitHub Release, and **Web app** (`.github/workflows/web.yml`), which publishes the web version on GitHub Pages (Settings → Pages → Source: *GitHub Actions*).

### Signing (so updates install over each other)

Without a key, each build is signed with a throwaway key and you'd have to uninstall before updating. Create your own once:

```bash
keytool -genkeypair -keystore audiohub.jks -alias inkwell -keyalg RSA -keysize 2048 -validity 10000 -storepass YOUR_PASSWORD -keypass YOUR_PASSWORD -dname "CN=Audiohub"
base64 -i audiohub.jks | tr -d '\n'   # copy the output
```

Then in your repository: **Settings → Secrets and variables → Actions** → add
- `AUDIOHUB_KEYSTORE_BASE64` — the base64 text
- `AUDIOHUB_KEYSTORE_PASSWORD` — your password

Never commit the `.jks` file.

### Optional: cloud sync (your own Supabase)

Account & sync (library, progress, settings across devices) uses a free [Supabase](https://supabase.com) project of your own. Put its URL and anon key in `.env.production`:

```
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

Leave them empty to use Audiohub without sync.

### Optional: web relay (for the web version)

Browsers block some services (Audible listings, Goodreads, Hardcover…). The web version sends those through a tiny relay you host yourself — the same code (`relay/index.ts`) runs as a **Cloudflare Worker** (recommended; works in Safari/iPhone) or a **Supabase Edge Function**. Steps are in the app under *Settings → Web app*. The Android app doesn't need it.

---

## Notes

- Read-aloud "Edge" voices use Microsoft's online speech service unofficially; for personal use.
- Ratings come from Goodreads' public search suggestions; recommendations use Audible's public catalogue.
- Not affiliated with Audiobookshelf, Audible, Goodreads, TorBox, Real-Debrid or any tracker.

## License

[MIT](LICENSE)
