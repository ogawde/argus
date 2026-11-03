"use client";

/**
 * Phase 1 spike placeholder.
 * Real AG Studio wiring lands after `pnpm add ag-studio` and reviewing the
 * PayPal AG Grid boilerplate. Until then this page proves the App Router
 * client-island pattern (dynamic import, ssr:false).
 */
export default function StudioSpike() {
  const rows = [
    { id: "L1", name: "Jon Doe", amount: 22.5, flag: "ENTITY_MATCH" },
    { id: "L2", name: "Priya Nair", amount: 18.0, flag: "DESTINATION_CHANGED" },
    { id: "L3", name: "Carlos Mendes", amount: 450.0, flag: "AMOUNT_DEVIATION" },
  ];

  return (
    <div className="rounded border border-neutral-200 bg-white p-4">
      <p className="mb-3 text-sm font-medium">Mock diff grid (pre–AG Studio)</p>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-2">Line</th>
            <th>Payee</th>
            <th>Amount</th>
            <th>Flag</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-neutral-100">
              <td className="py-2 font-mono text-xs">{r.id}</td>
              <td>{r.name}</td>
              <td>${r.amount.toFixed(2)}</td>
              <td className="text-amber-700">{r.flag}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-xs text-neutral-500">
        TODO: replace with `ag-studio` createStudio + custom widgets. See
        docs/AGSTUDIO_NOTES.md.
      </p>
    </div>
  );
}
