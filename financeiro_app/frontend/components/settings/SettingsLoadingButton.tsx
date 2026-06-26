"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type SettingsLoadingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingLabel?: string;
  children: ReactNode;
};

export function SettingsLoadingButton({
  loading = false,
  loadingLabel,
  children,
  disabled,
  className = "",
  ...rest
}: SettingsLoadingButtonProps) {
  return (
    <button
      type="button"
      className={`settings-loading-btn${className ? ` ${className}` : ""}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <>
          <span className="settings-btn-spinner" aria-hidden="true" />
          {loadingLabel || children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
