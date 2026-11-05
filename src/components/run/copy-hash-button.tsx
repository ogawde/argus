"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Copies the full plan hash to the clipboard. */
export function CopyHashButton({ hash }: { hash: string }) {
  const [isCopied, setIsCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(hash);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={copy}
      aria-label={isCopied ? "Plan hash copied" : "Copy full plan hash"}
      title="Copy full plan hash"
    >
      {isCopied ? <Check className="text-ok" /> : <Copy />}
    </Button>
  );
}
