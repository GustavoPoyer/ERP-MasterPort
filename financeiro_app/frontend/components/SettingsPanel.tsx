"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AutomationClientAccessPanel } from "./AutomationClientAccessPanel";
import { AuthPasswordField } from "./AuthPasswordField";
import { KivoRobot } from "./KivoRobot";
import { CopyButton } from "./settings/CopyButton";
import { SettingsConfirmModal, type SettingsConfirmRequest } from "./settings/SettingsConfirmModal";
import { SettingsLoadingButton } from "./settings/SettingsLoadingButton";
import { SettingsToastStack } from "./settings/SettingsToastStack";
import {
  type AdminSettingsSection,
  type SettingsTab,
} from "./settings/settingsTabUrl";
import { PasswordStrength, isPasswordStrongEnough } from "./settings/PasswordStrength";
import { runSettingsAction, useSettingsToasts, type SettingsToastTone } from "./settings/useSettingsToasts";

type BankKey = "bb" | "itau_sigra";
type SectorKey = "financeiro" | "pedro" | "rh" | "operacoes";

type FinanceAccount = {
  id: number;
  bank: BankKey;
  name: string;
  slug: string;
  is_active: number;
};

type PendingUser = {
  id: number;
  username: string;
  requested_sector: string;
  created_at: string;
};

type UserSession = {
  id: number;
  created_at: string;
  expires_at: string;
  is_current: boolean;
};

type SectorOption = { key: SectorKey; label: string };

type AppInfo = {
  api_version: string;
  environment: string;
  smtp_configured: boolean;
};

type ActiveUser = {
  id: number;
  username: string;
  display_name: string;
  contact_email: string;
  sector: string;
  role: string;
  created_at: string;
};

type AuditEntry = {
  id: number;
  actor_username: string;
  action: string;
  target_type: string;
  target_label: string;
  details: string;
  created_at: string;
};

type SettingsPanelProps = {
  username: string;
  roleLabel: string;
  sectorLabel: string;
  isAdmin: boolean;
  apiBase: string;
  activeSessionCount: number;
  sessions: UserSession[];
  sessionsLoading: boolean;
  revokingSessionId: number | null;
  onRevokeSession: (sessionId: number) => Promise<string>;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  pendingCount: number;
  sectorMenu: SectorOption[];
  sectorLabelFn: (key: string) => string;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  profile: {
    displayName: string;
    contactEmail: string;
    createdAt?: string;
    busy: boolean;
    appInfo: AppInfo | null;
    notifyEmailPending: boolean;
    notifyEmailQueue: boolean;
    onDisplayNameChange: (v: string) => void;
    onContactEmailChange: (v: string) => void;
    onNotifyEmailPendingChange: (v: boolean) => void;
    onNotifyEmailQueueChange: (v: boolean) => void;
    onSaveProfile: () => Promise<string>;
    onSaveNotifications: () => Promise<string>;
  };
  password: {
    current: string;
    next: string;
    confirm: string;
    busy: boolean;
    showCurrent: boolean;
    showNext: boolean;
    showConfirm: boolean;
    onCurrentChange: (v: string) => void;
    onNextChange: (v: string) => void;
    onConfirmChange: (v: string) => void;
    onToggleCurrent: () => void;
    onToggleNext: () => void;
    onToggleConfirm: () => void;
    onSubmit: () => Promise<string>;
    onLogoutOthers: () => Promise<string>;
  };
  admin: {
    accounts: FinanceAccount[];
    accountsBusy: boolean;
    newBank: BankKey;
    newName: string;
    onNewBankChange: (bank: BankKey) => void;
    onNewNameChange: (name: string) => void;
    onCreateAccount: () => Promise<string>;
    onDeactivateAccount: (id: number) => Promise<string>;
    onReactivateAccount: (id: number) => Promise<string>;
    pendingUsers: PendingUser[];
    pendingLoading: boolean;
    pendingActionId: number | null;
    approvalSectorByUser: Record<number, SectorKey>;
    onApprovalSectorChange: (userId: number, sector: SectorKey) => void;
    onRefreshPending: () => Promise<void>;
    onApproveUser: (id: number) => Promise<string>;
    onRejectUser: (id: number) => Promise<string>;
    lookupUsername: string;
    onLookupUsernameChange: (v: string) => void;
    resetLink: string;
    resetLinkFor: string;
    busy: boolean;
    onGenerateResetLink: () => Promise<string>;
    activeUsers: ActiveUser[];
    activeUsersLoading: boolean;
    userSearch: string;
    onUserSearchChange: (v: string) => void;
    onRefreshUsers: () => Promise<void>;
    auditLog: AuditEntry[];
    auditLoading: boolean;
    onRefreshAudit: () => Promise<void>;
  };
  onLogout: () => Promise<void>;
};

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function TabIcon({ tab }: { tab: SettingsTab }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5 };
  if (tab === "profile") {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
      </svg>
    );
  }
  if (tab === "security") {
    return (
      <svg {...common}>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M12 12l8-4.5M12 12v9" />
    </svg>
  );
}

