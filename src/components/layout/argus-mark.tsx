/** Argus logo mark: an open eye (the hundred-eyed watchman) with a teal iris. */
export function ArgusMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="Argus">
      <path
        d="M2 16C6 9.5 10.8 6.5 16 6.5S26 9.5 30 16c-4 6.5-8.8 9.5-14 9.5S6 22.5 2 16Z"
        fill="none"
        stroke="var(--argus-ink)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="5.6" fill="var(--argus-teal)" />
      <circle cx="16" cy="16" r="2.2" fill="var(--argus-ink)" />
      <circle cx="17.6" cy="14.4" r="0.9" fill="var(--argus-surface)" />
    </svg>
  );
}
