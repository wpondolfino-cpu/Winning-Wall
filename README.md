# 🏀 AHS Winning Wall — Setup Guide

Full-stack offseason basketball training platform with real auth, persistent data, live leaderboard via WebSockets, and automated push/email notifications.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Backend / Auth | Supabase (Postgres + Auth + Realtime) |
| Live Leaderboard | Supabase Realtime (WebSockets) |
| Push Notifications | OneSignal |
| Email Notifications | SendGrid |
| Scheduled Jobs | Supabase Edge Functions + pg_cron |
| Deployment | Vercel (frontend) + Supabase (backend) |

---

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Note your **Project URL** and **anon/public API key** (Settings → API)
3. Install the Supabase CLI: `npm install -g supabase`
4. Link your project: `supabase link --project-ref YOUR_PROJECT_ID`

---

## 2. Run the Database Migration

```bash
# From project root
supabase db push
```

This creates all tables, RLS policies, the leaderboard view, realtime publication, and the inactive_players view in one shot.

---

## 3. Configure Environment Variables

```bash
cp .env.example .env.local
# Fill in your Supabase URL and anon key
```

---

## 4. Install & Run Locally

```bash
npm install
npm run dev
# → http://localhost:5173
```

---

## 5. Enable Supabase Realtime

In Supabase Dashboard → Database → Replication:
- Enable `scores` table ✓
- Enable `workouts` table ✓

The `useLeaderboard` hook subscribes to `postgres_changes` on the `scores`
table. Every time any player logs a score, **all connected clients receive
a WebSocket message and immediately re-fetch the leaderboard** — no polling.

---

## 6. Deploy the Notification Edge Function

```bash
# Set secrets (server-side only, never in .env)
supabase secrets set SENDGRID_API_KEY=your_key
supabase secrets set ONE_SIGNAL_APP_ID=your_app_id
supabase secrets set ONE_SIGNAL_API_KEY=your_key

# Deploy the function
supabase functions deploy notify-inactive
```

### Schedule it to run nightly (pg_cron)

In Supabase SQL Editor:

```sql
select cron.schedule(
  'notify-inactive-players',
  '0 9 * * *',   -- 9:00 AM every day
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/notify-inactive',
    headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
  )
  $$
);
```

---

## 7. Set Up OneSignal (Push Notifications)

1. Create a free account at [onesignal.com](https://onesignal.com)
2. Create a new app → Web Push (for browser) or Mobile (for native app)
3. Add the OneSignal SDK to `index.html`:

```html
<script src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js" defer></script>
<script>
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  OneSignalDeferred.push(async function(OneSignal) {
    await OneSignal.init({ appId: "YOUR_APP_ID" });
    // Tag the player so Edge Function can target them
    OneSignal.User.addTag("player_id", currentUserId);
  });
</script>
```

---

## 8. Deploy Frontend to Vercel

```bash
npm install -g vercel
vercel
# Add env vars in Vercel dashboard → Settings → Environment Variables
```

---

## Architecture Overview

```
Browser A (Player logs score)
    │
    ▼
Supabase DB  ──► postgres_changes event
    │                    │
    │         ┌──────────┴──────────┐
    │         │   Realtime Server   │  (WebSocket)
    │         └──────────┬──────────┘
    │                    │
    │         ┌──────────▼──────────┐
    │         │  Browser B, C, D…   │  ← all see updated leaderboard instantly
    │         └─────────────────────┘
    │
    └─► pg_cron (nightly) ──► Edge Function ──► SendGrid + OneSignal
                                                (inactive players only)
```

---

## File Structure

```
ahs-winning-wall/
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql     ← all tables, RLS, realtime, views
│   └── functions/
│       └── notify-inactive/
│           └── index.ts               ← nightly email + push sender
├── src/
│   ├── lib/
│   │   └── supabase.ts                ← client, types, all DB helpers
│   ├── hooks/
│   │   ├── useAuth.ts                 ← session management
│   │   ├── useLeaderboard.ts          ← WebSocket live leaderboard
│   │   └── useWorkouts.ts             ← live workout list
│   ├── pages/
│   │   └── LoginPage.tsx              ← sign in + sign up
│   ├── components/
│   │   ├── Leaderboard.tsx            ← shared by players + coaches
│   │   ├── WorkoutsPanel.tsx          ← player view (watch ↗, log score)
│   │   ├── CoachPanel.tsx             ← coach view (embed video, preview)
│   │   ├── ProgressPanel.tsx          ← player history + stats
│   │   └── PlayersPanel.tsx           ← coach roster view
│   └── App.tsx                        ← main shell + routing
├── .env.example
├── package.json
└── README.md
```

---

## Role Permissions Summary

| Feature | Player | Coach |
|---|---|---|
| View workouts | ✅ | ✅ |
| Watch video (YouTube tab) | ✅ | ✅ |
| Embed/preview video inline | ❌ | ✅ |
| Log scores | ✅ | ❌ |
| View leaderboard | ✅ | ✅ |
| View own progress history | ✅ | — |
| Post new workouts | ❌ | ✅ |
| View all player data | ❌ | ✅ |
| Trigger notifications | ❌ | Auto (Edge Fn) |

All permissions are enforced **both** in the UI and at the database level via Postgres Row Level Security — so even a savvy user bypassing the UI cannot write data they're not allowed to.
