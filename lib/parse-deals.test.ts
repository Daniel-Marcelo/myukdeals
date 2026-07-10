import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseThreadsFromHtml } from './parse-deals'

// Real HotUKDeals pages captured as fixtures. Assertions check invariants/ranges,
// never exact counts or specific titles (page content changes hourly).
const hottest = readFileSync(new URL('./__fixtures__/hukd-hottest.html', import.meta.url), 'utf8')
const hot = readFileSync(new URL('./__fixtures__/hukd-hot.html', import.meta.url), 'utf8')

describe('parseThreadsFromHtml', () => {
  const deals = parseThreadsFromHtml(hottest, 'hot', 'today')

  it('parses a plausible number of deals', () => {
    expect(deals.length).toBeGreaterThanOrEqual(5)
  })

  it('every deal has the required non-null fields', () => {
    for (const d of deals) {
      expect(d.id).toMatch(/^\d+$/)
      expect(d.title.length).toBeGreaterThan(0)
      expect(d.deal_url).toMatch(/^https?:\/\//)
      expect(typeof d.temperature).toBe('number')
      expect(Number.isNaN(d.temperature)).toBe(false)
      expect(d.tab).toBe('hot')
    }
  })

  it('image URLs, when present, match the expected CDN pattern', () => {
    const withImg = deals.filter((d) => d.image_url)
    expect(withImg.length).toBeGreaterThan(0) // the URL template still resolves
    for (const d of withImg) {
      expect(d.image_url!).toMatch(
        /^https:\/\/images\.hotukdeals\.com\/.+\/re\/202x202\/qt\/70\/.+\.jpg$/
      )
    }
  })

  it('most deals carry a price and a merchant', () => {
    const priced = deals.filter((d) => d.price).length
    const withMerchant = deals.filter((d) => d.merchant).length
    expect(priced / deals.length).toBeGreaterThan(0.4)
    expect(withMerchant / deals.length).toBeGreaterThan(0.4)
  })

  it('applies the page offset to order_index', () => {
    const p0 = parseThreadsFromHtml(hottest, 'hot', 'today', 0)
    const p100 = parseThreadsFromHtml(hottest, 'hot', 'today', 100)
    expect(p100[0].order_index - p0[0].order_index).toBe(100)
  })

  it('derives trending_for on the trending tab and leaves it null on hot', () => {
    const trending = parseThreadsFromHtml(hot, 'trending', 'today')
    expect(trending.some((d) => d.trending_for)).toBe(true)
    expect(deals.every((d) => d.trending_for === null)).toBe(true)
  })
})
