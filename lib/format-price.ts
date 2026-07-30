/**
 * Render a HotUKDeals price for display.
 *
 * `thread.price` arrives as a JSON number, so trailing zeros are already gone by
 * the time we see it: £1.50 is the number 1.5, and £2.00 is the number 2. It can
 * also be a string on some thread types, hence the Number() coercion.
 *
 * HUKD uses 0 to mean "no fixed price" — free giveaways (Epic Games), vouchers,
 * and in-store offers all come through as 0. Rendering "£0" reads as a scraper
 * failure, so 0 becomes "FREE".
 *
 * Returns null when there is nothing sensible to show; callers render no price
 * at all in that case.
 */
export function formatPrice(raw: number | string | null | undefined): string | null {
  if (raw == null) return null

  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[£,\s]/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  if (n === 0) return 'FREE'

  // Whole pounds show no pence (£149, not £149.00); anything with pence shows
  // exactly two (£2.50, not £2.5). Thousands separators throughout.
  const hasPence = Math.round(n * 100) % 100 !== 0
  return '£' + n.toLocaleString('en-GB', {
    minimumFractionDigits: hasPence ? 2 : 0,
    maximumFractionDigits: 2,
  })
}
