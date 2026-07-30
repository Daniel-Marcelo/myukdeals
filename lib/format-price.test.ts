import { describe, it, expect } from 'vitest'
import { formatPrice } from './format-price'

describe('formatPrice', () => {
  it('pads truncated pence', () => {
    expect(formatPrice(2.5)).toBe('£2.50')
    expect(formatPrice(10.5)).toBe('£10.50')
    expect(formatPrice(2.1)).toBe('£2.10')
  })

  it('leaves whole pounds without pence', () => {
    expect(formatPrice(149)).toBe('£149')
    expect(formatPrice(18)).toBe('£18')
  })

  it('adds thousands separators', () => {
    expect(formatPrice(11195)).toBe('£11,195')
    expect(formatPrice(3999)).toBe('£3,999')
    expect(formatPrice(1234.5)).toBe('£1,234.50')
  })

  it('renders 0 as FREE', () => {
    expect(formatPrice(0)).toBe('FREE')
  })

  it('keeps two-decimal prices intact', () => {
    expect(formatPrice(17.99)).toBe('£17.99')
    expect(formatPrice(0.65)).toBe('£0.65')
    expect(formatPrice(499.98)).toBe('£499.98')
  })

  it('accepts string input', () => {
    expect(formatPrice('17.99')).toBe('£17.99')
    expect(formatPrice('£1,234.50')).toBe('£1,234.50')
  })

  it('returns null for absent or nonsense values', () => {
    expect(formatPrice(null)).toBeNull()
    expect(formatPrice(undefined)).toBeNull()
    expect(formatPrice('n/a')).toBeNull()
    expect(formatPrice(-5)).toBeNull()
  })

  it('rounds sub-penny float noise rather than showing three decimals', () => {
    expect(formatPrice(19.999)).toBe('£20')
    expect(formatPrice(4.005)).toBe('£4.01')
  })
})
