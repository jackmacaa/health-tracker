# Health Tracker (Supabase, Vite + React)

Mobile-first personal eating tracker. Single-user auth via Supabase. View entries on desktop and other devices. Filters: Today, This Week (Mon), This Month.

## Setup

1. Create a Supabase project. Enable Email auth. Create your user (email/password).
2. In Supabase SQL editor, run the schema in `supabase/schema.sql`.
3. Copy your Project URL and anon key; set env vars locally:

```powershell
# Windows PowerShell at project root
Copy-Item .env.example .env.local
notepad .env.local  # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
```

## Run (LAN dev)

```powershell
npm install
npm run dev -- --host --port 5173
```

- Find your PC IP with `ipconfig`. Visit `http://<your-ip>:5173` on your phone (same Wi‑Fi).

## Build & Preview

```powershell
npm run build
npm run preview -- --host
```

## Deploy

- Netlify/Vercel: build `npm run build`, publish `dist`, set env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## New fitness pages

- Weight Tracker: daily weight (kg to 0.1), steps, calories; unique per day with edit/overwrite.
- Leaderboard: hard-coded challenge window; set VITE_CHALLENGE_ID to your challenge id in Supabase.
- Apply the updated supabase/schema.sql (profiles, challenges, challenge_members, daily_metrics) before using these pages.

## Notes

- Times are stored as UTC with `tz_offset_minutes` to preserve original local time.
- Week starts on Monday.
