"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/constants";
import type { EmpresaAccesos, UsuarioAcceso } from "@/lib/data/accesos";
import { enviarEnlaceActivacion, enviarPasswordNueva } from "./actions";

/** "hoy", "ayer", "hace 3 días" — un correo de hace una hora se lee distinto que uno de la semana pasada. */
function haceCuanto(f: Date | null): string {
  if (!f) return "nunca";
  const dias = Math.floor((Date.now() - new Date(f).getTime()) / 86_400_000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}

function fecha(f: Date | null): string {
  return f ? new Date(f).toLocaleDateString("es-CL", { day: "2-digit", month: "short" }) : "";
}

function EstadoBadge({ u }: { u: UsuarioAcceso }) {
  if (!u.activo) return <Badge color="slate">Inactiva</Badge>;
  if (u.estado === "ACTIVO") return <Badge color="green">Entró {fecha(u.primerIngreso)}</Badge>;
  if (u.estado === "ENLACE_VIGENTE")
    return <Badge color="blue">Enlace vigente hasta {fecha(u.enlaceVence)}</Badge>;
  return <Badge color="orange">Nunca ha entrado</Badge>;
}

export function AccesosAdmin({ empresas }: { empresas: EmpresaAccesos[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirmando, setConfirmando] = useState<"enlace" | "password" | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const seleccionados = [...sel];

  function alternar(id: string) {
    setMsg(null);
    setSel((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  /** Atajo al caso frecuente: los de esta empresa que todavía no logran entrar. */
  function marcarSinEntrar(emp: EmpresaAccesos) {
    setMsg(null);
    const ids = emp.usuarios.filter((u) => u.activo && u.estado !== "ACTIVO").map((u) => u.id);
    setSel((prev) => {
      const s = new Set(prev);
      const todosYa = ids.every((id) => s.has(id));
      for (const id of ids) {
        if (todosYa) s.delete(id);
        else s.add(id);
      }
      return s;
    });
  }

  function enviar(tipo: "enlace" | "password") {
    setMsg(null);
    setConfirmando(null);
    startTransition(async () => {
      const res =
        tipo === "enlace"
          ? await enviarEnlaceActivacion(seleccionados)
          : await enviarPasswordNueva(seleccionados);
      if (!res.ok) {
        setMsg({ tipo: "error", texto: res.error ?? "No se pudo enviar." });
        return;
      }
      const fallidos = res.fallidos ?? [];
      setMsg(
        fallidos.length > 0
          ? {
              tipo: "error",
              texto:
                `Enviados ${res.enviados}. No llegó a ${fallidos.length}: ` +
                fallidos.map((f) => `${f.nombre} (${f.motivo})`).join("; "),
            }
          : {
              tipo: "ok",
              texto:
                res.enviados === 1
                  ? "Correo enviado."
                  : `${res.enviados} correos enviados.`,
            }
      );
      setSel(new Set());
      router.refresh();
    });
  }

  return (
    <>
      {/* ── Barra de acción: aparece recién cuando hay a quién escribirle ── */}
      <div className="sticky top-0 z-10 -mx-1 mb-5 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        {seleccionados.length === 0 ? (
          <p className="text-sm text-slate-500">
            Marca a quién quieres darle acceso. El enlace de activación es el camino
            recomendado: la contraseña nunca viaja por correo.
          </p>
        ) : confirmando ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-700">
              {confirmando === "enlace" ? (
                <>
                  ¿Enviar el enlace de activación a {seleccionados.length}{" "}
                  {seleccionados.length === 1 ? "persona" : "personas"}?
                </>
              ) : (
                <>
                  Se generará una <strong>contraseña nueva</strong> para{" "}
                  {seleccionados.length} {seleccionados.length === 1 ? "persona" : "personas"} y la
                  anterior dejará de servir. ¿Continuar?
                </>
              )}
            </span>
            <Button size="sm" onClick={() => enviar(confirmando)} disabled={pending}>
              {pending ? "Enviando…" : "Sí, enviar"}
            </Button>
            <button
              type="button"
              onClick={() => setConfirmando(null)}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-slate-700">
              {seleccionados.length} {seleccionados.length === 1 ? "seleccionada" : "seleccionadas"}
            </span>
            <Button size="sm" onClick={() => setConfirmando("enlace")} disabled={pending}>
              Enviar enlace de activación
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setConfirmando("password")}
              disabled={pending}
            >
              Generar contraseña nueva
            </Button>
            <button
              type="button"
              onClick={() => setSel(new Set())}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Limpiar
            </button>
          </div>
        )}
        {msg && (
          <p className={`mt-2 text-sm ${msg.tipo === "ok" ? "text-green-600" : "text-red-600"}`}>
            {msg.texto}
          </p>
        )}
      </div>

      {empresas.map((emp) => {
        const sinEntrar = emp.usuarios.filter((u) => u.activo && u.estado !== "ACTIVO").length;
        return (
          <Card key={emp.id} className="mb-6">
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{emp.razonSocial}</CardTitle>
                {emp.esDemo && <Badge color="yellow">Demo</Badge>}
                <span className="text-xs text-slate-400">
                  {emp.usuarios.length} {emp.usuarios.length === 1 ? "cuenta" : "cuentas"}
                  {sinEntrar > 0 && ` · ${sinEntrar} sin entrar`}
                </span>
              </div>
              {sinEntrar > 0 && (
                <button
                  type="button"
                  onClick={() => marcarSinEntrar(emp)}
                  className="text-sm font-medium text-brand-600 hover:underline"
                >
                  Marcar {sinEntrar === 1 ? "al que no ha entrado" : `a los ${sinEntrar} que no han entrado`}
                </button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {emp.usuarios.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-slate-400">Sin cuentas todavía.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {emp.usuarios.map((u) => (
                    <li key={u.id} className={u.activo ? "" : "opacity-50"}>
                      <label className="flex cursor-pointer flex-wrap items-center gap-3 px-5 py-3 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={sel.has(u.id)}
                          onChange={() => alternar(u.id)}
                          disabled={!u.activo || pending}
                          className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-slate-800">{u.nombre}</span>
                            {u.cargo && <span className="text-xs text-slate-400">{u.cargo}</span>}
                            <EstadoBadge u={u} />
                          </div>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {u.email} · {ROLE_LABELS[u.role]}
                            {u.dominios.length > 0 && ` · dominios ${u.dominios.join(", ")}`}
                          </p>
                        </div>
                        <span className="shrink-0 text-right text-xs text-slate-400">
                          acceso enviado
                          <span className="block font-medium text-slate-500">
                            {haceCuanto(u.ultimoAccesoEnviado)}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}
