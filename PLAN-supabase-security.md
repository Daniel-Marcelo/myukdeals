# PLAN: Supabase security — move writes to a service-role key, enable RLS on every table, remove the open debug route

**Rank: 2 of 5.** Do this immediately after (or, if Step 0 shows RLS is OFF on `deals`, *before*) [PLAN-feed-freshness](PLAN-feed-freshness.md).

## Goal

Right now **every database write in the app uses the public anon key**. `lib/scraper.ts` imports the client from [lib/supabase.ts](lib/supabase.ts), which is built from `NEXT_PUBLIC_SUPABASE_ANON_KEY` — a key that ships to the browser and is trivially readable by anyone. The scraper deletes and re-inserts the entire `deals` table with that key.

For those writes to succeed today, the `deals` table must have **Row Level Security either disabled or wide open**. The only RLS that exists anywhere in the repo is in [supabase/migrations/add_user_preferences.sql](supabase/migrations/add_user_preferences.sql), which covers `user_preferences` and nothing else. `deals`, `dismissed`, `saved`, and `meta` were created by hand in the dashboard with unknown protection.

The concrete exposure if RLS is off (must be confirmed in Step 0):
- Anyone with the anon key (i.e. anyone who opens the site and reads the JS bundle) can `delete from deals` — wiping the feed — or insert spam rows.
- Anyone can read **every user's** `dismissed` and `saved` rows, and read/overwrite `user_preferences` for other users if its policy isn't actually enforced.

After this plan:
- A new **server-only** `SUPABASE_SERVICE_ROLE_KEY` performs all privileged writes (the scraper). It is never `NEXT_PUBLIC_*` and never imported into a client component.
- RLS is **enabled on all five tables** with least-privilege policies: `deals`/`meta` are world-readable but not writable via the anon key; `dismissed`/`saved` are readable/writable only by their owning user.
- The unauthenticated [app/api/debug/route.ts](app/api/debug/route.ts) — which lets anyone make the server scrape HotUKDeals — is removed.

## Context you must know (verified against the code on 2026-07-09)

