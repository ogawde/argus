/** Always-visible reminder that nothing here moves real money. */
export function SandboxBanner() {
  return (
    <div
      role="status"
      className="sandbox-stripes flex items-center justify-center gap-3 bg-sev-warn-wash px-4 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-sev-warn"
    >
      <span className="inline-block size-1.5 rounded-full bg-sev-warn" aria-hidden />
      Sandbox mode — no real money moves
      <span className="inline-block size-1.5 rounded-full bg-sev-warn" aria-hidden />
    </div>
  );
}
