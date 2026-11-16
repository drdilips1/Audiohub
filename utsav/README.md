# Utsav — the Indian greeting studio

Describe the card you want ("Diwali greeting from our family, traditional but
sophisticated") and Utsav writes and designs it in your language, ready to send on WhatsApp.

- **Create:** AI cards (original design + words) in English, Hindi, Urdu, Punjabi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam and Odia. Works offline with built-in words and designs.
- **Any occasion:** 80+ listed (festivals, regional, faith, relationship days, work, life events, daily wishes) or type your own.
- **Who are you wishing?** The relationship and tone shape the message.
- **Remember:** add people's birthdays and anniversaries; get reminded before festivals and personal days.
- **Share:** WhatsApp Status (9:16), post (4:5) or square, with your family signature and photo.

## Run it
```
cd utsav
npm install
npm run dev        # web preview
npm test && npm run lint && npm run build
npm run android:sync   # then open utsav/android in Android Studio, or let GitHub Actions build the APK
```

## AI
- For testing: Settings → AI → paste an Anthropic API key (stored only on the phone).
- For launch: deploy `server/utsav-ai` (Supabase Edge Function, instructions at the top of `index.ts`) and set the repository variable `UTSAV_AI_URL`. The key then lives on the server and each phone gets a daily limit.

## APK
Every push that changes `utsav/` runs **Utsav APK** in GitHub Actions; download the APK from the run's artifacts. Add the secret `UTSAV_KEYSTORE_BASE64` (a base64 keystore) so builds install over each other.
