# Audiohub — Frequently Asked Questions

A practical guide collected while building and using Audiohub: how the pieces fit together, how to set each one up, and what to do when something doesn't work.

**Contents**

1. [General](#1-general)
2. [Installing and updating](#2-installing-and-updating)
3. [Audiobookshelf (your own server)](#3-audiobookshelf-your-own-server)
4. [Reaching your server from anywhere (Tailscale)](#4-reaching-your-server-from-anywhere-tailscale)
5. [TorBox and Real-Debrid](#5-torbox-and-real-debrid)
6. [Home server: qBittorrent](#6-home-server-qbittorrent)
7. [Source add-ons and trackers (at your own risk)](#7-source-add-ons-and-trackers-at-your-own-risk)
8. [Ratings](#8-ratings)
9. [Recommendations and "Your verdict"](#9-recommendations-and-your-verdict)
10. [AI features](#10-ai-features)
11. [Ebooks, read-aloud and Kindle](#11-ebooks-read-aloud-and-kindle)
12. [The player](#12-the-player)
13. [Podcasts](#13-podcasts)
14. [Account and cloud sync](#14-account-and-cloud-sync)
15. [The web app (iPhone, iPad, Mac, PC) and the relay](#15-the-web-app-iphone-ipad-mac-pc-and-the-relay)
16. [Privacy](#16-privacy)
17. [Building your own copy](#17-building-your-own-copy)
18. [Quick troubleshooting table](#18-quick-troubleshooting-table)

---

## 1. General

**What is Audiohub?**
An audiobook, ebook and podcast app. It plays your own collection — from your Audiobookshelf server, your TorBox / Real-Debrid cloud, or files on the phone — and adds discovery (genre pages, recommendations, ratings, an AI "bookseller"), an EPUB reader with natural read-aloud voices, and a polished player.

**Is it free?**
Yes, and open source (MIT). Some services it connects to have their own terms: debrid services are paid, AI keys from Groq/OpenRouter have free tiers, Supabase and Cloudflare have free tiers.

**Android or web — which should I use?**
- **Android app** — the full experience: background playback with lock-screen controls, offline downloads, read-aloud that keeps going with the screen off, sleep detection, the in-app tracker browser, sending to qBittorrent, in-app updates.
- **Web app** — for iPhone, iPad and computers. Browse, play, read and discover, but browsers limit a few things (see [section 15](#15-the-web-app-iphone-ipad-mac-pc-and-the-relay)).

**Does it come with any books or sources?**
No. Audiohub ships with no content, no torrent sources and no trackers. You connect your own server and services.

---

## 2. Installing and updating

**How do I install the Android app?**
Download the latest `Audiohub-v….apk` from the [Releases](../../releases) page, open it, and allow "Install unknown apps" for your browser or file manager when Android asks.

**"App not installed" / "package conflicts with an existing package" — why?**
The new APK is signed with a different key from the one on your phone. Android only installs updates signed with the same key. Uninstall the old one first (your server progress is safe; local settings are lost unless you use sync or Settings → Data → backup). If you build your own copy, add a permanent signing key (see [section 17](#17-building-your-own-copy)) so this only happens once.

**How do updates work?**
The app checks for a newer release and offers to download and install it. Updates install over the old version as long as both are signed with the same key.

**Can two copies be installed side by side?**
Yes, if they have different application IDs (set in `android/app/build.gradle` and `capacitor.config.json`). Forks should change the ID so they never replace someone else's install.

---

## 3. Audiobookshelf (your own server)

**How do I connect?**
Settings → Audiobookshelf → enter the server address and sign in with your username and password, or with an API key (Audiobookshelf → Settings → API Keys). Then pick your **Library** (and optionally an **Ebooks library**).

**Which address do I type?**
- At home: the server's local address, e.g. `http://192.168.1.20:13378` (use your server's real port).
- From anywhere: a Tailscale address — see [section 4](#4-reaching-your-server-from-anywhere-tailscale).

**What is the "second address"?**
Add both a home address and a Tailscale address. Audiohub uses whichever answers, and switches automatically when one stops working — **even mid-book**: if playback fails or stalls for about 12 seconds, it moves to the other address and carries on from the same second.

**"Recently added" is empty or says the library has no books.**
- Open Settings → Audiobookshelf and make sure the **Library** is your audiobook library (Audiobookshelf treats ebook libraries as "book" libraries too, so the wrong one can be picked). The message names the library and address it checked.
- In the web app, see the next questions — the usual cause there is an `http://` address or a missing `ALLOW_CORS`.

**Does listening progress sync with Audiobookshelf?**
Yes, both ways. Progress you make in Audiohub shows in Audiobookshelf and other players (e.g. Absorb), and vice versa.

**Do I need to change anything on the server?**
For the Android app, no. For the **web app**, start Audiobookshelf with `ALLOW_CORS=1` so browsers are allowed to read it, e.g. if you run it from source:
```
cd ~/audiobookshelf-server && ALLOW_CORS=1 npm start
```
(Docker: add the environment variable `ALLOW_CORS=1`.)

**Starting the server fails with `EADDRINUSE … address already in use`.**
An older copy is still running on that port. Stop it (macOS/Linux, replace 3333 with your port):
```
lsof -ti :3333 | xargs kill
```
Check with `lsof -ti :3333` (prints nothing when free); force with `lsof -ti :3333 | xargs kill -9` if needed. Then start it again.

---

## 4. Reaching your server from anywhere (Tailscale)

**What is Tailscale and why use it?**
A free private network between your own devices. Your server stays off the public internet, but your phone can reach it from anywhere.

**Which Tailscale address should I use?**
| Address | When it works |
|---|---|
| `http://100.x.y.z:PORT` (the server's Tailscale IP) | Anywhere with Tailscale on; simplest and most reliable |
| `https://<machine>.<tailnet>.ts.net` (MagicDNS + HTTPS) | Anywhere with Tailscale on; **required for the web app** (browsers need https) |

**How do I get the https address?**
On the server, once:
```
tailscale serve --bg <PORT>
```
(on macOS: `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg <PORT>`). Use your Audiobookshelf's **actual port** — a wrong port is the most common mistake. Check with `tailscale serve status`; turn it off with `tailscale serve --https=443 off`. Enable **MagicDNS** and **HTTPS certificates** in the Tailscale admin console → DNS. The first visit can take a minute while the certificate is issued.

**The `…ts.net` name doesn't work in some app, but the `100.x` IP does.**
That's a DNS issue on that device. Use the `100.x.y.z` address there, or in the Tailscale admin console → DNS add a public nameserver (e.g. Cloudflare) and enable "Override local DNS".

**Things stop working when I'm away from home.**
Tailscale is probably off on the phone. To keep it on: Android Settings → Connections → More connection settings → VPN → ⚙ next to Tailscale → **Always-on VPN**. It does no harm at home — Audiohub prefers your home address when it answers.

**The browser shows "Not secure" for my server.**
That's just because the address is `http://`. Use the Tailscale `https://…ts.net` address to get a padlock.

---

## 5. TorBox and Real-Debrid

**What do they do in Audiohub?**
Paste your API key (Settings → TorBox / Real-Debrid) and Audiohub lists the audiobooks and ebooks already in your cloud, streams them, and can download them for offline listening. You can also add a magnet or link from Settings.

**It says the book is "still downloading".**
The service hasn't finished fetching it. Audiohub shows its progress and starts playing by itself when it's ready.

**Why does a download link never expire mid-book?**
Links are requested just before each part plays.

**The TorBox row on Home used to load last.**
Home now shows your last list immediately and refreshes it in the background. Pull down to force a fresh list (e.g. right after adding something elsewhere).

**Can I send ebooks from TorBox to my Audiobookshelf?**
Ebooks stay in the cloud by default; you can read them in the app or send them to Kindle. Audiobooks can be forwarded to your home server (next section).

---

## 6. Home server: qBittorrent

**What is this for?**
If your Audiobookshelf library lives on a computer running qBittorrent, Audiohub can send torrents there so books land straight in your library folder.

**How do I set it up?**
Settings → Home server (qBittorrent):
- **Home address** (e.g. `http://192.168.1.20:8080`) and/or **Away address** (Tailscale). The app uses the home one when it answers.
- **Web UI username/password**, or an **API key** (qBittorrent 5.2+, starts with `qbt_`).
- **Save to**: your Audiobookshelf audiobook folder, e.g. `/audiobooks`.
- **Ebooks to**: a separate folder for ebook torrents (default: an `ebooks` folder next to the audiobook folder), so ebooks don't clutter the audiobook library.
- **Category** (optional).
Tap **Save & test**.

**What does "Send new cloud audiobooks automatically" do?**
When you add a book to TorBox / Real-Debrid in the app (or open the app and something new appeared in your cloud), its magnet is also sent to qBittorrent. It skips:
- ebooks (they stay in the cloud),
- anything already sent,
- **books already on your Audiobookshelf** (checked against your whole library, including titles like "Author - Title (2021)"). If your server can't be reached to check, it waits and retries rather than risk a duplicate.

**It says "couldn't reach qBittorrent — is Tailscale on…?"**
You're away from home and Tailscale is off (or the away address is wrong). Turn Tailscale on and tap **Check now**; failed sends are retried automatically.

**"Clear list" — items came back.**
Fixed: cleared items stay cleared, across devices too. The list only shows items this app sent.

---

## 7. Source add-ons and trackers (at your own risk)

> **Audiohub ships with no sources and no trackers.** What you add, and what you download through it, is your choice and your responsibility. Respect copyright, your tracker's rules, and the laws where you live.

**What are source add-ons?**
Small JSON definitions (hosted anywhere, e.g. a gist) that tell Audiohub how to search a site. Add them in Settings → Addons, and reorder or switch them off in Settings → Sources. Results appear on book pages under "Sources". Only install add-ons you trust.

**Why do some results say "loose matches"?**
Results that don't clearly match the book (title words and the author's name) are hidden behind "Show N loose matches", so the list isn't full of other books with similar titles.

**A source "timed out".**
That site didn't answer within 20 seconds; the others still show. It's retried next time. The error is a short plain-language line, not a failure of the whole page.

**What is the tracker setting?**
Settings → Tracker: add the tracker site you use (e.g. `www.example.net`), and optionally a search link (`…?q={q}`) plus a second, **filtered** search link with its own label (for example a "freeleech/VIP only" search, if your tracker offers one). Book pages then show a small round badge next to "Sources" with your filtered search and **All**, searching the book's title and author.

**How do tracker downloads reach my server?**
The tracker opens inside Audiohub's browser (sign in once; pinch to zoom works). When **you** tap a download (.torrent or magnet), the app sends it to your qBittorrent — ebooks to the ebooks folder. A strip at the bottom shows what happened.

**Can Audiohub download from my tracker automatically?**
No, deliberately. Automating a private tracker usually breaks its rules and can get your account banned. Downloads happen only when you tap them.

**Which filters should I use to prefer certain formats or free downloads?**
That's done on the tracker site itself: set your filters/sort order there (e.g. by format such as M4B → M4A → MP3), then save that search as the filtered search link in Settings → Tracker. The badge will open it for any book.

---

## 8. Ratings

**Where do ratings come from?**
**Goodreads** (its public search suggestions): tiles show e.g. ★ 4.4 (250k), book pages show the Goodreads badge — tap it to open the book's Goodreads page. The book page also shows Audie / AudioFile Earphones awards when the description mentions them.

**Why does a book show no rating?**
Its page says why, e.g. *"No rating found — Goodreads: not found"* (the title isn't on Goodreads or is spelled very differently) or *"HTTP …/timed out"* (Goodreads didn't answer; it retries automatically). Titles with extras like "Author - Title" or authors like "Author/Narrator" are cleaned up before searching.

**Why not Audible ratings?**
They were tried; lookups were unreliable from some regions and could hold up the others, so ratings use Goodreads only. (Recommendations still use Audible's public catalogue.)

---

## 9. Recommendations and "Your verdict"

**How do I teach Audiohub my taste?**
On any book page, **Your verdict**: ❤️ Loved it · 👍 Liked it · 😐 It's OK · 👎 Not for me · 🚫 Didn't finish. Optionally rate the **Story** and the **Narration** (Great / OK / Weak), and for books that didn't work, pick reasons (Narration, Too slow, Too long…). Verdicts sync across devices.

**What uses my verdicts?**
- Genre pages → **For you**, and the Home banner, are ranked by how well each book fits: authors, narrators and genres you liked (from your verdicts and from what you finished, are listening to and saved).
- Each pick shows a **match %** and a **"why this pick"** line.
- Books you already have, have heard or have rated are left out.
- A **quality gate** holds back poorly rated titles, poorly narrated ones, and narrators you marked Weak.
- The AI bookseller is told what you loved, disliked and why.

**What are the length chips?**
"Any length · Under 5 h · 5–10 h · 10–20 h · 20 h +" on genre pages — pick how long a listen you're after.

---

## 10. AI features

**Is the AI free?**
Yes with a free key: **Groq** (fastest, most generous) or **OpenRouter** (free Llama/DeepSeek/Qwen models). No card needed. Add it in Settings → AI.

**What does it do?**
- **Bookseller** — ask in plain words ("cosy mystery under 8 hours", "like Project Hail Mary but funnier"); results are matched to real listings. Answers are kept while the app is open.
- **Key ideas** — a summary with key ideas on book pages (for non-fiction). For lesser-known books it uses the publisher's description and says so.
- Without a key, the bookseller answers from the Audible catalogue instead.

**What is sent to the AI service?**
The request and a short list of book titles you own/rated (your "taste"). Nothing else.

---

## 11. Ebooks, read-aloud and Kindle

**Which ebooks can I read?**
EPUBs from your Audiobookshelf ebooks library, your cloud, or links — in the built-in reader (themes, fonts, table of contents, remembers your place).

**How does read-aloud work, and which voices are there?**
Tap Listen on an ebook or read-aloud in the reader. Voices (Settings → Voices):
- **Edge neural voices** — very natural; uses Microsoft's online speech service unofficially, for personal use.
- **On-device voices** (Sherpa/Piper) — download once, work offline.
- **Any TTS engine installed on the phone** (Google, Samsung…).
Read-aloud runs as a background service, so it keeps going with the screen off.

**Send to Kindle?**
Settings → Send to Kindle: add your `@kindle.com` address. On Android the ebook goes to the share sheet (Kindle app or email); approve your sending address in your Amazon account's "Approved Personal Document E-mail List". On the web, the EPUB downloads so you can upload it at amazon.com/sendtokindle.

---

## 12. The player

**Features?** Chapters, 0.5×–3× speed, skip intervals, bookmarks, lock-screen/notification controls, a live transcript (on-device speech recognition), and backgrounds: cover art, a living gradient, bundled wallpapers or your own photo (with a darkness slider).

**Sleep timer and sleep detection?**
The sleep timer fades out (or stops at the end of the chapter). **Sleep detection** watches the phone's motion sensor: if it lies still for the chosen time, playback fades out, pauses, and rewinds to where you stopped moving.

**After a phone call, playback didn't resume.**
Tap play; if the connection went stale during a long pause, the app reconnects at the same spot by itself.

---

## 13. Podcasts

Search and subscribe in the Podcasts tab, get new episodes, import/export OPML, and see your shows in Library → Podcasts. Episodes play in the same player.

---

## 14. Account and cloud sync

**What does sync do?**
Keeps your library, progress, bookmarks, verdicts, settings and (optionally) service keys the same on all your devices, through **your own** free Supabase project. Without it, everything stays on the device.

**How do I set it up?**
Create a free Supabase project, then either build the app with its URL and anon key in `.env.production` (see [section 17](#17-building-your-own-copy)) or enter them in Settings → Account & sync. Sign in with email/password or Google.

**"Sync failed: JWT expired".**
Your sign-in session expired. The app refreshes it automatically and retries; if it keeps failing, sign out and in again in Settings → Account & sync.

**A setting I changed keeps reverting.**
That was a sync ordering bug (an older copy winning); it's fixed. If you see it again, change the setting once more and wait a few seconds before closing the app.

**Is my data safe in Supabase?**
It's your own project, protected by row-level security (each user can only read their own row). Never put the `service_role` key or database password in the app — only the public anon key.

---

## 15. The web app (iPhone, iPad, Mac, PC) and the relay

**How do I install the web app on iPhone?**
Open it in Safari → Share → **Add to Home Screen**. It opens like an app and always runs the latest version.

**What is the relay and why is it needed?**
Browsers block web pages from reading some services directly (Audible listings, Goodreads, Hardcover, some debrid and add-on sites). The web app sends those requests through a tiny relay **you host yourself**. The Android app doesn't need it.

**Cloudflare Worker or Supabase function?**
Use a **Cloudflare Worker** (free). Supabase's gateway rejects the header-free requests Safari needs, so on iPhone/Safari a Supabase relay fails; Chrome works with either.

**How do I set up the Cloudflare relay?**
1. In the web app: Settings → Web app → *Set up or update the relay* → **Copy relay code** (or copy `relay/index.ts` from this repo).
2. dash.cloudflare.com → Workers & Pages → Create → Worker → name it → Deploy → **Edit code** → select all → paste → **Deploy**.
3. Copy the Worker's address (`https://<name>.<you>.workers.dev`), paste it into the relay box in Settings → Web app, press Enter, and tap **Check**. Each browser remembers its own relay address — do this once on each device.

**Cloudflare says "Unexpected end of input" or "Missing initializer".**
The paste was cut short, or old (Supabase-only) code was pasted. Copy the complete current code again (it ends with `export default { fetch: handle };`).

**Testing the Worker shows "Rate limit has been exceeded for itunes-apple-com".**
The Worker works — Apple rate-limits Cloudflare's shared addresses. The app's relay check uses another site. Podcast search through the relay may occasionally hit this limit.

**The relay check says "HTTP 404 (from Supabase, not the relay)".**
You're using the Supabase relay in Safari — switch to the Cloudflare Worker. If it says there's nothing at the address, the relay address in that browser is wrong: tap **Use built-in address** or paste the correct one.

**The page shows "did not match any documents".**
That's Google search: the address was typed into a search box or has a typo. Paste the full `https://…` address into the browser's address bar.

**Audiobookshelf doesn't work in the web app.**
Two requirements: an **https** address (browsers block `http://` from a secure page — use the Tailscale `https://…ts.net` address, and Tailscale must be on on that device), and Audiobookshelf started with **`ALLOW_CORS=1`**. The error message says which one is missing.

**What doesn't work on the web?**
Sending to qBittorrent, the in-app tracker browser, offline downloads, read-aloud with the screen off, sleep detection. Everything else works.

---

## 16. Privacy

- Audiohub has **no server of its own** and no analytics. It talks directly to the services you connect (and your own relay/sync if you set them up).
- Keys and passwords are stored on the device; with sync, in your own Supabase project.
- AI requests go to the AI provider whose key you added.
- The relay forwards only to an allow-list of services and stores nothing.

---

## 17. Building your own copy

**Build locally**
```
npm ci
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
```

**Build on GitHub** — fork the repo; the workflows in `.github/workflows/` build the APK on every push to `main` and publish a Release, and publish the web app to GitHub Pages (Settings → Pages → Source: *GitHub Actions*). The web workflow fails until Pages is switched on.

**Signing key (so updates install over each other)**
```
keytool -genkeypair -keystore audiohub.jks -alias inkwell -keyalg RSA -keysize 2048 -validity 10000 -storepass YOUR_PASSWORD -keypass YOUR_PASSWORD -dname "CN=Audiohub"
base64 -i audiohub.jks | tr -d '\n'
```
Add repository secrets `AUDIOHUB_KEYSTORE_BASE64` (the base64 text) and `AUDIOHUB_KEYSTORE_PASSWORD`. Keep the `.jks` file and password safe and **never commit them** — losing the key means users must uninstall to update.

**Sync server** — put your Supabase URL and anon key in `.env.production` (or leave empty for no sync).

**Your own app ID and update source** — change `applicationId` (`android/app/build.gradle`), `appId` (`capacitor.config.json`), and `REPO` / `PAGES` in `src/components/update.jsx` so your copy updates from your repo and installs alongside others.

---

## 18. Quick troubleshooting table

| Symptom | Likely cause | Fix |
|---|---|---|
| "App not installed" | Different signing key | Uninstall the old app, then install |
| Nothing from my server when away | Tailscale off on the phone | Turn it on; set Always-on VPN |
| `…ts.net` fails, `100.x` works | DNS on that device | Use the `100.x` address, or fix DNS in Tailscale admin |
| "Couldn't reach qBittorrent" | Away without Tailscale, or wrong away address | Turn Tailscale on → Check now |
| Book sent home twice | Old versions only | Current version checks your whole library first |
| Server won't start: EADDRINUSE | Old copy still running | `lsof -ti :PORT \| xargs kill` |
| Web: Audiobookshelf fails | http address or no ALLOW_CORS | Use `https://…ts.net`; start with `ALLOW_CORS=1` |
| Web: relay ✗ in Safari | Supabase relay | Use a Cloudflare Worker relay |
| No rating on a book | Not on Goodreads / didn't answer | See the reason line under the title |
| A source "timed out" | That site was slow | Others still show; retried next time |
| "Sync failed: JWT expired" | Session expired | Retries automatically; else sign in again |
| Genre page empty with a length chip | No books that long | Pick "Any length" |
