"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

export type SettingsConfirmRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
};

type SettingsConfirmModalProps = {
  request: SettingsConfirmRequest | null;
  onClose: () => void;
};

export function SettingsConfirmModal({ request, onClose }: SettingsConfirmModalProps) {
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !request.busy) onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [request, onClose]);

  if (!request) return null;

  return createPortal(
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!request.busy) onClose();
      }}
    >
      <div
        className="settings-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="settings-confirm-title"
        aria-describedby="settings-confirm-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="settings-confirm-title">{request.title}</h3>
        <p id="settings-confirm-desc" className="settings-modal-desc">
          {request.message}
        </p>
        <div className="settings-modal-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={request.busy}
            onClick={onClose}
          >
            {request.cancelLabel || "Cancelar"}
          </button>
          <button
            type="button"
            className={`platform-settings-approve-btn settings-modal-confirm${
              request.tone === "danger" ? " settings-modal-confirm--danger" : ""
            }`}
            disabled={request.busy}
            onClick={() => {
              void Promise.resolve(request.onConfirm()).catch(() => null);
            }}
          >
            {request.busy ? (
              <>
                <span className="settings-btn-spinner" aria-hidden="true" />
                Aguarde…
              </>
            ) : (
              request.confirmLabel || "Confirmar"
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
