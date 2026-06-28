@AGENTS.md

# MyUKDeals

Personal deal feed app that scrapes HotUKDeals and presents cards you can swipe to save or dismiss. Single-user, no auth. Hosted on Vercel free tier.

## Stack

- **Next.js 16** — App Router, TypeScript, Tailwind CSS v4
- **Supabase** (Postgres) — deals, dismissed, saved, meta tables
- **Cheerio** — scraping HotUKDeals
- **Framer Motion** — swipe gestures on deal cards
- **Lucide React** — icons

## Running locally

```bash
npm run dev
```

Requires `.env.local` with:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Key files

| File | Purpose |
|------|---------|
| `lib/scraper.ts` | Scrapes 3 pages × 2 tabs (hot/trending); parses `data-vue3` JSON on `article[id^="thread_"]` |
| `lib/supabase.ts` | Shared Supabase client |
| `app/api/deals/route.ts` | GET — calls scrapeIfStale(), filters dismissed IDs, returns deals + last_scraped_at |
| `app/api/dismiss/route.ts` | POST — inserts deal_id into dismissed table |
| `app/api/save/route.ts` | POST — inserts deal_id into saved table |
| `app/api/debug-scrape/route.ts` | Manual scrape trigger |
| `components/DealCard.tsx` | Swipeable card; left = dismiss, right = save |
| `components/DealFeed.tsx` | Fetches /api/deals, manages deal list, passes handlers to DealCard |
| `app/page.tsx` | Sticky header with Hot/Trending tab switcher, renders DealFeed |

## Supabase schema

Tables: `deals`, `dismissed`, `saved`, `meta` (stores `last_scraped_at` as a key/value row).

## Scraping details

- Deal data comes from `parsed.props.thread` inside the `data-vue3` attribute on each article
- Image URL format: `https://images.hotukdeals.com/{path}/{name}/re/202x202/qt/70/{name}.jpg`
- Stale threshold: 30 minutes — scrape only triggers if last_scraped_at is older than that
- Hot tab: ordered by temperature desc; Trending tab: ordered by order_index asc

## UI conventions

- Primary colour: indigo-600
- Font: Inter
- No dark mode currently
