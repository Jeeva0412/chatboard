# Chatboard

A small web chat app built with SvelteKit and Supabase.
You can send messages, see new messages quickly, and use basic Markdown in messages.

## What this project does

- Shows a shared chat page in the browser
- Loads the latest 40 messages from the database
- Sends new messages to other users through Supabase Realtime
- Saves each message in Supabase
- Keeps only the newest 40 messages in the table

## Tech used

- SvelteKit + TypeScript
- Tailwind CSS
- Supabase (database + realtime)
- `marked` + `DOMPurify` for safe Markdown output

## Before you start

You need:

- Node.js 18+
- A Supabase project

Set these environment variables:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`

## Run locally

1. Install packages:

```bash
npm install
```

2. Add your Supabase environment values.

3. Start the app:

```bash
npm run dev
```

4. Open the local URL shown in the terminal.

## Set up Supabase table

Run the SQL in `supabase/schema.sql` inside the Supabase SQL editor.

This script:

- creates `chat_messages` if it does not exist
- enables read and insert rules for anonymous users
- adds a trigger that removes old rows
- keeps only 40 newest messages

## Useful scripts

- `npm run dev` - start local development server
- `npm run build` - build for production
- `npm run preview` - preview the production build
- `npm run check` - type and Svelte checks

## Project structure

- `src/routes/+page.svelte` - main chat UI and realtime logic
- `src/lib/supabase.ts` - Supabase client setup
- `src/lib/markdown.ts` - Markdown parsing and sanitizing
- `supabase/schema.sql` - database table, policies, and message cap trigger

## Notes

- This app is client-rendered (`src/routes/+page.ts` sets `ssr = false`).
- Press `Ctrl + Enter` in the message box to send.
