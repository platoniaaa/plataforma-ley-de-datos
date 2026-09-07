"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui";
import { historialPregunta, type EntradaHistorial } from "./historial-actions";

const ORIGEN: Record<string, { etiqueta: string; color: "slate" | "blue" | "green" }> = {
  oficial: { etiqueta: "Respuesta oficial", color: "blue" },
  aporte: { etiqueta: "Aporte", color: "slate" },
  evidencia: { etiqueta: "Evidencia", color: "green" },
};

const OPERACION: Record<string, string> = {
  INSERT: "creó",
  UPDATE: "modificó",
  DELETE: "eliminó",
};

function fechaLegible(iso: string): string {
  return new Date(iso).toLocaleString("es-CL", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Recorta los textos largos para que la bitácora siga siendo legible de un vistazo. */
function recortar(t: string | null): string {
  if (t == null) return "—";
  return t.length > 120 ? `${t.slice(0, 120)}…` : t;
}

export function HistorialPregunta({ respuestaId }: { respuestaId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [entradas, setEntradas] = useState<EntradaHistorial[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function alternar() {
    if (abierto) { setAbierto(false); return; }
    setAbierto(true);
    // Se carga la primera vez que se abre: no tiene sentido traer el historial de
    // todas las preguntas al pintar la página.
    if (entradas === null) {
      startTransition(async () => {
        const res = await historialPregunta(respuestaId);
        if (res.ok) setEntradas(res.entradas ?? []);
        else setError(res.error ?? "No se pudo cargar el historial.");
      });
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={alternar}
        className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-brand-600 hover:underline"
      >
        {abierto ? "Ocultar historial" : "Ver historial de cambios"}
      </button>

      {abierto && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          {pending && <p className="text-xs text-slate-400">Cargando…</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {!pending && !error && entradas?.length === 0 && (
            <p className="text-xs text-slate-400">
              Sin cambios registrados. La bitácora guarda lo ocurrido desde su puesta en marcha.
            </p>
          )}
          {!pending && entradas && entradas.length > 0 && (
            <ol className="space-y-3">
              {entradas.map((e, i) => (
                <li key={i} className="border-l-2 border-slate-200 pl-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge color={ORIGEN[e.origen].color}>{ORIGEN[e.origen].etiqueta}</Badge>
                    <span className="text-xs font-medium text-slate-700">{e.autor}</span>
                    <span className="text-xs text-slate-400">
                      {OPERACION[e.operacion] ?? e.operacion} · {fechaLegible(e.fecha)}
                    </span>
                  </div>
                  {e.cambios.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {e.cambios.map((c, j) => (
                        <li key={j} className="text-xs text-slate-600">
                          <span className="font-medium text-slate-500">{c.campo}:</span>{" "}
                          <span className="text-slate-400 line-through">{recortar(c.antes)}</span>{" "}
                          <span className="text-slate-400">→</span>{" "}
                          <span className="text-slate-700">{recortar(c.despues)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
