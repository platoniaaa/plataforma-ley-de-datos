"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clasificarEvidencia } from "./actions";

/**
 * Selector de "qué evidencia mínima cubre este documento".
 *
 * Es el gesto que convierte un archivo suelto en cobertura verificable, y el mismo que
 * más adelante va a venir prellenado por el análisis automático del documento: aquí el
 * consultor confirmará o corregirá en vez de elegir desde cero.
 */
export function ClasificarEvidencia({
  evidenciaId,
  actual,
  opciones,
  yaUsadas,
}: {
  evidenciaId: string;
  actual: string | null;
  opciones: string[];
  /** Evidencias que ya cubre otro documento del dominio: se marcan para no duplicar. */
  yaUsadas: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function cambiar(valor: string) {
    setError(null);
    startTransition(async () => {
      const res = await clasificarEvidencia({ evidenciaId, cubreEvidencia: valor });
      if (!res.ok) setError(res.error ?? "No se pudo guardar.");
      else router.refresh();
    });
  }

  return (
    <div className="mt-1.5">
      <select
        value={actual ?? ""}
        disabled={pending}
        onChange={(e) => cambiar(e.target.value)}
        className={`w-full max-w-md rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-50 ${
          actual ? "border-slate-300 text-slate-700" : "border-dashed border-slate-300 text-slate-400"
        }`}
      >
        <option value="">{pending ? "Guardando…" : "— Sin clasificar: ¿qué evidencia cubre?"}</option>
        {opciones.map((o) => (
          <option key={o} value={o}>
            {o}
            {o !== actual && yaUsadas.includes(o) ? "  (ya cubierta)" : ""}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
