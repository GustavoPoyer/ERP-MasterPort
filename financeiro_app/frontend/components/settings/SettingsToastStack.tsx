"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import type { SettingsToastItem } from "./useSettingsToasts";

type SettingsToastStackProps = {
  toasts: SettingsToastItem[];
  onDismiss: (id: number) => void;
};

function ToastIcon({ tone }: { tone: SettingsToastItem["tone"] }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2 };
  if (tone === "error") {
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16h.01" />
      </svg>
    );
  }
  if (tone === "info") {
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 10v6M12 7h.01" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden="true">
      <path d="M9 12l2 2 4-4" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export function SettingsToastStack({ toasts, onDismiss }: SettingsToastStackProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || toasts.length === 0) return null;

  return createPortal(
    <div className="settings-toast-stack" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <div key={toast.id} className={`settings-toast settings-toast--${toast.tone}`} role="status">
          <span className="settings-toast-icon">
            <ToastIcon tone={toast.tone} />
          </span>
          <p className="settings-toast-message">{toast.message}</p>
          <button
            type="button"
            className="settings-toast-dismiss"
            aria-label="Fechar notificação"
            onClick={() => onDismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
