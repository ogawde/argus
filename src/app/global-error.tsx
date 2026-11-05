"use client";

/**
 * Root error boundary. Must define its own <html>/<body> (Next.js requirement).
 * Keep this free of providers/fonts that break prerender.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          background: "#f4f7f8",
          color: "#14212b",
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
        }}
      >
        <main style={{ maxWidth: 420, textAlign: "center" }}>
          <p style={{ letterSpacing: "0.08em", textTransform: "uppercase", fontSize: 12 }}>
            Argus
          </p>
          <h1 style={{ fontSize: 28, margin: "8px 0 12px" }}>Something went wrong</h1>
          <p style={{ opacity: 0.75, fontSize: 14 }}>
            {error.message || "Unexpected error"}
            {error.digest ? ` (${error.digest})` : null}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 16,
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid #14212b",
              background: "#14212b",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
