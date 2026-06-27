import { NextResponse } from 'next/server'

export async function GET() {
  const res = await fetch('https://www.hotukdeals.com/deals?filter=hot', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.9',
      'Referer': 'https://www.hotukdeals.com/',
    },
  })

  const html = await res.text()

  const { load } = await import('cheerio')
  const $ = load(html)

  // Find actual img src attributes in the first few articles
  const articles = $('article[id^="thread_"]')
  let output = `ARTICLES FOUND: ${articles.length}\n\n`

  articles.each((i, el) => {
    if (i > 2) return
    const $el = $(el)
    const id = $el.attr('id')?.replace('thread_', '')
    const imgs = $el.find('img').map((_, img) => $(img).attr('src')).get()
    output += `Article ${i} (id=${id}):\n  imgs=${JSON.stringify(imgs)}\n`
  })

  return new NextResponse(output, { headers: { 'Content-Type': 'text/plain' } })
}
