"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { enviarRecordatorios } from "@/lib/actions/recordatorios";

type Props = {
  diagnosticoId: string;
  /** Sin esto, el recordatorio va a todos los que tengan algo pendiente. */
  userId?: string;
  /** A cuántas personas se les escribirá (solo para el botón masivo). */
  cuantos?: number;
  variante?: "principal" | "fila";
};

export function BotonRecordatorio({ diagnosticoId, userId, cuantos, variante = "fila" }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const masivo = !userId;

  function enviar() {
    setMsg(null);
    setConfirmando(false);
    startTransition(async () => {
      const res = await enviarRecordatorios(diagnosticoId, userId ? [userId] : undefined);
      if (!res.ok) {
        setMsg({ tipo: "error", texto: res.error ?? "No se pudo enviar." });
        return;
      }
      const fallidos = res.fallidos ?? [];
      if (fallidos.length > 0) {
        setMsg({
          tipo: "error",
          texto:
            `Enviados ${res.enviados}. No llegó a ${fallidos.length}: ` +
            fallidos.map((f) => `${f.nombre} (${f.motivo})`).join("; "),
        });
      } else {
        setMsg({
          tipo: "ok",
          texto: res.enviados === 1 ? "Recordatorio enviado." : `${res.enviados} recordatorios enviados.`,
        });
      }
      router.refresh();
    });
  }

  // El envío masivo escribe a varias personas de una vez: conviene confirmar.
  if (masivo && confirmando) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">
          ¿Enviar el recordatorio a {cuantos} {cuantos === 1 ? "persona" : "personas"}?
        </span>
        <Button size="sm" onClick={enviar} disabled={pending}>
          {pending ? "Enviando…" : "Sí, enviar"}
        </Button>
        <button
          type="button"
          onClick={() => setConfirmando(false)}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <div className={variante === "principal" ? "" : "text-right"}>
      {variante === "principal" ? (
        <Button onClick={() => setConfirmando(true)} disabled={pending || !cuantos}>
          {pending ? "Enviando…" : `Recordar a los ${cuantos} pendientes`}
        </Button>
      ) : (
        <button
          type="button"
          onClick={enviar}
          disabled={pending}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-brand-600 hover:text-brand-600 disabled:opacity-50"
        >
          {pending ? "Enviando…" : "Recordar"}
        </button>
      )}
      {msg && (
        <p
          className={`mt-1.5 text-xs ${msg.tipo === "ok" ? "text-green-600" : "text-red-600"}`}
        >
          {msg.texto}
        </p>
      )}
    </div>
  );
}
