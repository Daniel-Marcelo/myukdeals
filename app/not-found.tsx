import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="min-h-dvh bg-[#0a0a0f] flex flex-col items-center justify-center px-6">
      <p className="text-base font-semibold text-[#ededef]">Page not found</p>
      <Link
        href="/"
        className="mt-6 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-sm font-medium transition-colors"
      >
        Back to deals
      </Link>
    </main>
  )
}
