"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { cerrarDominio, reabrirDominio, validarTodas, deshacerValidaciones } from "./validacion-actions";

/**
 * Cierre del dominio por parte de quien lo revisa, y su contrapeso: reabrirlo.
 *
 * Reabrir estaba solo en un script de consola, y era lo único que permitía recoger el
 * trabajo de quien quedó fuera cuando un participante envió el dominio antes de tiempo.
 */
export function ValidacionDominio({
  diagnosticoDominioId,
  completado,
  cerrado,
  total,
  respondidas,
  validadas,
  observadas,
  sinEvidencia,
}: {
  diagnosticoDominioId: string;
  completado: boolean;
  /** Ya enviado a validación o cerrado: solo entonces tiene sentido reabrirlo. */
  cerrado: boolean;
  total: number;
  respondidas: number;
  validadas: number;
  observadas: number;
  sinEvidencia: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmandoReapertura, setConfirmandoReapertura] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function correr(accion: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await accion();
      if (res.ok) router.refresh();
      else setError(res.error ?? "No se pudo completar la acción.");
    });
  }

  function cerrar() {
    setError(null);
    startTransition(async () => {
      const res = await cerrarDominio(diagnosticoDominioId);
      if (res.ok) router.refresh();
      else setError(res.error ?? "No se pudo cerrar.");
    });
  }

  function reabrir() {
    setError(null);
    setConfirmandoReapertura(false);
    startTransition(async () => {
      const res = await reabrirDominio(diagnosticoDominioId);
      if (res.ok) router.refresh();
      else setError(res.error ?? "No se pudo reabrir.");
    });
  }

  const puedeCerrar = !completado && observadas === 0;

  return (
    <div
      className={`mt-6 rounded-xl border p-5 ${
        completado ? "border-green-200 bg-green-50" : "border-blue-200 bg-blue-50"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p
            className={`text-sm font-semibold ${
              completado ? "text-green-900" : "text-blue-900"
            }`}
          >
            {completado ? "Dominio cerrado" : "Revisión del levantamiento"}
          </p>
          <p className={`mt-1 text-sm ${completado ? "text-green-800" : "text-blue-800"}`}>
            {validadas} de {total} preguntas validadas
            {observadas > 0 &&
              ` · ${observadas} ${observadas === 1 ? "observada" : "observadas"} sin resolver`}
            {sinEvidencia > 0 &&
              ` · ${sinEvidencia} ${
                sinEvidencia === 1 ? "afirma un control sin respaldo" : "afirman controles sin respaldo"
              }`}
          </p>
          {!completado && observadas > 0 && (
            <p className="mt-1 text-sm text-orange-700">
              Mientras haya observaciones sin resolver no se puede cerrar: el participante
              tiene que corregirlas primero.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Validar una por una son hasta dieciséis clics, y lo que se vuelve trámite se
              hace sin mirar. El botón por pregunta sigue ahí para lo que sí hay que mirar. */}
          {validadas < respondidas && (
            <Button
              variant="secondary"
              onClick={() => correr(() => validarTodas(diagnosticoDominioId))}
              disabled={pending}
            >
              Validar las {respondidas - validadas} restantes
            </Button>
          )}
          {validadas > 0 && (
            <button
              type="button"
              onClick={() => correr(() => deshacerValidaciones(diagnosticoDominioId))}
              disabled={pending}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900 disabled:opacity-50"
            >
              Deshacer validación
            </button>
          )}
          {!completado && (
            <Button onClick={cerrar} disabled={pending || !puedeCerrar}>
              {pending ? "Guardando…" : "Cerrar dominio"}
            </Button>
          )}
          {!cerrado ? null : confirmandoReapertura ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-700">
                Volverá a quedar editable para todos sus participantes. ¿Seguro?
              </span>
              <Button size="sm" variant="secondary" onClick={reabrir} disabled={pending}>
                Sí, reabrir
              </Button>
              <button
                type="button"
                onClick={() => setConfirmandoReapertura(false)}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmandoReapertura(true)}
              disabled={pending}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900 disabled:opacity-50"
            >
              Reabrir dominio
            </button>
          )}
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
