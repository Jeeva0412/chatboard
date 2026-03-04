# Ephemeral Chatboard

Realtime markdown chatboard built with SvelteKit, Tailwind CSS, Supabase, and Cloudflare Pages adapter.

## Stack

- SvelteKit + TypeScript
- Tailwind CSS (flat brutalist UI rules in `src/app.css`)
- Supabase (Broadcast + PostgreSQL)
- `marked` + `DOMPurify` (safe markdown rendering)
- Cloudflare adapter (`@sveltejs/adapter-cloudflare`)

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy env file and fill values:

```bash
cp .env.example .env
```

Required keys:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`

3. Start dev server:

```bash
npm run dev
```

## Supabase SQL setup

Run `supabase/schema.sql` in Supabase SQL editor. It creates:

- `public.chat_messages` table
- RLS policies for anonymous read and insert
- `enforce_message_cap()` trigger function
- `AFTER INSERT` trigger that retains only the newest 40 rows

## Realtime flow

On submit, the client:

1. Broadcasts message instantly to `chatboard-room` channel.
2. Renders incoming payload immediately on subscribers.
3. Inserts message asynchronously into `chat_messages`.

Initial page load fetches the most recent 40 rows from the table.

## Deployment

Project is configured for Cloudflare Pages builds via SvelteKit Cloudflare adapter.

```bash
npm run build
```