- **Two client factories already exist and must not be conflated:**
  - [lib/supabase.ts](lib/supabase.ts) → a *module-level* anon client (`export const supabase`). Imported by `lib/scraper.ts` (writes) and `app/api/deals/route.ts` (reads `deals`).
  - [lib/supabase-server.ts](lib/supabase-server.ts) → `createClient()`, an anon client **bound to the request cookies** (the logged-in user's JWT). Used by all the per-user routes (`dismiss`, `save`, `saved`, `unsave`, `preferences`, `reset-dismissed`, and the auth check + per-user reads in `deals`). This one **must keep using the anon key** — RLS policies rely on `auth.uid()` from that JWT. Do not point it at the service role.
- **`app/api/deals/route.ts` reads `deals` with the *plain anon* client (no user JWT).** This is the subtle trap in Step 4: a policy written `to authenticated` will **not** match this client, because a cookie-less anon client authenticates as the `anon` Postgres role, not `authenticated`. The SELECT policy on `deals`/`meta` must therefore allow `anon` too (deals are public data scraped from a public site).
- The scraper currently writes `deals` (delete+insert, or the `replace_deals` RPC once [PLAN-feed-freshness](PLAN-feed-freshness.md) lands) and, after feed-freshness, `meta` (upsert).
- `dismissed`, `saved`, `user_preferences` all have a `user_id` column (confirmed: `dismiss` inserts `user_id`, `reset-dismissed` deletes by `user_id`, `save` upserts `user_id`, `preferences` filters by `user_id`).
- Env vars today (grep-confirmed): only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `CRON_SECRET`. There is **no** service-role key yet.
- `.env*` is git-ignored (see [.gitignore](.gitignore)) — safe to add the new secret to `.env.local`.

## Files to touch

| File | Change |
|---|---|
| `.env.local` (local) + Vercel env (prod) | NEW secret `SUPABASE_SERVICE_ROLE_KEY` |
| `lib/supabase-admin.ts` | NEW — service-role client, server-only |
| `lib/scraper.ts` | Import writes-client from `supabase-admin` instead of `supabase` |
| `supabase/migrations/enable_rls.sql` | NEW — enable RLS + policies on `deals`, `meta`, `dismissed`, `saved`; verify `user_preferences` |
| `app/api/debug/route.ts` | DELETE the file |
| `README.md` / env docs | Document the new env var (optional but recommended) |

## Implementation order

### Step 0 — Diagnose current RLS state (do this first; it sets the urgency)

In the Supabase dashboard → SQL editor (this repo has **no Supabase CLI**; migrations are applied by pasting SQL, then committing the `.sql` file for the record):

```sql
select relname as table, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class
where relname in ('deals','dismissed','saved','meta','user_preferences') and relnamespace = 'public'::regnamespace;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public'
order by tablename, policyname;
```

- **If `deals.rls_enabled` is `false`:** the anon-key wipe described in the Goal is live. Treat this plan as **rank 1** and do it before feed-freshness.
- Record the output as a comment at the top of `enable_rls.sql` so the change is auditable.

### Step 1 — Get the service-role key and wire the env var

1. Supabase dashboard → Project Settings → API → copy the **`service_role`** secret (NOT the anon key). It bypasses RLS — treat it like a password.
2. Add to `.env.local` (git-ignored):
   ```
   SUPABASE_SERVICE_ROLE_KEY=<the service_role secret>
   ```
   **Do not** prefix it with `NEXT_PUBLIC_`. That prefix would inline it into the client bundle and defeat the entire plan.
3. Add the same var in Vercel → Project → Settings → Environment Variables (Production + Preview). Redeploy is required for it to take effect in prod, but do that at the end.

### Step 2 — Create the server-only admin client

New file `lib/supabase-admin.ts`:

```ts
import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS. NEVER import this into a client component
// or any module that runs in the browser. Server code (scraper, cron routes) only.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)
```

- The `import 'server-only'` line makes the build **fail loudly** if this file is ever pulled into a client bundle. Add the package if it is not already present: it ships with Next, so `import 'server-only'` resolves without an install. If the build complains it cannot resolve `server-only`, run `npm i server-only`.
- `persistSession: false` avoids the admin client trying to read/write auth storage on the server.

### Step 3 — Point the scraper's writes at the admin client

In [lib/scraper.ts](lib/scraper.ts):

- Change the import. Today line 2 is `import { supabase } from './supabase'`. The scraper uses `supabase` **only for writes** (the `delete`/`insert`, or the `replace_deals` RPC + `meta` upsert after feed-freshness). Replace that import with:
  ```ts
  import { supabaseAdmin } from './supabase-admin'
  ```
  and rename the write-call receivers from `supabase.` to `supabaseAdmin.` inside `scrapeTabNow` (and inside `scrapeIfStale`/`getLastScraped` if [PLAN-feed-freshness](PLAN-feed-freshness.md) has already added them — those `meta` reads/writes should also use `supabaseAdmin`).
- **Coordination with feed-freshness:** that plan's Step 3 already says "If `lib/supabase-admin.ts` exists, use that instead." So:
  - If feed-freshness is **not yet done**: just swap the delete/insert client here to `supabaseAdmin`.
  - If feed-freshness **is done**: make every `meta` and `replace_deals` call in the scraper use `supabaseAdmin`.
- Leave `app/api/deals/route.ts`'s `import { supabase }` (the anon read) **as-is** — the deals SELECT stays on the anon client, and Step 4 adds a public-read policy so it keeps working.

### Step 4 — Enable RLS + policies (new migration, applied via SQL editor)

New file `supabase/migrations/enable_rls.sql`. **Enable RLS and create the policies in the same run** — enabling RLS with no policy denies everything and would break the app between statements.

```sql
-- deals: public read (scraped public data; the deals route reads with a cookie-less
-- anon client, so the SELECT policy MUST include the anon role). No write policy ->
-- anon/authenticated cannot write; only the service-role key (which bypasses RLS) can.
alter table public.deals enable row level security;
create policy "deals are readable by anyone"
  on public.deals for select to anon, authenticated using (true);

-- meta: same shape (freshness timestamps read by the deals route via anon client).
alter table public.meta enable row level security;
create policy "meta is readable by anyone"
  on public.meta for select to anon, authenticated using (true);

-- dismissed: each user sees and manages only their own rows.
alter table public.dismissed enable row level security;
create policy "own dismissed" on public.dismissed
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- saved: same.
alter table public.saved enable row level security;
create policy "own saved" on public.saved
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- user_preferences already has RLS + an all-command policy (add_user_preferences.sql).
-- Verify it is still enabled; do not create a duplicate policy.
```

If [PLAN-feed-freshness](PLAN-feed-freshness.md) added the `replace_deals` function, also lock down who may call it over the API (defence in depth — the function is SECURITY INVOKER, so under RLS an anon caller already can't write, but revoking execute removes the attack surface entirely):

```sql
revoke execute on function public.replace_deals(text, text, jsonb) from anon, authenticated;
-- service_role retains execute implicitly; the scraper calls it via the admin client.
```

### Step 5 — Delete the open debug route

Delete [app/api/debug/route.ts](app/api/debug/route.ts) entirely. It has **no auth check** and makes the server fetch `hotukdeals.com` on every hit — an anonymous SSRF-flavoured abuse vector and dead code (it only dumps `<img>` src attributes that were used once to reverse-engineer the image URL format). The still-useful `app/api/debug-scrape/route.ts` is **gated by `CRON_SECRET`** — leave that one.

If you would rather keep it, gate it behind `CRON_SECRET` exactly like the scrape routes — but deletion is preferred.

### Step 6 — Deploy and verify (see acceptance criteria)

Redeploy Vercel so the prod build picks up `SUPABASE_SERVICE_ROLE_KEY`, then run the checks below.

## Edge cases a weaker model will miss

- **The `to authenticated` trap.** The deals/meta SELECT policies **must** include `anon`, because `app/api/deals/route.ts` reads with the cookie-less `supabase` client (Postgres role `anon`), even though a human user is logged in. Writing those policies `to authenticated` silently returns **zero deals** for everyone. (Alternative, if you prefer not to expose deals to `anon` at all: switch the two `deals` reads in the deals route to `supabaseAdmin` and drop the anon SELECT policy. Pick one approach; do not half-do both.)
- **Enabling RLS is instantly deny-all.** Never enable RLS in one migration and add policies in a later one — run them together, or the app breaks in between.
- **Adding a unique/PK is out of scope here** — but note that if you later restrict `dismissed`/`saved` writes, the `for all ... to authenticated` policy already covers insert/update/delete/select in one shot; you do not need four separate policies.
- **`server-only` must actually be imported** at the top of `lib/supabase-admin.ts`. Without it, a future refactor that imports the admin client into a `'use client'` file would leak the service key into the browser bundle with no build error.
- **Do not rotate the anon key as part of this** — it is public by design and RLS is what protects the data. But if Step 0 showed RLS was off, assume the anon key's write capability may already have been observed; the mitigation is enabling RLS (this plan), not rotation.
- **Prod vs local drift:** the env var must be set in **both** `.env.local` and Vercel. A common failure is the scraper working locally and 500-ing in prod because the Vercel env var is missing — the error will be `supabaseKey is required`.

## Acceptance criteria

1. `pg_class` shows `rls_enabled = true` for all of `deals`, `dismissed`, `saved`, `meta`, `user_preferences`.
2. **Anon cannot wipe deals.** Using the public anon key directly (replace `<URL>`/`<ANON>`):
   ```bash
   curl -s -X DELETE "<URL>/rest/v1/deals?id=eq.0" \
     -H "apikey: <ANON>" -H "Authorization: Bearer <ANON>"
   ```
   returns a permission-denied / empty-effect response, and `select count(*) from deals` is unchanged.
3. **App still reads deals.** Loading Hot/Trending as a logged-in user shows deals (the anon SELECT policy works with the cookie-less read client).
4. **Scrape still writes.** `curl -H "x-cron-secret: $CRON_SECRET" https://<host>/api/scrape/hot?period=today` returns `count > 0` and `select max(scraped_at) from deals where tab='hot'` is current — proving the service-role write path works under RLS.
5. **Per-user isolation.** `dismiss`, `save`, `unsave`, `reset-dismissed`, and the blocked-retailers modal all still work for the logged-in user; a second account sees its own empty dismissed/saved, not the first account's rows.
6. **Debug route gone.** `GET /api/debug` returns 404.
7. **No secret in the bundle.** `npm run build` succeeds, and grepping `.next/` for the service-role key value finds nothing (`grep -r "<first 12 chars of key>" .next/` → no matches).

## Out of scope

- Atomic replace / self-heal / freshness UI → [PLAN-feed-freshness](PLAN-feed-freshness.md).
- Deduplicating `dismissed`/`saved` rows and bounding the feed query → [PLAN-dismissed-hardening](PLAN-dismissed-hardening.md).
- Restricting who can *sign up* (the auth page allows open signups) — noted, but single-user + per-user RLS makes it low risk. Track separately if it matters.
