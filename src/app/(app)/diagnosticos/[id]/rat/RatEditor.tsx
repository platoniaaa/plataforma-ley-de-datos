"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Badge, Input, Textarea, Label, Select } from "@/components/ui";
import { CAMPOS_RAT, ESTADOS_RAT, faltantesDe, type TratamientoPlano } from "@/lib/rat";
import {
  guardarTratamiento,
  crearTratamiento,
  eliminarTratamiento,
  generarBorradorRat,
} from "./actions";

const ESTADOS = Object.fromEntries(
  ESTADOS_RAT.map((e) => [e.valor, { label: e.etiqueta, color: e.color }])
) as Record<string, { label: string; color: "slate" | "blue" | "yellow" | "orange" | "green" }>;

type Area = { id: string; nombre: string };

export function RatEditor({
  empresaId,
  tratamientos,
  areas,
  puedeEditar,
}: {
  empresaId: string;
  tratamientos: TratamientoPlano[];
  areas: Area[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  function correr(accion: () => Promise<{ ok: boolean; error?: string; creados?: number }>) {
    setMsg(null);
    startTransition(async () => {
      const res = await accion();
      if (res.ok) {
        setMsg({
          ok: true,
          texto: res.creados
            ? `${res.creados} ${res.creados === 1 ? "actividad creada" : "actividades creadas"}.`
            : "Guardado.",
        });
        router.refresh();
      } else setMsg({ ok: false, texto: res.error ?? "No se pudo completar." });
    });
  }

  return (
    <>
      {puedeEditar && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => correr(() => generarBorradorRat(empresaId))}
            disabled={pending}
          >
            Generar borrador desde las áreas
          </Button>
          <Button onClick={() => correr(() => crearTratamiento(empresaId))} disabled={pending}>
            Agregar actividad
          </Button>
          {msg && (
            <span className={`text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}>
              {msg.texto}
            </span>
          )}
        </div>
      )}

      {tratamientos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <p className="text-sm font-medium text-slate-700">El registro está vacío.</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">
            Con <strong>Generar borrador desde las áreas</strong> se crea una actividad por cada
            área que declaró tratar datos en el levantamiento. Quedan sin llenar a propósito:
            la plataforma sabe qué áreas tratan datos, no para qué ni con qué base legal.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {tratamientos.map((t) => {
            const faltan = faltantesDe(t);
            const est = ESTADOS[t.estado] ?? ESTADOS.BORRADOR;
            return (
              <li key={t.id} className="rounded-xl border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setAbierto(abierto === t.id ? null : t.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      {t.codigo && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-500">
                          {t.codigo}
                        </span>
                      )}
                      <span className="text-sm font-medium text-slate-800">{t.nombre}</span>
                      <Badge color={est.color}>{est.label}</Badge>
                      {t.datosSensibles && <Badge color="orange">Datos sensibles</Badge>}
                      {t.transferenciaInternacional && (
                        <Badge color="blue">Transferencia internacional</Badge>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-400">
                      {t.areaNombre ?? "Sin área asignada"}
                      {faltan.length > 0
                        ? ` · faltan ${faltan.length} de ${
                            CAMPOS_RAT.filter((c) => c.obligatorio).length
                          } campos obligatorios`
                        : " · completa"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {abierto === t.id ? "Cerrar ▲" : "Abrir ▼"}
                  </span>
                </button>

                {abierto === t.id && (
                  <Formulario
                    t={t}
                    areas={areas}
                    puedeEditar={puedeEditar}
                    pending={pending}
                    onGuardar={(datos) => correr(() => guardarTratamiento(datos))}
                    onEliminar={() => correr(() => eliminarTratamiento(t.id))}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

type Datos = Parameters<typeof guardarTratamiento>[0];

function Formulario({
  t,
  areas,
  puedeEditar,
  pending,
  onGuardar,
  onEliminar,
}: {
  t: TratamientoPlano;
  areas: Area[];
  puedeEditar: boolean;
  pending: boolean;
  onGuardar: (d: Datos) => void;
  onEliminar: () => void;
}) {
  // Se arma de la lista de campos: agregar una columna al registro no debería obligar a
  // tocar el formulario, y cuando obligaba, se olvidaba.
  const [f, setF] = useState<Datos>(
    () =>
      ({
        id: t.id,
        codigo: t.codigo ?? "",
        areaId: t.areaId ?? "",
        datosSensibles: t.datosSensibles,
        transferenciaInternacional: t.transferenciaInternacional,
        estado: t.estado,
        ...Object.fromEntries(CAMPOS_RAT.map((c) => [c.clave, t[c.clave] ?? ""])),
      }) as Datos
  );

  const set = (k: keyof Datos, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  return (
    <div className="border-t border-slate-100 px-5 py-4">
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="w-28">
          <Label htmlFor={`codigo-${t.id}`}>ID</Label>
          <Input
            id={`codigo-${t.id}`}
            value={String(f.codigo ?? "")}
            disabled={!puedeEditar}
            placeholder="RAT-001"
            onChange={(e) => set("codigo", e.target.value)}
          />
        </div>
        <div className="min-w-[220px] flex-1">
          <Label htmlFor={`area-${t.id}`}>Área del levantamiento</Label>
          <Select
            id={`area-${t.id}`}
            value={f.areaId}
            disabled={!puedeEditar}
            onChange={(e) => set("areaId", e.target.value)}
          >
            <option value="">Sin área asignada</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-slate-500">
            Vincula la actividad con el área que respondió el cuestionario. El área que se
            propone como responsable en la matriz se escribe más abajo.
          </p>
        </div>
        <div className="min-w-[200px]">
          <Label htmlFor={`estado-${t.id}`}>Estado de validación</Label>
          <Select
            id={`estado-${t.id}`}
            value={f.estado}
            disabled={!puedeEditar}
            onChange={(e) => set("estado", e.target.value)}
          >
            {ESTADOS_RAT.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.etiqueta}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={f.datosSensibles}
            disabled={!puedeEditar}
            onChange={(e) => set("datosSensibles", e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600"
          />
          Trata datos sensibles
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={f.transferenciaInternacional}
            disabled={!puedeEditar}
            onChange={(e) => set("transferenciaInternacional", e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600"
          />
          Sale del país
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {CAMPOS_RAT.map((c) => {
          // Los campos de transferencia solo aplican si la hay: mostrarlos siempre
          // invita a llenarlos con "no aplica", que ensucia el registro.
          const soloTransferencia =
            c.clave === "paisesDestino" || c.clave === "garantiasTransferencia";
          if (soloTransferencia && !f.transferenciaInternacional) return null;
          const valor = String(f[c.clave] ?? "");
          const vacioObligatorio = c.obligatorio && !valor.trim();
          return (
            <div key={c.clave} className={c.ancho === "largo" ? "md:col-span-2" : ""}>
              <Label htmlFor={`${c.clave}-${t.id}`}>
                {c.etiqueta} {c.obligatorio && <span className="text-red-600">*</span>}
              </Label>
              <p className="mb-1 text-xs text-slate-500">{c.ayuda}</p>
              {c.ancho === "largo" ? (
                <Textarea
                  id={`${c.clave}-${t.id}`}
                  rows={2}
                  value={valor}
                  disabled={!puedeEditar}
                  placeholder={c.ejemplo}
                  onChange={(e) => set(c.clave as keyof Datos, e.target.value)}
                />
              ) : (
                <>
                  <Input
                    id={`${c.clave}-${t.id}`}
                    value={valor}
                    disabled={!puedeEditar}
                    placeholder={c.ejemplo}
                    // Sugerencias abiertas y no un desplegable: el vocabulario acordado
                    // queda a un clic, pero una actividad que se apoya en dos bases de
                    // licitud puede escribirlas las dos.
                    list={c.opciones ? `${c.clave}-opciones` : undefined}
                    onChange={(e) => set(c.clave as keyof Datos, e.target.value)}
                  />
                  {c.opciones && (
                    <datalist id={`${c.clave}-opciones`}>
                      {c.opciones.map((o) => (
                        <option key={o} value={o} />
                      ))}
                    </datalist>
                  )}
                </>
              )}
              {vacioObligatorio && (
                <p className="mt-1 text-xs text-orange-600">
                  Obligatorio: sin esto la actividad no queda documentada.
                </p>
              )}
              {c.evidencia && (
                <p className="mt-1 text-xs text-slate-400">
                  Lo acredita: {c.evidencia}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {puedeEditar && (
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          <Button onClick={() => onGuardar(f)} disabled={pending}>
            {pending ? "Guardando…" : "Guardar actividad"}
          </Button>
          <button
            type="button"
            onClick={onEliminar}
            disabled={pending}
            className="text-sm text-slate-500 underline underline-offset-2 hover:text-red-600 disabled:opacity-50"
          >
            Eliminar
          </button>
        </div>
      )}
    </div>
  );
}
