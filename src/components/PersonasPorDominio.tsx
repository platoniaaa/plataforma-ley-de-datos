"use client";

import { useState } from "react";
import type { AvanceDiagnostico, PersonaDominio } from "@/lib/data/avance";

// Quiénes han respondido, dominio por dominio.
//
// Es una matriz de puntos —un punto, una persona— y no una barra de porcentaje a
// propósito: los dominios tienen entre 1 y 5 responsables, y con esos denominadores el
// porcentaje miente. Un dominio con 1 de 1 se dibujaría lleno y uno con 3 de 5 a media
// asta, sugiriendo que el primero va más adelantado cuando tiene una sola mirada y el
// segundo tres. Contando personas, lo que se ve es lo que hay.
//
// El color es un estado (respondió / no respondió), así que sale de la paleta de estado
// y nunca carga el significado solo: el punto lleno y el vacío son formas distintas, hay
// leyenda, el conteo va escrito en cada fila y al pasar el cursor aparece el nombre.

// Paleta de estado validada contra la superficie blanca de las tarjetas:
// separación CVD ΔE 17.2 (deuteranopía) y 24.1 en visión normal, ambas sobre el piso.
const RESPONDIO = "#0ca30c";
const PENDIENTE = "#94a3b8";
const SUPERFICIE = "#ffffff";

const R = 7; // radio del punto: 14px de diámetro, sobre el mínimo de 8px
const PASO = 22; // separación entre centros
const ALTO = 26;

type Foco = { x: number; y: number; persona: PersonaDominio; dominio: string } | null;

export function PersonasPorDominio({ datos }: { datos: AvanceDiagnostico }) {
  const [foco, setFoco] = useState<Foco>(null);

  const dominios = datos.dominios.filter((d) => d.personas.length > 0);
  const asignaciones = dominios.reduce((n, d) => n + d.personas.length, 0);
  const conRespuesta = dominios.reduce((n, d) => n + d.participantesActivos, 0);
  const maxPersonas = Math.max(1, ...dominios.map((d) => d.personas.length));
  const participacion = asignaciones === 0 ? 0 : Math.round((conRespuesta / asignaciones) * 100);
  // Cuánto del cuestionario está completo, para poder contrastarlo aquí mismo: un
  // consultor leyó el 74% de avance, lo comparó con este gráfico y no le calzó. Son dos
  // medidas distintas y ninguna decía cuál era.
  const avance = datos.porcentaje;
  const ancho = maxPersonas * PASO;

  return (
    <div className="relative rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Participación · quiénes han respondido
          </p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums text-slate-900">
              {participacion}%
            </span>
            <span className="text-sm text-slate-500">
              {conRespuesta} de {asignaciones} asignaciones con respuesta registrada
            </span>
          </p>
        </div>
        <div className="text-right text-xs text-slate-400">
          <p>Cada punto es una persona · {datos.participantes} responsables en total</p>
          <p className="mt-0.5">
            Avance del cuestionario: <strong className="text-slate-500">{avance}%</strong> ·{" "}
            {datos.completas} de {datos.total} preguntas completas
          </p>
        </div>
      </div>

      {avance - participacion >= 10 && (
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          El cuestionario va <strong>{avance - participacion} puntos</strong> por delante de la
          participación: hay preguntas contestadas por una sola persona de las varias que
          debían mirarlas. Que el cuestionario avance no significa que el levantamiento
          recoja todas las miradas.
        </p>
      )}

      <ul className="mt-6 space-y-0.5">
        {dominios.map((d) => {
          const completo = d.participantesActivos === d.personas.length;
          return (
            <li
              key={d.orden}
              className="flex items-center gap-3 rounded-lg px-1 py-0.5 hover:bg-slate-50"
            >
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-slate-400">
                {d.orden}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{d.nombre}</span>

              <svg
                width={ancho}
                height={ALTO}
                className="shrink-0"
                role="img"
                aria-label={`${d.participantesActivos} de ${d.personas.length} personas han respondido en ${d.nombre}`}
              >
                {d.personas.map((p, i) => {
                  const cx = i * PASO + PASO / 2;
                  return (
                    <circle
                      key={p.nombre}
                      cx={cx}
                      cy={ALTO / 2}
                      r={R}
                      fill={p.respondio ? RESPONDIO : "transparent"}
                      stroke={p.respondio ? SUPERFICIE : PENDIENTE}
                      strokeWidth={2}
                      className="cursor-default"
                      onMouseEnter={(e) => {
                        const caja = e.currentTarget.getBoundingClientRect();
                        setFoco({
                          x: caja.left + caja.width / 2,
                          y: caja.top,
                          persona: p,
                          dominio: d.nombre,
                        });
                      }}
                      onMouseLeave={() => setFoco(null)}
                    >
                      <title>
                        {p.nombre} — {p.respondio ? `${p.registradas} respuestas` : "sin responder"}
                      </title>
                    </circle>
                  );
                })}
              </svg>

              <span
                className={`w-12 shrink-0 text-right text-xs font-medium tabular-nums ${
                  completo ? "text-green-700" : "text-orange-600"
                }`}
              >
                {d.participantesActivos}/{d.personas.length}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-slate-100 pt-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="16" aria-hidden>
            <circle cx="8" cy="8" r="6" fill={RESPONDIO} />
          </svg>
          Ha registrado su respuesta
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="16" aria-hidden>
            <circle cx="8" cy="8" r="6" fill="none" stroke={PENDIENTE} strokeWidth="2" />
          </svg>
          Sin responder
        </span>
      </div>

      {foco && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{ left: foco.x, top: foco.y - 8 }}
        >
          <p className="font-semibold">{foco.persona.nombre}</p>
          {foco.persona.cargo && <p className="text-slate-300">{foco.persona.cargo}</p>}
          <p className={foco.persona.respondio ? "text-green-300" : "text-orange-300"}>
            {foco.persona.respondio
              ? `${foco.persona.registradas} ${
                  foco.persona.registradas === 1 ? "respuesta registrada" : "respuestas registradas"
                }`
              : "Sin responder este dominio"}
          </p>
        </div>
      )}
    </div>
  );
}
