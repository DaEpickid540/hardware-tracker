# Forge — Hardware Tracker

A Firebase web app for cataloging electronics components, organizing them by
build, and asking an AI assistant (**ARIA**) exactly what parts you need.

Red + gray minimal cyberpunk theme. Vanilla JS + ES modules, no build step.

## Features

- **Categories → subcategories** — hardware types in the sidebar (ESP32,
  Raspberry Pi, 18650, …), each expandable into nested subcategories
  (e.g. ESP32 → ESP32-C3 / ESP32-S3). Add your own with custom icons.
- **Groups** — top-level containers for categories (e.g. "Boards" holding ESP32
  + Pi 5). Managed from the **Groups box at the bottom of the sidebar**, which
  opens a modal to create/rename/delete groups and pick one as the active filter.
- **Options (items)** — add components to a category/subcategory as cards with
  info, a link, and a photo.
- **Classes** — project workspaces (e.g. "Drone v2", "Lantern"). Switch the
  active class at the top of the sidebar, *or* pick "All Classes" and filter the
  grid with class chips. Every item belongs to one class + one category.
- **Pinning** — pin frequently-used components to the top of the grid.
- **Search** — across names, notes, and links.
- **ARIA AI** — top-right button opens a chat panel under the grid. Ask
  "what do I need to wire an 18650 pack to an ESP32" and it answers with a parts
  list. It's given your current inventory as context, so it knows what you own.
  Multi-provider: **Claude (Anthropic) · OpenAI · Gemini · Groq** — pick one in Settings
  and paste that provider's API key. Key + chat history are stored per-user in
  Firestore so you can sign in anywhere.

## Layout

```
┌──────────┬────────────────────────────────────────────┐
│          │  [ search…………………………… ]      [ ARIA ▸ ]      │
│  Class ▾ │  ┌────────┐ ┌────────┐ ┌────────┐            │
│          │  │ Option │ │ Option │ │ Option │            │
│ Categories│ │ info…  │ │ info…  │ │ info…  │            │
│  ESP32   │  └────────┘ └────────┘ └────────┘            │
│  18650   │  ┌────────┐ ┌────────┐ ┌──+ Add─┐            │
│  …       │  └────────┘ └────────┘ └────────┘            │
│  Settings│  ── ARIA panel (expands here when opened) ── │
└──────────┴────────────────────────────────────────────┘
```

## Setup

1. **Create a Firebase project** at <https://console.firebase.google.com>.
2. **Add a Web App** (`</>`), copy the config, and paste it into
   [`public/js/firebase-config.js`](public/js/firebase-config.js).
3. **Enable Google sign-in**: Authentication → Sign-in method → Google → enable.
4. **Create Firestore**: Build → Firestore Database → create (production mode).
5. **Publish the security rules** in [`firestore.rules`](firestore.rules)
   (paste into the Rules tab, or `firebase deploy --only firestore:rules`).
6. Put your project id in [`.firebaserc`](.firebaserc).

### Run locally

Any static server works (ES modules need `http://`, not `file://`):

```bash
cd public
python -m http.server 5000
# open http://localhost:5000
```

Or with the Firebase CLI: `firebase emulators:start` / `firebase serve`.

### Deploy

```bash
firebase deploy
```

## ARIA / API keys

Open **Settings** (bottom of the sidebar):

- Choose a provider (Claude / OpenAI / Gemini).
- Paste that provider's API key. Optionally override the model
  (defaults: `claude-opus-4-8`, `gpt-4o`, `gemini-2.0-flash`, `llama-3.3-70b-versatile`).

Calls go **directly from your browser** to the provider. The key is saved to your
Firestore `userSettings/{uid}` doc — private to your account via the security
rules, but **stored unencrypted**. Fine for a personal tool; use an API key
scoped to this app, and don't use this pattern for a shared/multi-tenant product.
If you want the key hidden server-side, move the call into a Firebase Cloud
Function (requires the Blaze plan) and have the browser call that instead.

## Data model (Firestore)

| Collection      | Fields |
|-----------------|--------|
| `classes`       | uid, name, color, icon, order, createdAt |
| `groups`        | uid, name, order, createdAt |
| `categories`    | uid, name, icon, groupId, order, createdAt |
| `subcategories` | uid, name, categoryId, order, createdAt |
| `items`         | uid, name, info, link, photoUrl, categoryId, subcategoryId, classId, pinned, createdAt |
| `conversations` | uid, title, messages[], updatedAtMs |
| `userSettings/{uid}` | aiProvider, apiKeys{}, models{}, theme |
