export type SettingsTab = "profile" | "security" | "admin";
export type AdminSettingsSection = "accounts" | "approvals" | "reset" | "access" | "users" | "audit";

const TAB_TO_SLUG: Record<SettingsTab, string> = {
  profile: "perfil",
  security: "seguranca",
  admin: "administracao",
};

const SLUG_TO_TAB: Record<string, SettingsTab> = {
  perfil: "profile",
  seguranca: "security",
  administracao: "admin",
};

export function settingsTabFromSlug(slug: string | null | undefined): SettingsTab | null {
  if (!slug) return null;
  return SLUG_TO_TAB[slug.toLowerCase()] ?? null;
}

export function settingsTabToSlug(tab: SettingsTab): string {
  return TAB_TO_SLUG[tab];
}

export function buildSettingsUrl(tab: SettingsTab): string {
  return `?view=configuracoes&tab=${settingsTabToSlug(tab)}`;
}

export function readSettingsTabFromLocation(): SettingsTab | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") !== "configuracoes") return null;
  return settingsTabFromSlug(params.get("tab"));
}

export function syncSettingsUrl(tab: SettingsTab) {
  if (typeof window === "undefined") return;
  const next = buildSettingsUrl(tab);
  const current = `${window.location.search}`;
  if (current === next) return;
  window.history.replaceState({}, "", next);
}

/** Remove ?view=… da barra de endereço (evita F5/login cair em Configurações por engano). */
export function clearPlatformViewQuery() {
  if (typeof window === "undefined") return;
  if (!window.location.search) return;
  window.history.replaceState({}, "", window.location.pathname);
}

export function syncActiveViewUrl(view: string, settingsTab: SettingsTab) {
  if (typeof window === "undefined") return;
  if (view === "configuracoes") {
    syncSettingsUrl(settingsTab);
    return;
  }
  if (view === "fila") {
    const next = "?view=fila";
    if (window.location.search !== next) {
      window.history.replaceState({}, "", next);
    }
    return;
  }
  clearPlatformViewQuery();
}
