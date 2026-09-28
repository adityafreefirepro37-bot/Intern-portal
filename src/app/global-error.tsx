'use client'

/**
 * Last-resort boundary for errors in the root layout. Renders its own
 * document and inline styles because global CSS may not be available.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: 'Canvas',
          color: 'CanvasText',
        }}
      >
        <title>Something went wrong · AYAVA</title>
        <main role="alert" style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ opacity: 0.75, marginBottom: 20 }}>The application hit an unexpected error. Please try again.</p>
          {error.digest && (
            <p style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.6 }}>Reference: {error.digest}</p>
          )}
          <button
            type="button"
            onClick={() => retry()}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid currentColor',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}
