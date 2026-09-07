"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Badge } from "@/components/ui";
import { CAMPOS_ANALIZABLES, claveNombre } from "@/lib/rat";
import type { ActividadPropuesta, ModoAnalisis } from "@/lib/engines/extraccion-rat";
import {
  proponerDesdeElLevantamiento,
  aceptarPropuesta,
  aceptarComplementos,
} from "./actions";

type Fuentes = {
  documentos: number;
  comentarios: number;
  fichas: number;
  inventario: number;
  sinCupo: number;
};

/**
 * Revisión de lo que el análisis propuso.
 *
 * Nada entra al registro sin pasar por aquí. Cada campo se muestra junto a la frase del
 * material de donde salió, porque la única forma de revisar una propuesta automática es
 * poder contrastarla con la fuente sin salir de la pantalla.
 *
 * Dos botones y no uno: proponer actividades nuevas y completar las que ya están son
 * trabajos distintos. El segundo es el que importa cuando la matriz ya existe —llega con
 * media tabla en "Por validar"— y lo que se busca es qué de eso el cliente ya declaró
 * sin darse cuenta, repartido entre diez cuestionarios.
 */
export function PropuestaRat({
  diagnosticoId,
  empresaId,
  yaRegistradas,
}: {
  diagnosticoId: string;
  empresaId: string;
  /** Nombres de lo que ya está en el registro, para no volver a agregarlo. */
  yaRegistradas: string[];
}) {
  const hayRegistro = yaRegistradas.length > 0;
  const existentes = new Set(yaRegistradas.map(claveNombre));
  const repetida = (nombre: string) => existentes.has(claveNombre(nombre));
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modo, setModo] = useState<ModoAnalisis>("nuevas");
  const [propuestas, setPropuestas] = useState<ActividadPropuesta[] | null>(null);
  const [elegidas, setElegidas] = useState<Set<number>>(new Set());
  const [fuentes, setFuentes] = useState<Fuentes | null>(null);
  const [parcial, setParcial] = useState(false);
  const [problemas, setProblemas] = useState<{ nombre: string; motivo: string }[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const completando = modo === "completar";

  function analizar(m: ModoAnalisis) {
    setMsg(null);
    setPropuestas(null);
    setModo(m);
    startTransition(async () => {
      const res = await proponerDesdeElLevantamiento(diagnosticoId, m);
      // Los archivos que fallaron importan igual cuando el análisis no encontró nada:
      // muchas veces son justamente la razón por la que no encontró nada.
      setProblemas(res.problemas ?? []);
      if (!res.ok) {
        setMsg({ ok: false, texto: res.error ?? "No se pudo analizar." });
        return;
      }
      setPropuestas(res.actividades ?? []);
      setFuentes(res.fuentes ?? null);
      setParcial(Boolean(res.parcial));
      // Lo que ya está en el registro llega desmarcado: se muestra para que se vea que el
      // análisis lo encontró, pero agregarlo otra vez es lo que hay que evitar.
      setElegidas(
        new Set(
          (res.actividades ?? [])
            .map((a, i) => (m === "completar" || !repetida(a.nombre) ? i : -1))
            .filter((i) => i >= 0)
        )
      );
    });
  }

  function aceptar() {
    if (!propuestas) return;
    setMsg(null);
    const seleccion = propuestas.filter((_, i) => elegidas.has(i));
    startTransition(async () => {
      const res = completando
        ? await aceptarComplementos({ empresaId, actividades: seleccion })
        : await aceptarPropuesta({ empresaId, actividades: seleccion });
      if (res.ok) {
        setMsg({
          ok: true,
          texto:
            (completando
              ? `${res.creados} ${res.creados === 1 ? "actividad completada" : "actividades completadas"} con lo que el material sustentaba.`
              : `${res.creados} ${res.creados === 1 ? "actividad agregada" : "actividades agregadas"} al registro, como borrador.`) +
            (res.omitidos
              ? ` Se omitieron ${res.omitidos} que ya estaban en el registro.`
              : ""),
        });
        setPropuestas(null);
        router.refresh();
      } else setMsg({ ok: false, texto: res.error ?? "No se pudo agregar." });
    });
  }

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            Analizar lo que entregó el cliente
          </p>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Lee <strong>todo el levantamiento</strong> —los comentarios de los diez dominios,
            las fichas de proceso y los documentos cargados— y cruza dominios: la base de
            licitud suele estar en el 3, las medidas de seguridad en el 5, los encargados en
            el 7 y los plazos en el 9. <strong>Nada entra al registro sin que lo revises</strong>:
            cada campo viene con la frase de donde salió.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {hayRegistro && (
            <Button onClick={() => analizar("completar")} disabled={pending}>
              {pending && completando && !propuestas ? "Buscando…" : "Completar lo que falta"}
            </Button>
          )}
          <Button
            variant={hayRegistro ? "secondary" : "primary"}
            onClick={() => analizar("nuevas")}
            disabled={pending}
          >
            {pending && !completando && !propuestas ? "Analizando…" : "Proponer actividades nuevas"}
          </Button>
        </div>
      </div>

      {hayRegistro && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
          <strong>Completar lo que falta</strong> recorre las filas que ya están en el registro
          y busca en el material solo las celdas vacías: es lo que convierte los{" "}
          <em>“Por validar”</em> de la matriz en dato citado. Nunca pisa un campo que ya tenga
          contenido, porque puede haberlo escrito el dueño del proceso.
        </p>
      )}

      {msg && (
        <p className={`mt-3 text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.texto}</p>
      )}

      {problemas.length > 0 && (
        <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
          <p className="font-medium">
            {problemas.length === 1
              ? "Un archivo no se pudo leer y no aportó nada:"
              : `${problemas.length} archivos no se pudieron leer y no aportaron nada:`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {problemas.map((p) => (
              <li key={p.nombre}>
                <strong>{p.nombre}</strong> — {p.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}

      {propuestas && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              {propuestas.length}{" "}
              {completando
                ? propuestas.length === 1
                  ? "actividad con campos por completar"
                  : "actividades con campos por completar"
                : propuestas.length === 1
                  ? "actividad propuesta"
                  : "actividades propuestas"}
              {fuentes && (
                <span className="text-slate-400">
                  {" "}
                  · leyó {fuentes.comentarios} respuestas
                  {fuentes.fichas > 0 && `, ${fuentes.fichas} fichas de proceso`}
                  {fuentes.documentos > 0 && ` y ${fuentes.documentos} documentos`}
                  {fuentes.inventario > 0 && ` · con el inventario de ${fuentes.inventario} datos`}
                </span>
              )}
              {fuentes && fuentes.sinCupo > 0 && (
                <span className="text-orange-700">
                  {" "}
                  · {fuentes.sinCupo} {fuentes.sinCupo === 1 ? "archivo quedó" : "archivos quedaron"}{" "}
                  fuera de esta pasada por tamaño
                </span>
              )}
            </p>
            <Button onClick={aceptar} disabled={pending || elegidas.size === 0}>
              {pending
                ? "Guardando…"
                : completando
                  ? `Completar ${elegidas.size}`
                  : `Agregar ${elegidas.size} al registro`}
            </Button>
          </div>

          {parcial && (
            <p className="mt-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
              El análisis se quedó sin espacio antes de terminar: esto es{" "}
              <strong>parte</strong> de lo que encontró, no todo. Lo que ves sirve igual;
              para el resto, vuelve a correrlo con menos fichas cargadas a la vez.
            </p>
          )}

          <ul className="mt-3 space-y-3">
            {propuestas.map((a, i) => (
              <li
                key={i}
                className={`rounded-lg border p-3 ${
                  elegidas.has(i) ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-slate-50"
                }`}
              >
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={elegidas.has(i)}
                    onChange={() =>
                      setElegidas((prev) => {
                        const s = new Set(prev);
                        if (s.has(i)) s.delete(i);
                        else s.add(i);
                        return s;
                      })
                    }
                    disabled={pending}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      {a.codigo && (
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs text-slate-600">
                          {a.codigo}
                        </span>
                      )}
                      <span className="text-sm font-semibold text-slate-800">{a.nombre}</span>
                      {!completando && repetida(a.nombre) && (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                          ya está en el registro
                        </span>
                      )}
                      {a.area && <span className="text-xs text-slate-500">{a.area}</span>}
                      {a.datosSensibles && <Badge color="orange">Datos sensibles</Badge>}
                      {a.transferenciaInternacional && <Badge color="blue">Sale del país</Badge>}
                    </span>

                    <dl className="mt-2 space-y-1.5">
                      {CAMPOS_ANALIZABLES.map((c) => {
                        const campo = a[c.clave];
                        if (!campo || typeof campo !== "object" || !("valor" in campo)) return null;
                        if (!campo.valor?.trim()) return null;
                        return (
                          <div key={c.clave} className="text-sm">
                            <dt className="inline font-medium text-slate-600">{c.etiqueta}: </dt>
                            <dd className="inline text-slate-800">{campo.valor}</dd>
                            <p className="mt-0.5 border-l-2 border-slate-300 pl-2 text-xs italic text-slate-500">
                              “{campo.cita}”
                            </p>
                          </div>
                        );
                      })}
                    </dl>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-slate-500">
            {completando ? (
              <>
                Se escriben <strong>solo las celdas vacías</strong>, y en cada fila queda anotado
                de dónde salió cada dato. Si la fila estaba validada, vuelve a{" "}
                <strong>requiere ajuste</strong>: recibió algo que nadie revisó todavía.
              </>
            ) : (
              <>
                Lo que agregues entra como <strong>borrador</strong>. Los campos que el análisis
                no pudo sustentar quedan vacíos a propósito, y hay que completarlos con el
                cliente antes de dar el registro por validado.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
