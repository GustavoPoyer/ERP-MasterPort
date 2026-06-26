"use client";

import { KivoRobot } from "./KivoRobot";

type AuthPasswordFieldProps = {
  id: string;
  placeholder: string;
  value: string;
  visible: boolean;
  onToggleVisible: () => void;
  autoComplete: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
};

export function AuthPasswordField({
  id,
  placeholder,
  value,
  visible,
  onToggleVisible,
  autoComplete,
  onChange,
  onEnter,
}: AuthPasswordFieldProps) {
  return (
    <div className="auth-screen-password-wrap">
      <input
        id={id}
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.();
        }}
      />
      <button
        type="button"
        className="auth-screen-password-toggle"
        onClick={onToggleVisible}
        title={visible ? "Pedir pro robô não olhar" : "Deixar o robô espiar a senha"}
        aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        aria-pressed={visible}
      >
        <KivoRobot mood={visible ? "peek" : "shy"} />
      </button>
    </div>
  );
}
