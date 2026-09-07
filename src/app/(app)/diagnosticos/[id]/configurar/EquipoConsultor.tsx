"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui";
import { configurarEquipoAction } from "./equipo-actions";

export type ConsultorOpcion = { id: string; nombre: string; cargo: string | null };

/**
 * Quién responde por el diagnóstico. El líder es el nombre al que se dirige el cliente;
 * el equipo, quiénes más intervienen y pueden cubrirlo. No cambia permisos: todo el
 * staff de Procesos360 ya ve y opera todas las empresas.
 */
export function EquipoConsultor({
  diagnosticoId,
  consultores,
  liderInicial,
  equipoInicial,
}: {
  diagnosticoId: string;
  consultores: ConsultorOpcion[];
  liderInicial: string;
  equipoInicial: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lider, setLider] = useState(liderInicial);
  const [equipo, setEquipo] = useState<string[]>(equipoInicial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function alternar(id: string) {
    setMsg(null);
    setEquipo((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function elegirLider(id: string) {
    setMsg(null);
    // Nombrar líder a alguien lo mete al equipo: no se puede responder por un trabajo
    // del que no se forma parte.
    setLider(id === lider ? "" : id);
    if (id !== lider && !equipo.includes(id)) setEquipo((prev) => [...prev, id]);
  }

  function guardar() {
    setMsg(null);
    startTransition(async () => {
      const res = await configurarEquipoAction({
        diagnosticoId,
        liderId: lider,
        miembrosIds: equipo,
      });
      if (res.ok) {
        setMsg({ ok: true, text: "Equipo guardado." });
        router.refresh();
      } else setMsg({ ok: false, text: res.error ?? "No se pudo guardar." });
    });
  }

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Equipo consultor</CardTitle>
          <p className="mt-0.5 text-xs text-slate-400">
            Quiénes responden por este diagnóstico ante el cliente. No cambia permisos: todo
            Procesos360 ya ve esta empresa.
          </p>
        </div>
        <Button onClick={guardar} disabled={pending}>
          {pending ? "Guardando…" : "Guardar equipo"}
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-slate-100">
          {consultores.map((c) => {
            const enEquipo = equipo.includes(c.id);
            const esLider = lider === c.id;
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <label className="flex flex-1 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={enEquipo}
                    onChange={() => alternar(c.id)}
                    disabled={pending || esLider}
                    className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 disabled:opacity-50"
                  />
                  <span className="min-w-0">
                    <span className="text-sm font-medium text-slate-800">{c.nombre}</span>
                    {c.cargo && <span className="ml-2 text-xs text-slate-400">{c.cargo}</span>}
                  </span>
                </label>
                {esLider ? (
                  <Badge color="blue">A cargo</Badge>
                ) : (
                  <button
                    type="button"
                    onClick={() => elegirLider(c.id)}
                    disabled={pending}
                    className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 hover:border-brand-600 hover:text-brand-600 disabled:opacity-50"
                  >
                    Dejar a cargo
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {!lider && equipo.length > 0 && (
          <p className="mt-3 text-xs text-orange-600">
            Nadie queda a cargo. El cliente necesita un nombre al que dirigirse: designa a uno.
          </p>
        )}
        {msg && (
          <p className={`mt-3 text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}>
            {msg.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
