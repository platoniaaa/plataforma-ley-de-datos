"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select } from "@/components/ui";
import { configurarDiagnosticoAction } from "../../actions";

type Usuario = { id: string; nombre: string; cargo: string | null };
type Opcion = { id: string; nombre: string };
type DomCfg = {
  ddId: string;
  orden: number;
  nombre: string;
  incluido: boolean;
  participantesIds: string[];
  responsablesEvidenciaIds: string[];
  areaId: string;
  justificacionNoAplica: string;
};

export function ConfigurarForm({
  diagnosticoId,
  dominios: dominiosInit,
  usuarios,
  areas,
}: {
  diagnosticoId: string;
  dominios: DomCfg[];
  usuarios: Usuario[];
  areas: Opcion[];
}) {
  const router = useRouter();
  const [dominios, setDominios] = useState(dominiosInit);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Dominio cuyo panel de participantes está abierto (uno a la vez).
  const [abierto, setAbierto] = useState<string | null>(null);

  function set(ddId: string, patch: Partial<DomCfg>) {
    setDominios((prev) => prev.map((d) => (d.ddId === ddId ? { ...d, ...patch } : d)));
  }

  function toggleParticipante(ddId: string, userId: string) {
    setDominios((prev) =>
      prev.map((d) => {
        if (d.ddId !== ddId) return d;
        const esParticipante = d.participantesIds.includes(userId);
        return {
          ...d,
          participantesIds: esParticipante
            ? d.participantesIds.filter((x) => x !== userId)
            : [...d.participantesIds, userId],
          // Al quitar como participante, también deja de ser responsable de evidencia.
          responsablesEvidenciaIds: esParticipante
            ? d.responsablesEvidenciaIds.filter((x) => x !== userId)
            : d.responsablesEvidenciaIds,
        };
      })
    );
  }

  function toggleResponsable(ddId: string, userId: string) {
    setDominios((prev) =>
      prev.map((d) =>
        d.ddId === ddId
          ? {
              ...d,
              responsablesEvidenciaIds: d.responsablesEvidenciaIds.includes(userId)
                ? d.responsablesEvidenciaIds.filter((x) => x !== userId)
                : [...d.responsablesEvidenciaIds, userId],
            }
          : d
      )
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const res = await configurarDiagnosticoAction({
        diagnosticoId,
        dominios: dominios.map((d) => ({
          diagnosticoDominioId: d.ddId,
          incluido: d.incluido,
          participantesIds: d.participantesIds,
          responsablesEvidenciaIds: d.responsablesEvidenciaIds,
          areaId: d.areaId,
          justificacionNoAplica: d.justificacionNoAplica,
        })),
      });
      if (res.ok) {
        setMsg({ ok: true, text: "Configuración guardada" });
        setAbierto(null);
        router.refresh();
      } else setMsg({ ok: false, text: res.error ?? "Error" });
    });
  }

  const nombreDe = (id: string) => usuarios.find((u) => u.id === id)?.nombre ?? "—";

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <p className="text-sm text-slate-500">
        Todos los participantes de un dominio responden ese dominio por igual. Con el botón{" "}
        <span className="rounded-full border border-orange-300 bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700">
          📎 evidencia
        </span>{" "}
        marca quién está a cargo de subir la evidencia (designación organizativa; no cambia la
        regla de envío).
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Incl.</th>
              <th className="px-4 py-3 font-medium">Dominio</th>
              <th className="px-4 py-3 font-medium">Participantes</th>
              <th className="px-4 py-3 font-medium">Área</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dominios.map((d) => (
              <tr key={d.ddId} className={d.incluido ? "" : "bg-slate-50/50"}>
                <td className="px-4 py-3 align-top">
                  <input
                    type="checkbox"
                    checked={d.incluido}
                    onChange={(e) => set(d.ddId, { incluido: e.target.checked })}
                    className="h-4 w-4 accent-brand-600"
                  />
                </td>
                <td className="px-4 py-3 align-top">
                  <span className="mr-2 text-xs text-slate-400">D{d.orden}</span>
                  <span className="text-slate-800">{d.nombre}</span>
                  {!d.incluido && (
                    <Input
                      value={d.justificacionNoAplica}
                      onChange={(e) => set(d.ddId, { justificacionNoAplica: e.target.value })}
                      placeholder="Justificación de no aplicabilidad"
                      className="mt-2 h-8 text-xs"
                    />
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <button
                    type="button"
                    onClick={() => setAbierto(abierto === d.ddId ? null : d.ddId)}
                    disabled={!d.incluido}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:border-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {d.participantesIds.length === 0
                      ? "Seleccionar participantes…"
                      : `${d.participantesIds.length} seleccionados`}
                  </button>

                  {d.participantesIds.length > 0 && (
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                      {d.participantesIds.map(nombreDe).join(", ")}
                      {d.responsablesEvidenciaIds.length > 0 && (
                        <span className="font-medium text-orange-600">
                          {" "}· 📎 {d.responsablesEvidenciaIds.length} de evidencia
                        </span>
                      )}
                    </p>
                  )}

                  {abierto === d.ddId && (
                    <div className="mt-2 max-h-60 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
                      {usuarios.map((u) => {
                        const esParticipante = d.participantesIds.includes(u.id);
                        const esResponsable = d.responsablesEvidenciaIds.includes(u.id);
                        return (
                          <div
                            key={u.id}
                            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50"
                          >
                            <label className="flex flex-1 cursor-pointer items-center gap-2">
                              <input
                                type="checkbox"
                                checked={esParticipante}
                                onChange={() => toggleParticipante(d.ddId, u.id)}
                                className="h-4 w-4 accent-brand-600"
                              />
                              <span className="text-slate-700">{u.nombre}</span>
                              {u.cargo && u.cargo !== u.nombre && (
                                <span className="text-xs text-slate-400">· {u.cargo}</span>
                              )}
                            </label>
                            {esParticipante && (
                              <button
                                type="button"
                                onClick={() => toggleResponsable(d.ddId, u.id)}
                                title="Responsable de subir la evidencia de este dominio"
                                className={
                                  "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors " +
                                  (esResponsable
                                    ? "border-orange-300 bg-orange-100 text-orange-700"
                                    : "border-slate-200 text-slate-400 hover:border-orange-300 hover:text-orange-600")
                                }
                              >
                                📎 evidencia
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <Select
                    value={d.areaId}
                    onChange={(e) => set(d.ddId, { areaId: e.target.value })}
                    className="h-9"
                    disabled={!d.incluido}
                  >
                    <option value="">—</option>
                    {areas.map((a) => (
                      <option key={a.id} value={a.id}>{a.nombre}</option>
                    ))}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar configuración"}
        </Button>
        {msg && <span className={msg.ok ? "text-sm text-green-600" : "text-sm text-red-600"}>{msg.text}</span>}
      </div>
    </form>
  );
}
