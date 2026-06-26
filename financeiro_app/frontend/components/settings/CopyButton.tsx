"use client";

import { useState } from "react";

type CopyButtonProps = {
  value: string;
  label?: string;
  className?: string;
};

export function CopyButton({ value, label = "Copiar", className = "" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback silencioso */
    }
  }

  return (
    <button
      type="button"
      className={`settings-copy-btn${copied ? " settings-copy-btn--copied" : ""}${className ? ` ${className}` : ""}`}
      onClick={() => handleCopy().catch(() => null)}
      aria-label={copied ? "Copiado" : label}
    >
      {copied ? "Copiado!" : label}
    </button>
  );
}
