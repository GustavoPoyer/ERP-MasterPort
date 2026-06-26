export type PasswordStrengthLevel = 0 | 1 | 2 | 3 | 4;

export type PasswordStrengthCheck = {
  id: string;
  label: string;
  ok: boolean;
};

export function getPasswordStrength(password: string): {
  level: PasswordStrengthLevel;
  label: string;
  checks: PasswordStrengthCheck[];
} {
  const checks: PasswordStrengthCheck[] = [
    { id: "length", label: "Pelo menos 8 caracteres", ok: password.length >= 8 },
    { id: "lower", label: "Letra minúscula", ok: /[a-z]/.test(password) },
    { id: "upper", label: "Letra maiúscula", ok: /[A-Z]/.test(password) },
    { id: "digit", label: "Número", ok: /\d/.test(password) },
    { id: "symbol", label: "Símbolo", ok: /[^A-Za-z0-9]/.test(password) },
  ];
  const score = checks.filter((item) => item.ok).length;
  let level: PasswordStrengthLevel = 0;
  let label = "Fraca";
  if (password.length === 0) {
    level = 0;
    label = "Digite uma senha";
  } else if (score <= 2) {
    level = 1;
    label = "Fraca";
  } else if (score === 3) {
    level = 2;
    label = "Razoável";
  } else if (score === 4) {
    level = 3;
    label = "Boa";
  } else {
    level = 4;
    label = "Forte";
  }
  return { level, label, checks };
}

export function isPasswordStrongEnough(password: string): boolean {
  return password.length >= 6 && getPasswordStrength(password).level >= 2;
}

type PasswordStrengthProps = {
  password: string;
};

export function PasswordStrength({ password }: PasswordStrengthProps) {
  const { level, label, checks } = getPasswordStrength(password);
  if (!password) return null;

  return (
    <div className="settings-password-strength" aria-live="polite">
      <div className="settings-password-strength-head">
        <span>Força da senha</span>
        <strong>{label}</strong>
      </div>
      <div className="settings-password-strength-bar" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={`settings-password-strength-segment${
              level >= step ? ` settings-password-strength-segment--${level}` : ""
            }`}
          />
        ))}
      </div>
      <ul className="settings-password-checklist">
        {checks.map((check) => (
          <li key={check.id} className={check.ok ? "is-ok" : ""}>
            {check.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
