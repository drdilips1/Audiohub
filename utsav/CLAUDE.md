# Utsav — notes for AI coding sessions

Utsav ("Every feeling deserves a beautiful expression") is an Indian greeting-card app:
AI-written and AI-designed cards in 12 Indian languages, an occasion calendar with
reminders, and one-tap sharing to WhatsApp. Preact + Vite, packaged for Android with
Capacitor 8. It lives in `utsav/` inside the Audiohub repo for now and is a separate app
from AudioYam: its own `package.json`, tests and workflow (`.github/workflows/utsav-android.yml`).

## Before you finish any change (run inside `utsav/`)
1. `npm test` passes (Vitest, `tests/`). Don't delete or loosen a test to make it pass.
2. `npm run lint` shows no problems.
3. `npm run build` succeeds.
4. Pushing anything under `utsav/` builds an APK artifact in GitHub Actions. Nothing is published.

## Layout
- `src/lib/occasions.js` — every occasion (festivals, regional, faith, relationship days, life events, daily). Custom occasions come from the user's own words. Moon-based festival dates are per year and marked approximate; add next year's dates here.
- `src/lib/relations.js` — "Who are you wishing?" and the voice each relationship gets.
- `src/lib/languages.js` — 12 languages, fonts per script (Baloo 2 family for display), Urdu is right-to-left.
- `src/lib/messages.js` — built-in words when AI is off. English and Hindi are complete; other languages cover the big occasions plus a general wish. Needs native-speaker review.
- `src/lib/design.js` — card specs as data: themes, palettes, motif zones, `sanitizeSpec` (repairs AI output, enforces readable contrast).
- `src/lib/motifs.js` + `render.js` — draws every card on a canvas (diya, rangoli, toran, kolam, pookalam, rakhi…). No image files.
- `src/lib/intent.js` — reads "birthday card for my elder sister, emotional" offline.
- `src/lib/compose.js` — request → card specs (offline or from AI).
- `src/lib/aiPrompt.js` — the AI prompt and JSON schema, shared with `server/utsav-ai` (`npm run server:sync`).
- `src/lib/ai.js` — AI paths: Utsav AI server (`VITE_AI_URL`), the user's own key, or the claude.ai preview.
- `src/lib/calendar.js` — upcoming dates, nth-weekday days, reminders. `reminders.js` schedules Android notifications.
- `src/screens/` — Home, Explore, Create, Results, Editor, Occasions, MyCards, Settings, Welcome.

## Must not change
- `localStorage` prefix `utsav:` and the Android `appId` `app.utsav.greetings` (changing them loses users' data or breaks updates).

## Conventions
Plain JavaScript and JSX, comments say *why* in plain English. Pure logic goes in `src/lib/` with a test.
