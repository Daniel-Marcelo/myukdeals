/**
 * Does `merchant` fall under the blocked term `term`?
 *
 * Exact match, or the merchant name STARTS WITH the term followed by a space —
 * so "amazon" blocks "Amazon Warehouse" and "asda" blocks "ASDA Groceries",
 * while "ao" (a real UK retailer on HUKD) does not accidentally match anything
 * that merely contains those two letters.
 *
 * Deliberately NOT a substring match: false positives would silently hide deals
 * the user never asked to block, which is far worse than an over-narrow filter
 * they can widen by adding another term.
 */
export function isMerchantBlocked(merchant: string | null, blockedTerms: string[]): boolean {
  if (!merchant || blockedTerms.length === 0) return false
  const name = merchant.toLowerCase().trim()
  return blockedTerms.some((raw) => {
    const term = raw.toLowerCase().trim()
    if (!term) return false
    return name === term || name.startsWith(term + ' ')
  })
}

type FilterableDeal = { id: string | number; merchant: string | null }

/**
 * Drop deals the user has dismissed or whose merchant they have blocked.
 *
 * NOTE: callers apply this AFTER the `deals` query's row limit, so blocking a
 * high-volume retailer shrinks the feed rather than pulling in more deals from
 * deeper in the table. That is fine at the current 3 pages x 30 deals = 90 rows
 * per tab/period; if PAGES_TO_SCRAPE ever goes above 5, move the merchant
 * filter into the SQL query instead.
 */
export function filterDeals<T extends FilterableDeal>(
  deals: T[],
  dismissedIds: Iterable<string>,
  blockedTerms: string[],
): T[] {
  const dismissed = new Set(Array.from(dismissedIds, String))
  return deals.filter(
    (d) => !dismissed.has(String(d.id)) && !isMerchantBlocked(d.merchant, blockedTerms),
  )
}