function getPasswordFieldErrors(current: string, next: string, confirm: string) {
  const errors: { current?: string; next?: string; confirm?: string } = {};
  if (!current.trim()) errors.current = "Informe a senha atual.";
  if (!next.trim()) errors.next = "Informe a nova senha.";
  else if (next.length < 6) errors.next = "Mínimo de 6 caracteres.";
  else if (!isPasswordStrongEnough(next)) errors.next = "Use uma senha mais forte (veja a checklist).";
  if (!confirm.trim()) errors.confirm = "Confirme a nova senha.";
  else if (confirm !== next) errors.confirm = "As senhas não conferem.";
  return errors;
}

function profileInitials(displayName: string, username: string) {
  const source = displayName.trim() || username.trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function formatProfileDate(iso?: string) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function envLabel(env: string) {
  const normalized = env.toLowerCase();
  if (normalized === "production" || normalized === "prod") return "Produção";
  if (normalized === "staging") return "Homologação";
  if (normalized === "development" || normalized === "dev") return "Desenvolvimento";
  return env;
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    "profile.update": "Perfil atualizado",
    "notifications.update": "Notificações atualizadas",
    "password.change": "Senha alterada",
    "password.admin_reset": "Senha redefinida (admin)",
    "session.revoke": "Sessão encerrada",
    "user.approve": "Cadastro aprovado",
    "user.reject": "Cadastro recusado",
    "account.create": "Conta bancária criada",
    "account.deactivate": "Conta desativada",
    "account.reactivate": "Conta reativada",
  };
  return labels[action] || action;
}

function formatSessionTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SettingsEmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="spatial-settings-empty">
      <span className="spatial-settings-empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M8 10h8M8 14h5" />
        </svg>
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
      {actionLabel && onAction ? (
        <button type="button" className="platform-settings-approve-btn spatial-settings-empty-cta" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

const ADMIN_SECTIONS: { id: AdminSettingsSection; label: string }[] = [
  { id: "accounts", label: "Contas" },
  { id: "approvals", label: "Aprovações" },
  { id: "users", label: "Usuários" },
  { id: "audit", label: "Auditoria" },
  { id: "reset", label: "Reset de senha" },
  { id: "access", label: "Acesso clientes" },
];

export function SettingsPanel({
  username,
  roleLabel,
  sectorLabel,
  isAdmin,
  apiBase,
  activeSessionCount,
  sessions,
  sessionsLoading,
  revokingSessionId,
  onRevokeSession,
  tab,
  onTabChange,
  pendingCount,
  sectorMenu,
  sectorLabelFn,
  apiFetch,
  profile,
  password,
  admin,
  onLogout,
}: SettingsPanelProps) {
  const clock = useClock();
  const accountNameRef = useRef<HTMLInputElement>(null);
  const { toasts, pushToast, dismissToast } = useSettingsToasts();
  const [confirm, setConfirm] = useState<SettingsConfirmRequest | null>(null);
  const [adminSection, setAdminSection] = useState<AdminSettingsSection>("accounts");
  const [accountSearch, setAccountSearch] = useState("");
  const [pendingSearch, setPendingSearch] = useState("");
  const frontendVersion = "0.1.0";
  const profileTitle = profile.displayName.trim() || username;
  const [passwordTouched, setPasswordTouched] = useState({
    current: false,
    next: false,
    confirm: false,
  });
  const [passwordSubmitAttempted, setPasswordSubmitAttempted] = useState(false);

  const tabs: { id: SettingsTab; label: string; badge?: number }[] = [
    { id: "profile", label: "Perfil" },
    { id: "security", label: "Segurança" },
  ];
  if (isAdmin) {
    tabs.push({ id: "admin", label: "Administração", badge: pendingCount > 0 ? pendingCount : undefined });
  }

  const passwordErrors = useMemo(
    () => getPasswordFieldErrors(password.current, password.next, password.confirm),
    [password.current, password.next, password.confirm],
  );

  const filteredAccounts = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    if (!q) return admin.accounts;
    return admin.accounts.filter(
      (account) =>
        account.name.toLowerCase().includes(q) ||
        account.slug.toLowerCase().includes(q) ||
        (account.bank === "bb" ? "bb banco brasil" : "itau sigra").includes(q),
    );
  }, [admin.accounts, accountSearch]);

  const filteredPending = useMemo(() => {
    const q = pendingSearch.trim().toLowerCase();
    if (!q) return admin.pendingUsers;
    return admin.pendingUsers.filter((user) => {
      const sector = sectorLabelFn(user.requested_sector).toLowerCase();
      return user.username.toLowerCase().includes(q) || sector.includes(q);
    });
  }, [admin.pendingUsers, pendingSearch, sectorLabelFn]);

  const panelBusy =
    profile.busy ||
    password.busy ||
    admin.accountsBusy ||
    admin.busy ||
    admin.pendingActionId !== null ||
    admin.activeUsersLoading ||
    admin.auditLoading ||
    revokingSessionId !== null;

  function notify(tone: SettingsToastTone, message: string) {
    pushToast(tone, message);
  }

  function shouldShowPasswordHint(field: "current" | "next" | "confirm") {
    return passwordSubmitAttempted || passwordTouched[field];
  }

  function openConfirm(
    base: Omit<SettingsConfirmRequest, "onConfirm" | "busy">,
    action: () => Promise<string | void>,
    successFallback?: string,
  ) {
    setConfirm({
      ...base,
      busy: false,
      onConfirm: async () => {
        setConfirm((prev) => (prev ? { ...prev, busy: true } : prev));
        await runSettingsAction(action, pushToast, successFallback);
        setConfirm(null);
      },
    });
  }

  async function handlePasswordSubmit() {
    setPasswordSubmitAttempted(true);
    if (Object.keys(passwordErrors).length > 0) return;
    await runSettingsAction(password.onSubmit, pushToast, "Senha alterada com sucesso.");
    setPasswordSubmitAttempted(false);
    setPasswordTouched({ current: false, next: false, confirm: false });
  }

  async function handleRefreshPending() {
    try {
      await admin.onRefreshPending();
      pushToast("success", "Lista de pendentes atualizada.");
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : "Erro ao atualizar pendentes.");
    }
  }

  function focusAddAccount() {
    setAdminSection("accounts");
    onTabChange("admin");
    window.setTimeout(() => accountNameRef.current?.focus(), 120);
  }

  return (
    <>
      <section
        className={`spatial-settings${panelBusy ? " spatial-settings--busy" : ""}`}
        aria-label="Configurações da conta"
      >
        <header className="spatial-home-top spatial-settings-top">
          <div className="spatial-home-pills">
            <span className="spatial-pill spatial-pill--brand">
              <span className="spatial-pill-dot" aria-hidden="true" />
              KIVO
            </span>
            <span className="spatial-pill">{username}</span>
            <span className="spatial-pill spatial-pill--muted">{roleLabel}</span>
          </div>
          <span className="spatial-pill spatial-pill--time">{clock}</span>
        </header>

        <article className="spatial-glass spatial-settings-hero">
          <div className="spatial-settings-hero-copy">
            <p className="spatial-eyebrow">Preferências do sistema</p>
            <h2 className="spatial-hero-title spatial-settings-hero-title">Configurações</h2>
            <p className="spatial-hero-lead spatial-settings-hero-lead">
              Gerencie perfil, segurança e governança do ambiente em um painel unificado.
            </p>
          </div>
          <div className="spatial-settings-hero-mascot" aria-hidden="true">
            <div className="spatial-hero-mascot-glow" />
            <KivoRobot mood="idle" className="spatial-hero-robot" title="" />
          </div>
        </article>

        {isAdmin && pendingCount > 0 && tab !== "admin" && (
          <button
            type="button"
            className="spatial-settings-alert spatial-settings-alert--action"
            onClick={() => {
              onTabChange("admin");
              setAdminSection("approvals");
            }}
          >
            <span className="spatial-live-dot" aria-hidden="true" />
            <span>
              <strong>{pendingCount} cadastro{pendingCount === 1 ? "" : "s"} aguardando</strong>
              <small>Toque para revisar</small>
            </span>
          </button>
        )}

        <nav className="spatial-settings-nav" role="tablist" aria-label="Seções de configuração">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`spatial-settings-tab${tab === item.id ? " spatial-settings-tab--active" : ""}`}
              onClick={() => onTabChange(item.id)}
            >
              <span className="spatial-settings-tab-icon" aria-hidden="true">
                <TabIcon tab={item.id} />
              </span>
              {item.label}
              {item.badge ? <span className="spatial-settings-tab-badge">{item.badge}</span> : null}
            </button>
          ))}
        </nav>

        <div className="spatial-settings-stage">
          {tab === "profile" && (
            <div key="profile" className="spatial-settings-panel spatial-settings-panel--profile" role="tabpanel">
              <header className="spatial-section-label">
                <div>
                  <span>Perfil da conta</span>
                  <p>Identidade, contato e informações do ambiente.</p>
                </div>
              </header>

              <article className="spatial-glass spatial-settings-profile-card">
                <div className="spatial-settings-profile-head">
                  <div className="spatial-settings-avatar" aria-hidden="true">
                    {profileInitials(profile.displayName, username)}
                  </div>
                  <div>
                    <strong className="spatial-settings-profile-name">{profileTitle}</strong>
                    <p className="spatial-settings-profile-meta">@{username}</p>
                  </div>
                </div>

                <div className="platform-settings-security-form spatial-settings-profile-form">
                  <label className="platform-settings-field">
                    <span className="platform-settings-field-label">Nome de exibição</span>
                    <input
                      type="text"
                      placeholder="Como aparece no sistema"
                      value={profile.displayName}
                      onChange={(e) => profile.onDisplayNameChange(e.target.value)}
                      disabled={profile.busy}
                      maxLength={120}
                    />
                  </label>
                  <label className="platform-settings-field">
                    <span className="platform-settings-field-label">E-mail de contato</span>
                    <input
                      type="email"
                      placeholder="seu@email.com"
                      value={profile.contactEmail}
                      onChange={(e) => profile.onContactEmailChange(e.target.value)}
                      disabled={profile.busy}
                      maxLength={180}
                    />
                  </label>
                </div>

                <div className="spatial-settings-profile-stats">
                  <div className="spatial-stat">
                    <span className="spatial-stat-label">Perfil</span>
                    <strong className="spatial-stat-value spatial-stat-value--text">{roleLabel}</strong>
                  </div>
                  <div className="spatial-stat">
                    <span className="spatial-stat-label">Setor</span>
                    <strong className="spatial-stat-value spatial-stat-value--text">{sectorLabel}</strong>
                  </div>
                  <div className="spatial-stat">
                    <span className="spatial-stat-label">Membro desde</span>
                    <strong className="spatial-stat-value spatial-stat-value--text">
                      {formatProfileDate(profile.createdAt)}
                    </strong>
                  </div>
                  <div className="spatial-stat spatial-stat--active">
                    <span className="spatial-stat-label">Sessões</span>
                    <strong className="spatial-stat-value">
                      {activeSessionCount > 0 ? activeSessionCount : "—"}
                    </strong>
                  </div>
                </div>

                <div className="platform-settings-block-actions">
                  <SettingsLoadingButton
                    className="platform-settings-approve-btn"
                    loading={profile.busy}
                    loadingLabel="Salvando…"
                    onClick={() => runSettingsAction(profile.onSaveProfile, pushToast).catch(() => null)}
                  >
                    Salvar perfil
                  </SettingsLoadingButton>
                </div>
              </article>

              <article className="spatial-glass spatial-settings-form-card">
                <h3 className="spatial-settings-block-title">Notificações por e-mail</h3>
                <p className="spatial-settings-card-desc">
                  {profile.appInfo?.smtp_configured
                    ? "Escolha quais alertas deseja receber. É necessário ter e-mail de contato no perfil."
                    : "SMTP não configurado no servidor — preferências ficam salvas para quando o e-mail estiver ativo."}
                </p>
                <div className="spatial-settings-notify-list">
                  {isAdmin && (
                    <label className="spatial-settings-access-check">
                      <input
                        type="checkbox"
                        checked={profile.notifyEmailPending}
                        onChange={(e) => profile.onNotifyEmailPendingChange(e.target.checked)}
                        disabled={profile.busy}
                      />
                      <span>Novos cadastros aguardando aprovação</span>
                    </label>
                  )}
                  <label className="spatial-settings-access-check">
                    <input
                      type="checkbox"
                      checked={profile.notifyEmailQueue}
                      onChange={(e) => profile.onNotifyEmailQueueChange(e.target.checked)}
                      disabled={profile.busy}
                    />
                    <span>Atualizações da fila de automações</span>
                  </label>
                </div>
                <div className="platform-settings-block-actions">
                  <SettingsLoadingButton
                    className="btn-secondary"
                    loading={profile.busy}
                    loadingLabel="Salvando…"
                    onClick={() => runSettingsAction(profile.onSaveNotifications, pushToast).catch(() => null)}
                  >
                    Salvar preferências
                  </SettingsLoadingButton>
                </div>
              </article>

              <article className="spatial-glass spatial-settings-form-card">
                <h3 className="spatial-settings-block-title">Ambiente</h3>
                <div className="spatial-settings-env-grid">
                  <div>
                    <span className="spatial-stat-label">App</span>
                    <strong className="spatial-stat-value spatial-stat-value--text">v{frontendVersion}</strong>
                  </div>
                  <div>
                    <span className="spatial-stat-label">API</span>
                    <strong className="spatial-stat-value spatial-stat-value--text">
                      v{profile.appInfo?.api_version || "—"}
                    </strong>
                  </div>
                  <div>
                    <span className="spatial-stat-label">Ambiente</span>
                    <strong className="spatial-stat-value spatial-stat-value--text">
                      {profile.appInfo ? envLabel(profile.appInfo.environment) : "—"}
                    </strong>
                  </div>
                </div>
                <div className="spatial-settings-api-row">
                  <div>
                    <span className="spatial-stat-label">API conectada</span>
                    <code className="spatial-settings-api-url">{apiBase}</code>
                  </div>
                  <CopyButton value={apiBase} label="Copiar URL" />
                </div>
              </article>
            </div>
          )}

          {tab === "security" && (
            <div key="security" className="spatial-settings-panel spatial-settings-panel--security" role="tabpanel">
              <header className="spatial-section-label">
                <div>
                  <span>Segurança</span>
                  <p>
                    {activeSessionCount > 1
                      ? `${activeSessionCount} sessões abertas — alterar a senha mantém apenas esta.`
                      : "Atualize sua senha quando necessário."}
                  </p>
                </div>
              </header>

              <article className="spatial-glass spatial-settings-form-card">
                <h3 className="spatial-settings-block-title">Alterar senha</h3>
                <div className="platform-settings-security-form">
                  <label
                    className={`platform-settings-field${
                      shouldShowPasswordHint("current") && passwordErrors.current
                        ? " platform-settings-field--invalid"
                        : ""
                    }`}
                  >
                    <span className="platform-settings-field-label">Senha atual</span>
                    <AuthPasswordField
                      id="settings-current-password"
                      placeholder="Digite a senha atual"
                      value={password.current}
                      visible={password.showCurrent}
                      onToggleVisible={password.onToggleCurrent}
                      autoComplete="current-password"
                      onChange={(v) => {
                        password.onCurrentChange(v);
                        setPasswordTouched((prev) => ({ ...prev, current: true }));
                      }}
                    />
                    {shouldShowPasswordHint("current") && passwordErrors.current && (
                      <p className="settings-field-hint settings-field-hint--error">{passwordErrors.current}</p>
                    )}
                  </label>
                  <label
                    className={`platform-settings-field${
                      shouldShowPasswordHint("next") && passwordErrors.next ? " platform-settings-field--invalid" : ""
                    }`}
                  >
                    <span className="platform-settings-field-label">Nova senha</span>
                    <AuthPasswordField
                      id="settings-new-password"
                      placeholder="Mínimo 6 caracteres"
                      value={password.next}
                      visible={password.showNext}
                      onToggleVisible={password.onToggleNext}
                      autoComplete="new-password"
                      onChange={(v) => {
                        password.onNextChange(v);
                        setPasswordTouched((prev) => ({ ...prev, next: true }));
                      }}
                    />
                    {shouldShowPasswordHint("next") && passwordErrors.next ? (
                      <p className="settings-field-hint settings-field-hint--error">{passwordErrors.next}</p>
                    ) : password.next.length >= 6 && isPasswordStrongEnough(password.next) ? (
                      <p className="settings-field-hint settings-field-hint--ok">Senha forte o suficiente.</p>
                    ) : null}
                    <PasswordStrength password={password.next} />
                  </label>
                  <label
                    className={`platform-settings-field${
                      shouldShowPasswordHint("confirm") && passwordErrors.confirm
                        ? " platform-settings-field--invalid"
                        : ""
                    }`}
                  >
                    <span className="platform-settings-field-label">Confirmar nova senha</span>
                    <AuthPasswordField
                      id="settings-new-password-confirm"
                      placeholder="Repita a nova senha"
                      value={password.confirm}
                      visible={password.showConfirm}
                      onToggleVisible={password.onToggleConfirm}
                      autoComplete="new-password"
                      onChange={(v) => {
                        password.onConfirmChange(v);
                        setPasswordTouched((prev) => ({ ...prev, confirm: true }));
                      }}
                    />
                    {shouldShowPasswordHint("confirm") && passwordErrors.confirm && (
                      <p className="settings-field-hint settings-field-hint--error">{passwordErrors.confirm}</p>
                    )}
                    {password.confirm &&
                      password.next &&
                      password.confirm === password.next &&
                      !passwordErrors.confirm && (
                        <p className="settings-field-hint settings-field-hint--ok">Senhas conferem.</p>
                      )}
                  </label>
                </div>
                <div className="platform-settings-block-actions spatial-settings-form-actions">
                  <SettingsLoadingButton
                    className="platform-settings-approve-btn"
                    loading={password.busy}
                    loadingLabel="Salvando…"
                    disabled={Object.keys(passwordErrors).length > 0}
                    onClick={() => handlePasswordSubmit().catch(() => null)}
                  >
                    Alterar senha
                  </SettingsLoadingButton>
                  {activeSessionCount > 1 && (
                    <SettingsLoadingButton
                      className="btn-secondary"
                      loading={password.busy}
                      loadingLabel="Encerrando…"
                      onClick={() =>
                        openConfirm(
                          {
                            title: "Encerrar outras sessões",
                            message: `Manter apenas esta sessão ativa? As outras ${activeSessionCount - 1} serão desconectadas.`,
                            confirmLabel: "Encerrar sessões",
                            tone: "danger",
                          },
                          password.onLogoutOthers,
                          "Outras sessões encerradas.",
                        )
                      }
                    >
                      Encerrar outras sessões
                    </SettingsLoadingButton>
                  )}
                </div>
              </article>

              <article className="spatial-glass spatial-settings-sessions-card">
                <div className="spatial-settings-card-head">
                  <h3 className="spatial-settings-block-title">Sessões ativas</h3>
                  <span className="spatial-panel-badge">{activeSessionCount}</span>
                </div>
                <p className="spatial-settings-card-desc">
                  Dispositivos conectados à sua conta. Encerre sessões que você não reconhece.
                </p>
                {sessionsLoading ? (
                  <div className="spatial-settings-skeleton-list" aria-hidden="true">
                    <div className="spatial-settings-skeleton" />
                    <div className="spatial-settings-skeleton" />
                  </div>
                ) : sessions.length === 0 ? (
                  <SettingsEmptyState
                    title="Nenhuma sessão ativa"
                    description="Faça login novamente se sua sessão expirou."
                  />
                ) : (
                  <ul className="spatial-settings-sessions-list">
                    {sessions.map((session) => (
                      <li
                        key={session.id}
                        className={`spatial-settings-session-item${
                          session.is_current ? " spatial-settings-session-item--current" : ""
                        }`}
                      >
                        <div>
                          <strong>
                            {session.is_current ? "Este dispositivo" : `Sessão #${session.id}`}
                          </strong>
                          <span>Iniciada em {formatSessionTime(session.created_at)}</span>
                          <span>Expira em {formatSessionTime(session.expires_at)}</span>
                        </div>
                        {session.is_current ? (
                          <span className="spatial-settings-session-badge">Atual</span>
                        ) : (
                          <SettingsLoadingButton
                            className="btn-secondary platform-settings-reject-btn"
                            loading={revokingSessionId === session.id}
                            loadingLabel="Encerrando…"
                            onClick={() =>
                              openConfirm(
                                {
                                  title: "Encerrar sessão",
                                  message: `Desconectar a sessão #${session.id}? O dispositivo precisará fazer login novamente.`,
                                  confirmLabel: "Encerrar",
                                  tone: "danger",
                                },
                                () => onRevokeSession(session.id),
                              )
                            }
                          >
                            Encerrar
                          </SettingsLoadingButton>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </div>
          )}

          {tab === "admin" && isAdmin && (
            <div key="admin" className="spatial-settings-panel spatial-settings-panel--admin" role="tabpanel">
              <header className="spatial-section-label">
                <div>
                  <span>Administração</span>
                  <p>Contas, aprovações e acesso a clientes.</p>
                </div>
                {pendingCount > 0 && (
                  <span className="spatial-live-badge">
                    <span className="spatial-live-dot" aria-hidden="true" />
                    {pendingCount} pendente{pendingCount === 1 ? "" : "s"}
                  </span>
                )}
              </header>

              <nav className="spatial-settings-admin-nav" aria-label="Seções administrativas">
                {ADMIN_SECTIONS.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={`spatial-settings-admin-nav-btn${
                      adminSection === section.id ? " spatial-settings-admin-nav-btn--active" : ""
                    }`}
                    onClick={() => setAdminSection(section.id)}
                  >
                    {section.label}
                    {section.id === "approvals" && pendingCount > 0 ? (
                      <span className="spatial-settings-tab-badge">{pendingCount}</span>
                    ) : null}
                  </button>
                ))}
              </nav>

              {adminSection === "accounts" && (
                <article className="spatial-glass spatial-settings-admin-card">
                  <h3>Contas bancárias</h3>
                  <p className="spatial-settings-card-desc">
                    Cadastre quantas contas precisar por banco (Master 1, Master 2, etc.).
                  </p>
                  <div className="platform-settings-admin-reset-row platform-settings-add-account-row">
                    <label className="platform-settings-field platform-settings-admin-reset-input">
                      <span className="platform-settings-field-label">Banco</span>
                      <select
                        className="platform-settings-select"
                        value={admin.newBank}
                        onChange={(e) => admin.onNewBankChange(e.target.value as BankKey)}
                        disabled={admin.accountsBusy}
                      >
                        <option value="bb">Banco do Brasil</option>
                        <option value="itau_sigra">Itaú / SIGRA</option>
                      </select>
                    </label>
                    <label className="platform-settings-field platform-settings-admin-reset-input">
                      <span className="platform-settings-field-label">Nome da conta</span>
                      <input
                        ref={accountNameRef}
                        type="text"
                        placeholder="Ex.: Master 1"
                        value={admin.newName}
                        onChange={(e) => admin.onNewNameChange(e.target.value)}
                        disabled={admin.accountsBusy}
                      />
                    </label>
                    <SettingsLoadingButton
                      className="platform-settings-approve-btn platform-settings-generate-link"
                      loading={admin.accountsBusy}
                      loadingLabel="Salvando…"
                      disabled={!admin.newName.trim()}
                      onClick={() => runSettingsAction(admin.onCreateAccount, pushToast).catch(() => null)}
                    >
                      Adicionar
                    </SettingsLoadingButton>
                  </div>

                  {admin.accounts.length > 0 && (
                    <label className="platform-settings-field spatial-settings-search">
                      <span className="platform-settings-field-label">Buscar conta</span>
                      <input
                        type="search"
                        placeholder="Nome, slug ou banco…"
                        value={accountSearch}
                        onChange={(e) => setAccountSearch(e.target.value)}
                      />
                    </label>
                  )}

                  {admin.accounts.length === 0 ? (
                    <SettingsEmptyState
                      title="Nenhuma conta cadastrada"
                      description="Adicione a primeira conta bancária para usar nas automações de conciliação."
                      actionLabel="Cadastrar conta"
                      onAction={focusAddAccount}
                    />
                  ) : filteredAccounts.length === 0 ? (
                    <p className="spatial-settings-list-empty">Nenhuma conta corresponde à busca.</p>
                  ) : (
                    <ul className="spatial-settings-list">
                      {filteredAccounts.map((account) => (
                        <li key={account.id} className="spatial-settings-list-item">
                          <div>
                            <strong>{account.name}</strong>
                            <span>
                              {account.bank === "bb" ? "BB" : "Itaú"} · {account.slug}
                              {Number(account.is_active) !== 1 ? " · inativa" : " · ativa"}
                            </span>
                          </div>
                          {Number(account.is_active) === 1 ? (
                            <SettingsLoadingButton
                              className="btn-secondary platform-settings-reject-btn"
                              loading={admin.accountsBusy}
                              onClick={() =>
                                openConfirm(
                                  {
                                    title: "Desativar conta",
                                    message: `A conta "${account.name}" ficará indisponível nas automações até ser reativada.`,
                                    confirmLabel: "Desativar",
                                    tone: "danger",
                                  },
                                  () => admin.onDeactivateAccount(account.id),
                                )
                              }
                            >
                              Desativar
                            </SettingsLoadingButton>
                          ) : (
                            <SettingsLoadingButton
                              className="platform-settings-approve-btn"
                              loading={admin.accountsBusy}
                              onClick={() =>
                                runSettingsAction(
                                  () => admin.onReactivateAccount(account.id),
                                  pushToast,
                                ).catch(() => null)
                              }
                            >
                              Reativar
                            </SettingsLoadingButton>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              )}

              {adminSection === "approvals" && (
                <article className="spatial-glass spatial-settings-admin-card">
                  <div className="spatial-settings-card-head">
                    <h3>Cadastros pendentes</h3>
                    <SettingsLoadingButton
                      className="btn-secondary platform-settings-refresh"
                      loading={admin.pendingLoading}
                      loadingLabel="Atualizando…"
                      onClick={() => handleRefreshPending().catch(() => null)}
                    >
                      Atualizar
                    </SettingsLoadingButton>
                  </div>

                  {admin.pendingUsers.length > 0 && (
                    <label className="platform-settings-field spatial-settings-search">
                      <span className="platform-settings-field-label">Buscar usuário</span>
                      <input
                        type="search"
                        placeholder="Usuário ou setor…"
                        value={pendingSearch}
                        onChange={(e) => setPendingSearch(e.target.value)}
                      />
                    </label>
                  )}

                  {admin.pendingLoading ? (
                    <div className="spatial-settings-skeleton-list" aria-hidden="true">
                      <div className="spatial-settings-skeleton" />
                      <div className="spatial-settings-skeleton" />
                    </div>
                  ) : admin.pendingUsers.length === 0 ? (
                    <SettingsEmptyState
                      title="Nenhuma solicitação pendente"
                      description="Novos cadastros aparecerão aqui para aprovação ou recusa."
                    />
                  ) : filteredPending.length === 0 ? (
                    <p className="spatial-settings-list-empty">Nenhum cadastro corresponde à busca.</p>
                  ) : (
                    <ul className="spatial-settings-list">
                      {filteredPending.map((user) => (
                        <li key={user.id} className="spatial-settings-list-item spatial-settings-list-item--stack">
                          <div>
                            <strong>{user.username}</strong>
                            <span>
                              {sectorLabelFn(user.requested_sector)} ·{" "}
                              {new Date(user.created_at).toLocaleString("pt-BR")}
                            </span>
                          </div>
                          <div className="platform-settings-pending-actions">
                            <label className="platform-settings-pending-sector">
                              <span>Setor liberado</span>
                              <select
                                className="platform-settings-select platform-settings-sector-select"
                                value={admin.approvalSectorByUser[user.id] || user.requested_sector}
                                onChange={(e) =>
                                  admin.onApprovalSectorChange(user.id, e.target.value as SectorKey)
                                }
                                disabled={admin.pendingActionId === user.id}
                              >
                                {sectorMenu.map((sector) => (
                                  <option key={sector.key} value={sector.key}>
                                    {sector.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <SettingsLoadingButton
                              className="platform-settings-approve-btn"
                              loading={admin.pendingActionId === user.id}
                              loadingLabel="Aprovando…"
                              onClick={() =>
                                runSettingsAction(
                                  () => admin.onApproveUser(user.id),
                                  pushToast,
                                  "Cadastro aprovado.",
                                ).catch(() => null)
                              }
                            >
                              Aprovar
                            </SettingsLoadingButton>
                            <SettingsLoadingButton
                              className="btn-secondary platform-settings-reject-btn"
                              loading={admin.pendingActionId === user.id}
                              onClick={() =>
                                openConfirm(
                                  {
                                    title: "Recusar cadastro",
                                    message: `Recusar a solicitação de "${user.username}"? Essa ação não pode ser desfeita.`,
                                    confirmLabel: "Recusar",
                                    tone: "danger",
                                  },
                                  () => admin.onRejectUser(user.id),
                                  "Cadastro recusado.",
                                )
                              }
                            >
                              Recusar
                            </SettingsLoadingButton>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              )}

              {adminSection === "users" && (
                <article className="spatial-glass spatial-settings-admin-card">
                  <div className="spatial-settings-admin-card-head">
                    <div>
                      <h3>Usuários ativos</h3>
                      <p className="spatial-settings-card-desc">
                        Contas aprovadas com acesso ao sistema.
                      </p>
                    </div>
                    <SettingsLoadingButton
                      className="btn-secondary"
                      loading={admin.activeUsersLoading}
                      loadingLabel="Atualizando…"
                      onClick={() => runSettingsAction(admin.onRefreshUsers, pushToast, "Lista atualizada.").catch(() => null)}
                    >
                      Atualizar
                    </SettingsLoadingButton>
                  </div>
                  <label className="platform-settings-field spatial-settings-search">
                    <span className="platform-settings-field-label">Buscar usuário</span>
                    <input
                      type="search"
                      placeholder="Nome, e-mail ou setor…"
                      value={admin.userSearch}
                      onChange={(e) => admin.onUserSearchChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void admin.onRefreshUsers();
                        }
                      }}
                    />
                  </label>
                  {admin.activeUsersLoading && admin.activeUsers.length === 0 ? (
                    <div className="spatial-settings-skeleton" aria-hidden="true" />
                  ) : admin.activeUsers.length === 0 ? (
                    <SettingsEmptyState
                      title="Nenhum usuário encontrado"
                      description="Ajuste a busca ou atualize a lista."
                    />
                  ) : (
                    <ul className="spatial-settings-list spatial-settings-user-list">
                      {admin.activeUsers.map((user) => (
                        <li key={user.id} className="spatial-settings-list-item">
                          <div>
                            <strong>{user.display_name.trim() || user.username}</strong>
                            <span>@{user.username}</span>
                            {user.contact_email ? <span>{user.contact_email}</span> : null}
                            <span>
                              {sectorLabelFn(user.sector)} · {user.role === "admin" ? "Administrador" : "Operador"}
                            </span>
                          </div>
                          <span className="spatial-settings-user-since">
                            Desde {formatProfileDate(user.created_at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              )}

              {adminSection === "audit" && (
                <article className="spatial-glass spatial-settings-admin-card">
                  <div className="spatial-settings-admin-card-head">
                    <div>
                      <h3>Auditoria</h3>
                      <p className="spatial-settings-card-desc">
                        Registro das ações administrativas e de segurança recentes.
                      </p>
                    </div>
                    <SettingsLoadingButton
                      className="btn-secondary"
                      loading={admin.auditLoading}
                      loadingLabel="Atualizando…"
                      onClick={() => runSettingsAction(admin.onRefreshAudit, pushToast, "Auditoria atualizada.").catch(() => null)}
                    >
                      Atualizar
                    </SettingsLoadingButton>
                  </div>
                  {admin.auditLoading && admin.auditLog.length === 0 ? (
                    <div className="spatial-settings-skeleton" aria-hidden="true" />
                  ) : admin.auditLog.length === 0 ? (
                    <SettingsEmptyState
                      title="Nenhum evento registrado"
                      description="As ações passam a aparecer aqui conforme o uso do sistema."
                    />
                  ) : (
                    <ul className="spatial-settings-audit-list">
                      {admin.auditLog.map((entry) => (
                        <li key={entry.id} className="spatial-settings-audit-item">
                          <div className="spatial-settings-audit-main">
                            <strong>{auditActionLabel(entry.action)}</strong>
                            <span>
                              {entry.target_label}
                              {entry.details ? ` · ${entry.details}` : ""}
                            </span>
                          </div>
                          <div className="spatial-settings-audit-meta">
                            <span>{entry.actor_username}</span>
                            <time dateTime={entry.created_at}>{formatSessionTime(entry.created_at)}</time>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              )}

              {adminSection === "reset" && (
                <article className="spatial-glass spatial-settings-admin-card">
                  <h3>Link de redefinição</h3>
                  <p className="spatial-settings-card-desc">Válido por 1 hora — envie ao usuário por canal interno.</p>
                  <div className="platform-settings-admin-reset-row">
                    <label className="platform-settings-field platform-settings-admin-reset-input">
                      <span className="platform-settings-field-label">Usuário</span>
                      <input
                        type="text"
                        placeholder="Nome de login"
                        value={admin.lookupUsername}
                        onChange={(e) => admin.onLookupUsernameChange(e.target.value)}
                        disabled={admin.busy}
                      />
                    </label>
                    <SettingsLoadingButton
                      className="btn-secondary platform-settings-generate-link"
                      loading={admin.busy}
                      loadingLabel="Gerando…"
                      disabled={!admin.lookupUsername.trim()}
                      onClick={() => runSettingsAction(admin.onGenerateResetLink, pushToast).catch(() => null)}
                    >
                      Gerar link
                    </SettingsLoadingButton>
                  </div>
                  {admin.resetLink && (
                    <div className="platform-settings-reset-link-box">
                      <span className="platform-settings-label">{admin.resetLinkFor}</span>
                      <div className="spatial-settings-reset-link-row">
                        <a href={admin.resetLink} className="platform-settings-reset-link-url">
                          {admin.resetLink}
                        </a>
                        <CopyButton value={admin.resetLink} label="Copiar" />
                      </div>
                    </div>
                  )}
                </article>
              )}

              {adminSection === "access" && (
                <article className="spatial-glass spatial-settings-admin-card spatial-settings-admin-card--wide">
                  <AutomationClientAccessPanel apiFetch={apiFetch} onNotify={notify} />
                </article>
              )}
            </div>
          )}
        </div>

        <footer className="spatial-settings-footer">
          <button
            type="button"
            className="spatial-settings-logout"
            onClick={() =>
              openConfirm(
                {
                  title: "Sair da conta",
                  message: "Encerrar sua sessão neste dispositivo? Você precisará fazer login novamente.",
                  confirmLabel: "Sair",
                  tone: "danger",
                },
                async () => {
                  await onLogout();
                },
                "Sessão encerrada.",
              )
            }
          >
            Sair da conta
          </button>
        </footer>
      </section>

      <SettingsToastStack toasts={toasts} onDismiss={dismissToast} />
      <SettingsConfirmModal request={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
