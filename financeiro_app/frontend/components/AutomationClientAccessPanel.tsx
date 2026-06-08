"use client";

import { useCallback, useEffect, useState } from "react";

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
};

export function AutomationClientAccessPanel({ apiFetch }: AutomationClientAccessPanelProps) {
  const [lookupUsername, setLookupUsername] = useState("");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [clients, setClients] = useState<AutomationClient[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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
    setError("");
    setMessage("");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao buscar usuário.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!user) return;
    setBusy(true);
    setError("");
    setMessage("");
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
      setMessage(`Acesso de clientes atualizado para ${user.username}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar.");
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
    <div className="platform-settings-admin-section">
      <h4>Acesso a clientes (Operações)</h4>
      <p className="platform-settings-block-desc">
        Defina quais clientes cada usuário pode ver quando a automação tem visibilidade <b>cliente</b>.
      </p>

      <form className="platform-settings-admin-reset-row" onSubmit={handleLookup}>
        <label className="platform-settings-field platform-settings-admin-reset-input">
          <span className="platform-settings-field-label">Usuário</span>
          <input
            type="text"
            placeholder="nome de usuário"
            value={lookupUsername}
            onChange={(e) => setLookupUsername(e.target.value)}
          />
        </label>
        <button type="submit" className="platform-settings-approve-btn" disabled={busy}>
          Buscar
        </button>
      </form>

      {user && (
        <div className="platform-automation-access-grid">
          <p className="subtitle">
            <b>{user.username}</b> · setor {user.sector}
          </p>

          {impoClients.length > 0 && (
            <div className="platform-automation-access-flow">
              <strong>Importação</strong>
              {impoClients.map((client) => (
                <label key={client.id} className="platform-automation-access-check">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(client.id)}
                    onChange={() => toggleClient(client.id)}
                  />
                  {client.name}
                </label>
              ))}
            </div>
          )}

          {expoClients.length > 0 && (
            <div className="platform-automation-access-flow">
              <strong>Exportação</strong>
              {expoClients.map((client) => (
                <label key={client.id} className="platform-automation-access-check">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(client.id)}
                    onChange={() => toggleClient(client.id)}
                  />
                  {client.name}
                </label>
              ))}
            </div>
          )}

          <button type="button" className="platform-settings-approve-btn" disabled={busy} onClick={handleSave}>
            Salvar acesso
          </button>
        </div>
      )}

      {error && <p className="platform-settings-feedback platform-settings-feedback--error">{error}</p>}
      {message && <p className="platform-settings-feedback platform-settings-feedback--ok">{message}</p>}
    </div>
  );
}
