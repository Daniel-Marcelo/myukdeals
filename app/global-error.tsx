'use client'

/**
 * Last-resort boundary: catches errors thrown by the root layout itself, which
 * app/error.tsx cannot. It REPLACES the root layout, so it must render its own
 * <html>/<body>.
 *
 * Inline styles, not Tailwind, and no next/font: if the root layout is what
 * crashed, the stylesheet link and font variable may not be on the page —
 * anything else here renders as unstyled white text on white.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          background: '#0a0a0f',
          color: '#ededef',
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          padding: '0 1.5rem',
        }}
      >
        <p style={{ fontSize: 16, fontWeight: 600 }}>Something went wrong</p>
        <p style={{ fontSize: 14, color: '#8a8f98', marginTop: 4, textAlign: 'center' }}>
          Reload the app to continue.
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: 24,
            background: '#4f46e5',
            color: '#fff',
            border: 0,
            borderRadius: 999,
            padding: '8px 20px',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
        {error.digest && (
          <p style={{ fontSize: 11, color: 'rgba(138,143,152,0.4)', marginTop: 24, fontFamily: 'monospace' }}>
            {error.digest}
          </p>
        )}
      </body>
    </html>
  )
}
