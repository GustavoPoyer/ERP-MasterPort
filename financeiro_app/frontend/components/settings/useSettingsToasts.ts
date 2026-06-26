"use client";

import { useCallback, useState } from "react";

export type SettingsToastTone = "success" | "error" | "info";

export type SettingsToastItem = {
  id: number;
  tone: SettingsToastTone;
  message: string;
};

const TOAST_TTL_MS = 4200;

export function useSettingsToasts() {
  const [toasts, setToasts] = useState<SettingsToastItem[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback(
    (tone: SettingsToastTone, message: string) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((prev) => [...prev, { id, tone, message }]);
      window.setTimeout(() => dismissToast(id), TOAST_TTL_MS);
    },
    [dismissToast],
  );

  return { toasts, pushToast, dismissToast };
}

export async function runSettingsAction(
  action: () => Promise<string | void>,
  pushToast: (tone: SettingsToastTone, message: string) => void,
  successFallback = "Concluído.",
) {
  try {
    const message = await action();
    pushToast("success", message || successFallback);
  } catch (e) {
    pushToast("error", e instanceof Error ? e.message : "Não foi possível concluir a ação.");
  }
}
