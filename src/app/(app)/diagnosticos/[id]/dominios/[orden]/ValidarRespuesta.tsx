"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea } from "@/components/ui";
import { validarRespuesta, observarRespuesta, quitarValidacion } from "./validacion-actions";

/**
 * Controles de revisión de una pregunta. Los ve quien revisa el levantamiento: el equipo
 * consultor, y la contraparte del cliente que lleva el control interno.
 *
 * Están disponibles en cualquier momento y no solo con el dominio ya enviado: dejar una
 * observación mientras se trabaja el cuestionario es justamente cuando más sirve.
 */
export function ValidarRespuesta({
  respuestaId,
  estado,
}: {
  respuestaId: string;
  estado: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [escribiendo, setEscribiendo] = useState(false);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);

  function validar() {
    setError(null);
    startTransition(async () => {
      const res = await validarRespuesta(respuestaId);
      if (res.ok) router.refresh();
      else setError(res.error ?? "No se pudo validar.");
    });
  }

  function quitar() {
    setError(null);
    startTransition(async () => {
      const res = await quitarValidacion(respuestaId);
      if (res.ok) router.refresh();
      else setError(res.error ?? "No se pudo quitar la validación.");
    });
  }

  function observar() {
    setError(null);
    startTransition(async () => {
      const res = await observarRespuesta({ respuestaId, observacion: texto });
      if (res.ok) {
        setEscribiendo(false);
        setTexto("");
        router.refresh();
      } else setError(res.error ?? "No se pudo guardar la observación.");
    });
  }

  if (escribiendo) {
    return (
      <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-orange-700">
          Qué hay que corregir
        </p>
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Ej: la política adjunta es de 2019 y no menciona la Ley 21.719."
        />
        <p className="mt-1 text-xs text-orange-700">
          El participante verá este texto y podrá corregir esta pregunta, aunque el resto del
          dominio siga en solo lectura.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={observar} disabled={pending || texto.trim().length < 3}>
            {pending ? "Guardando…" : "Devolver al participante"}
          </Button>
          <button
            type="button"
            onClick={() => {
              setEscribiendo(false);
              setError(null);
            }}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Cancelar
          </button>
        </div>
        {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {estado !== "VALIDADA" && (
        <Button size="sm" onClick={validar} disabled={pending}>
          {pending ? "Guardando…" : "Validar"}
        </Button>
      )}
      <button
        type="button"
        onClick={() => setEscribiendo(true)}
        disabled={pending}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-orange-500 hover:text-orange-700 disabled:opacity-50"
      >
        {estado === "OBSERVADA" ? "Cambiar la observación" : "Observar"}
      </button>
      {estado === "VALIDADA" && (
        <>
          <button
            type="button"
            onClick={quitar}
            disabled={pending}
            className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-700 disabled:opacity-50"
          >
            Quitar validación
          </button>
          <span className="text-xs text-green-600">Respuesta validada.</span>
        </>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
