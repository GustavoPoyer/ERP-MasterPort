"use client";

import { useCallback, useEffect, useState } from "react";
import { SettingsLoadingButton } from "./settings/SettingsLoadingButton";
import type { SettingsToastTone } from "./settings/useSettingsToasts";

type AutomationClient = {
  id: number;
  sector: string;
  flow: string;
  slug: string;
  name: string;
};

type UserProfile = {
  id: number;
  username: string;
  sector: string;
};

type AutomationClientAccessPanelProps = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onNotify?: (tone: SettingsToastTone, message: string) => void;
};

export function AutomationClientAccessPanel({ apiFetch, onNotify }: AutomationClientAccessPanelProps) {
  const [lookupUsername, setLookupUsername] = useState("");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [clients, setClients] = useState<AutomationClient[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const loadClients = useCallback(async () => {
    const [impoRes, expoRes] = await Promise.all([
      apiFetch("/automation-clients?sector=operacoes&flow=importacao"),
      apiFetch("/automation-clients?sector=operacoes&flow=exportacao"),
    ]);
    const impo = impoRes.ok ? ((await impoRes.json()) as AutomationClient[]) : [];
    const expo = expoRes.ok ? ((await expoRes.json()) as AutomationClient[]) : [];
    setClients([...impo, ...expo]);
  }, [apiFetch]);

  useEffect(() => {
    loadClients().catch(() => null);
  }, [loadClients]);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    setUser(null);
    setSelectedIds([]);
    setBusy(true);
    try {
      const res = await apiFetch(
        `/auth/admin/users/lookup?username=${encodeURIComponent(lookupUsername.trim())}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.detail || "Usuário não encontrado.");
      }
      const profile = (await res.json()) as UserProfile;
      setUser(profile);

      const accessRes = await apiFetch(`/automation-clients/users/${profile.id}/access`);
      if (accessRes.ok) {
        const access = (await accessRes.json()) as { client_ids: number[] };
        setSelectedIds(access.client_ids ?? []);
      }
      onNotify?.("success", `Usuário ${profile.username} carregado.`);
    } catch (err) {
      onNotify?.("error", err instanceof Error ? err.message : "Erro ao buscar usuário.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!user) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/automation-clients/users/${user.id}/access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_ids: selectedIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.detail || "Não foi possível salvar.");
      }
      onNotify?.("success", `Acesso de clientes atualizado para ${user.username}.`);
    } catch (err) {
      onNotify?.("error", err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  function toggleClient(id: number) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const impoClients = clients.filter((c) => c.flow === "importacao");
  const expoClients = clients.filter((c) => c.flow === "exportacao");

  return (
    <div className="spatial-settings-access-panel">
      <h3>Acesso a clientes (Operações)</h3>
      <p className="spatial-settings-card-desc">
        Restringe quais clientes o usuário enxerga em automações com visibilidade <b>cliente</b>.
        Se nunca salvou aqui, o usuário do setor Operações vê todos os clientes.
      </p>

      <form className="platform-settings-admin-reset-row" onSubmit={handleLookup}>
        <label className="platform-settings-field platform-settings-admin-reset-input">
          <span className="platform-settings-field-label">Usuário</span>
          <input
            type="text"
            placeholder="nome de usuário"
            value={lookupUsername}
            onChange={(e) => setLookupUsername(e.target.value)}
            disabled={busy}
          />
        </label>
        <SettingsLoadingButton type="submit" className="platform-settings-approve-btn" loading={busy} loadingLabel="Buscando…">
          Buscar
        </SettingsLoadingButton>
      </form>

      {user && (
        <div className="spatial-settings-access-grid">
          <p className="spatial-settings-access-user">
            <strong>{user.username}</strong>
            <span>setor {user.sector}</span>
          </p>

          {impoClients.length > 0 && (
            <div className="spatial-settings-access-flow">
              <strong>Importação</strong>
              {impoClients.map((client) => (
                <label key={client.id} className="spatial-settings-access-check">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(client.id)}
                    onChange={() => toggleClient(client.id)}
                    disabled={busy}
                  />
                  {client.name}
                </label>
              ))}
            </div>
          )}

          {expoClients.length > 0 && (
            <div className="spatial-settings-access-flow">
              <strong>Exportação</strong>
              {expoClients.map((client) => (
                <label key={client.id} className="spatial-settings-access-check">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(client.id)}
                    onChange={() => toggleClient(client.id)}
                    disabled={busy}
                  />
                  {client.name}
                </label>
              ))}
            </div>
          )}

          <SettingsLoadingButton
            type="button"
            className="platform-settings-approve-btn"
            loading={busy}
            loadingLabel="Salvando…"
            onClick={() => handleSave().catch(() => null)}
          >
            Salvar acesso
          </SettingsLoadingButton>
        </div>
      )}
    </div>
  );
}
