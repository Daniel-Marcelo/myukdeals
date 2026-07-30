import { describe, it, expect } from 'vitest'
import { isMerchantBlocked, filterDeals } from './filter-deals'

describe('isMerchantBlocked', () => {
  it('matches the merchant exactly, ignoring case', () => {
    expect(isMerchantBlocked('Amazon', ['amazon'])).toBe(true)
    expect(isMerchantBlocked('amazon', ['Amazon'])).toBe(true)
  })

  it('matches sub-brands that extend the term', () => {
    expect(isMerchantBlocked('Amazon Warehouse', ['amazon'])).toBe(true)
    expect(isMerchantBlocked('ASDA Groceries', ['asda'])).toBe(true)
    expect(isMerchantBlocked('EE Tech & Gaming', ['ee'])).toBe(true)
    expect(isMerchantBlocked('Playstation Store', ['playstation'])).toBe(true)
  })

  it('does not match on an incidental substring', () => {
    expect(isMerchantBlocked('Marks & Spencer', ['ao'])).toBe(false)
    expect(isMerchantBlocked('Currys', ['ur'])).toBe(false)
    expect(isMerchantBlocked('Amazonia Ltd', ['amazon'])).toBe(false)
  })

  it('tolerates untrimmed stored terms', () => {
    expect(isMerchantBlocked('Amazon', ['  Amazon  '])).toBe(true)
  })

  it('handles null merchants and empty term lists', () => {
    expect(isMerchantBlocked(null, ['amazon'])).toBe(false)
    expect(isMerchantBlocked('Amazon', [])).toBe(false)
    expect(isMerchantBlocked('Amazon', ['', '  '])).toBe(false)
  })
})

describe('filterDeals', () => {
  const deals = [
    { id: '1', merchant: 'Amazon' },
    { id: '2', merchant: 'Lidl' },
    { id: 3, merchant: 'ASDA Groceries' },
    { id: '4', merchant: null },
  ]

  it('drops dismissed ids regardless of string/number type', () => {
    expect(filterDeals(deals, ['3'], []).map((d) => d.id)).toEqual(['1', '2', '4'])
  })

  it('drops blocked merchants and their sub-brands', () => {
    expect(filterDeals(deals, [], ['amazon', 'asda']).map((d) => d.id)).toEqual(['2', '4'])
  })

  it('keeps deals with no merchant', () => {
    expect(filterDeals(deals, [], ['amazon']).some((d) => d.merchant === null)).toBe(true)
  })

  it('applies dismissals and blocks together', () => {
    expect(filterDeals(deals, ['2'], ['amazon']).map((d) => d.id)).toEqual([3, '4'])
  })

  it('returns everything when there is nothing to filter', () => {
    expect(filterDeals(deals, [], [])).toHaveLength(4)
  })
})
