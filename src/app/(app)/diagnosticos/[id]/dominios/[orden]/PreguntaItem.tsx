"use client";

import { useEffect, useRef, useState } from "react";
import { guardarRespuesta } from "./actions";
import { VALORES, ESCALA, requiereComentario, type Valor } from "@/lib/constants";
import { Badge, Textarea, Input, Label } from "@/components/ui";
import { cn } from "@/lib/utils";
import { EvidenciasPregunta, type EvidenciaVM } from "./EvidenciasPregunta";
import { HistorialPregunta } from "./HistorialPregunta";
import { ValidarRespuesta } from "./ValidarRespuesta";

type Props = {
  respuesta: {
    id: string;
    valor: string | null;
    comentario: string | null;
    riesgoIdentificado: string | null;
    estado: string;
    observacionConsultor: string | null;
  };
  pregunta: { orden: number; texto: string; descripcion: string; evidenciaObligatoria: boolean };
  evidencias?: EvidenciaVM[];
  puedeValidar?: boolean;
  /** Dominio ya enviado a validación: solo lectura, salvo que el consultor la haya observado. */
  bloqueado?: boolean;
  /** Aportes de cada participante. Solo llegan al consultor: los participantes
   *  responden a ciegas, sin ver lo que contestaron sus colegas. */
  aportes?: AporteVM[];
  /** El consultor fijó la respuesta oficial a mano. */
  consolidadaManual?: boolean;
};

export type AporteVM = {
  autor: string;
  cargo: string | null;
  valor: string | null;
  comentario: string | null;
  riesgoIdentificado: string | null;
};

const LABEL_CORTO: Record<Valor, string> = {
  "0": "0", "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", N_A: "N/A", OTRO: "Otro",
};

/** Espera a que el usuario deje de escribir antes de guardar. */
const RETARDO_GUARDADO = 800;

export function PreguntaItem({
  respuesta,
  pregunta,
  evidencias,
  puedeValidar,
  bloqueado,
  aportes,
  consolidadaManual,
}: Props) {
  const [valor, setValor] = useState<string | null>(respuesta.valor);
  const [comentario, setComentario] = useState(respuesta.comentario ?? "");
  const [riesgo, setRiesgo] = useState(respuesta.riesgoIdentificado ?? "");
  const [estado, setEstado] = useState(respuesta.estado);
  const [guardado, setGuardado] = useState<"limpio" | "guardando" | "ok" | "error">("limpio");
  const [error, setError] = useState<string | null>(null);

  const comentarioRequerido = requiereComentario(valor);
  // Una evidencia sin archivo es un pendiente del checklist, no un respaldo cargado.
  const tieneEvidencia = (evidencias ?? []).some((e) => e.archivoPath);
  // Dos participantes evaluaron distinto la misma práctica: vale la pena mirarlo.
  const discrepan =
    new Set((aportes ?? []).map((a) => a.valor).filter((v) => v != null)).size > 1;
  // Solo lectura si el dominio ya se envió, salvo que el consultor haya observado ESTA pregunta.
  const soloLectura = Boolean(bloqueado) && estado !== "OBSERVADA";

  // Guardado automático: se dispara cuando el usuario deja de editar. Acepta respuestas
  // incompletas (quedan como borrador) para no perder nunca lo avanzado; la exigencia de
  // completitud se aplica al enviar el dominio.
  // Se guarda solo si el CONTENIDO cambió. Antes bastaba con que cambiara cualquier
  // dependencia del efecto: al observar una pregunta, `soloLectura` pasaba a false y eso
  // disparaba un guardado que pisaba el estado OBSERVADA recién puesto por el consultor.
  const ultimoGuardado = useRef(
    JSON.stringify({
      valor: respuesta.valor,
      comentario: respuesta.comentario ?? "",
      riesgo: respuesta.riesgoIdentificado ?? "",
    })
  );
  useEffect(() => {
    if (soloLectura || valor == null) return;
    const actual = JSON.stringify({ valor, comentario, riesgo });
    if (actual === ultimoGuardado.current) return;

    setGuardado("guardando");
    const t = setTimeout(async () => {
      const res = await guardarRespuesta({
        respuestaId: respuesta.id,
        valor: valor as Valor,
        comentario,
        riesgoIdentificado: riesgo,
      });
      if (res.ok) {
        ultimoGuardado.current = actual;
        setEstado(!requiereComentario(valor) || comentario.trim() ? "RESPONDIDA" : "PENDIENTE");
        setGuardado("ok");
        setError(null);
      } else {
        setGuardado("error");
        setError(res.error ?? "No se pudo guardar");
      }
    }, RETARDO_GUARDADO);
    return () => clearTimeout(t);
  }, [valor, comentario, riesgo, respuesta.id, soloLectura]);

  return (
    <div id={`pregunta-${pregunta.orden}`} className="scroll-mt-24 border-b border-slate-100 px-5 py-5 last:border-0">
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600">
          {pregunta.orden}
        </div>
        <div className="flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-slate-800">{pregunta.texto}</p>
            <span className="flex shrink-0 items-center gap-2">
              {guardado === "guardando" && (
                <span className="text-xs text-slate-400">Guardando…</span>
              )}
              {guardado === "ok" && <span className="text-xs text-green-600">Guardado</span>}
              {estado === "OBSERVADA" ? (
                <Badge color="orange">Observada</Badge>
              ) : estado === "VALIDADA" ? (
                <Badge color="blue">Validada</Badge>
              ) : estado === "RESPONDIDA" && valor != null ? (
                <Badge color="green">Respondida</Badge>
              ) : (
                <Badge color="slate">Pendiente</Badge>
              )}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{pregunta.descripcion}</p>

          {respuesta.observacionConsultor &&
            (estado === "OBSERVADA" ? (
              <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">
                  Observación del consultor
                </p>
                <p className="mt-0.5 text-sm text-orange-900">{respuesta.observacionConsultor}</p>
                {!soloLectura && !puedeValidar && (
                  <p className="mt-1 text-xs text-orange-700">
                    Corrige esta pregunta y se guardará sola{bloqueado ? ", aunque el resto del dominio esté cerrado" : ""}.
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Observación del consultor · ya corregida
                </p>
                <p className="mt-0.5 text-sm text-slate-600">{respuesta.observacionConsultor}</p>
                {puedeValidar && (
                  <p className="mt-1 text-xs text-slate-500">
                    Se borra al validar la pregunta.
                  </p>
                )}
              </div>
            ))}
          {pregunta.evidenciaObligatoria && valor == null && (
            <p className="mt-1 text-xs text-slate-400">
              Si el control existe (respuestas 3–5), requiere evidencia documental.
            </p>
          )}

          {/* Escala */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {VALORES.map((v) => (
              <button
                key={v}
                type="button"
                title={`${ESCALA[v].estado}: ${ESCALA[v].descripcion}`}
                onClick={() => setValor(v)}
                disabled={soloLectura}
                className={cn(
                  "h-9 min-w-9 rounded-lg border px-2 text-sm font-medium transition-colors",
                  valor === v
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-slate-300 bg-white text-slate-600 hover:border-brand-600 hover:text-brand-600",
                  soloLectura && "cursor-not-allowed opacity-60 hover:border-slate-300 hover:text-slate-600"
                )}
              >
                {LABEL_CORTO[v]}
              </button>
            ))}
          </div>
          {valor != null && (
            <p className="mt-1.5 text-xs text-slate-400">
              {ESCALA[valor as Valor].estado} — {ESCALA[valor as Valor].descripcion}
            </p>
          )}

          {/* Comentario */}
          <div className="mt-3">
            <Label htmlFor={`c-${respuesta.id}`}>
              Comentario {comentarioRequerido && <span className="text-red-600">*</span>}
            </Label>
            <Textarea
              id={`c-${respuesta.id}`}
              rows={2}
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              disabled={soloLectura}
              placeholder={comentarioRequerido ? "Obligatorio: describe la situación actual" : "Opcional"}
            />
            {comentarioRequerido && !comentario.trim() && !soloLectura && (
              <p className="mt-1 text-xs text-orange-600">
                Con esta respuesta el comentario es obligatorio para poder enviar el dominio.
              </p>
            )}
          </div>

          {/* Riesgo */}
          <div className="mt-3">
            <Label htmlFor={`r-${respuesta.id}`}>Riesgo identificado</Label>
            <Input
              id={`r-${respuesta.id}`}
              value={riesgo}
              onChange={(e) => setRiesgo(e.target.value)}
              disabled={soloLectura}
              placeholder="Opcional"
            />
          </div>

          {guardado === "error" && error && (
            <p className="mt-3 text-xs text-red-600">{error}</p>
          )}

          {/* Aportes de los participantes: solo los ve el consultor. La respuesta de
              arriba es la oficial, consolidada con la nota más baja de estos aportes. */}
          {puedeValidar && aportes && aportes.length > 0 && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Respuestas de los participantes ({aportes.length})
                </span>
                {discrepan && <Badge color="orange">Discrepan</Badge>}
                {consolidadaManual && <Badge color="blue">Oficial fijada por el consultor</Badge>}
              </div>
              <ul className="mt-2 divide-y divide-slate-100">
                {aportes.map((a, i) => (
                  <li key={i} className="py-2 first:pt-1 last:pb-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-slate-100 px-1.5 text-xs font-bold text-slate-700">
                        {a.valor ? LABEL_CORTO[a.valor as Valor] ?? a.valor : "—"}
                      </span>
                      <span className="text-sm font-medium text-slate-700">{a.autor}</span>
                      {a.cargo && <span className="text-xs text-slate-400">{a.cargo}</span>}
                    </div>
                    {a.comentario && (
                      <p className="mt-1 pl-8 text-sm text-slate-600">{a.comentario}</p>
                    )}
                    {a.riesgoIdentificado && (
                      <p className="mt-0.5 pl-8 text-xs text-orange-600">
                        Riesgo: {a.riesgoIdentificado}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {!consolidadaManual && (
                <p className="mt-2 text-xs text-slate-400">
                  La respuesta oficial se calcula sola con la nota más baja. Si la editas
                  arriba, queda fijada por ti y deja de recalcularse.
                </p>
              )}
            </div>
          )}

          {/* Afirmar que el control existe obliga a probarlo, y ese aviso era una línea de
              doce píxeles allá arriba, lejos del botón de adjuntar: se leía como una nota al
              margen y no como lo que es. Baja aquí, pegado a donde se resuelve, y con el
              peso visual de algo que bloquea el cierre del dominio. */}
          {pregunta.evidenciaObligatoria &&
            ["3", "4", "5"].includes(valor ?? "") &&
            (tieneEvidencia ? (
              <p className="mt-4 text-xs font-medium text-green-700">
                ✓ Respaldo cargado para esta respuesta.
              </p>
            ) : (
              <div className="mt-4 flex gap-3 rounded-lg border-2 border-orange-300 bg-orange-50 px-4 py-3">
                <span className="text-lg leading-none" aria-hidden>
                  📎
                </span>
                <div>
                  <p className="text-sm font-semibold text-orange-900">
                    Esta respuesta necesita un documento que la respalde
                  </p>
                  <p className="mt-0.5 text-sm leading-relaxed text-orange-800">
                    Marcaste <strong>{valor}</strong>, es decir que el control existe. Adjunta
                    abajo el documento que lo demuestra — una política, un procedimiento, un
                    registro. <strong>Sin él, este dominio no se puede enviar.</strong>
                  </p>
                </div>
              </div>
            ))}

          <EvidenciasPregunta
            respuestaId={respuesta.id}
            evidencias={evidencias ?? []}
            puedeValidar={!!puedeValidar}
          />

          {puedeValidar && <ValidarRespuesta respuestaId={respuesta.id} estado={estado} />}

          {/* Bitácora de la pregunta: quién cambió qué y cuándo. Solo el consultor. */}
          {puedeValidar && <HistorialPregunta respuestaId={respuesta.id} />}
        </div>
      </div>
    </div>
  );
}
