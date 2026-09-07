import Link from "next/link";
import { requireSession, puedeRevisarDominios } from "@/lib/session";
import { ROLES, respuestaCompleta } from "@/lib/constants";
import { getDiagnosticoDominio } from "@/lib/data/diagnosticos";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { PreguntaItem } from "./PreguntaItem";
import { EnviarDominio } from "./EnviarDominio";
import { ValidacionDominio } from "./ValidacionDominio";

export default async function DominioPage({
  params,
}: {
  params: Promise<{ id: string; orden: string }>;
}) {
  const { id, orden } = await params;
  const session = await requireSession();
  const { diag, dd } = await getDiagnosticoDominio(id, Number(orden), session);
  const puedeValidar = await puedeRevisarDominios(diag.empresaId);

  const participantes = dd.participantes.map((p) => p.user);
  const participo = participantes.some((u) => u.id === session.user.id);

  // El Responsable de Dominio solo entra a los dominios en los que participa. La
  // excepción es quien revisa el levantamiento por parte del cliente: no puede controlar
  // lo que no puede abrir, y controlar es justamente para lo que se le dio el permiso.
  if (session.user.role === ROLES.RESPONSABLE_DOMINIO && !participo && !puedeValidar) {
    return (
      <>
        <div className="mb-2">
          <Link href={`/diagnosticos/${id}`} className="text-sm text-brand-600 hover:underline">
            ← {diag.nombre}
          </Link>
        </div>
        <PageHeader title={`Dominio ${dd.dominio.orden}: ${dd.dominio.nombre}`} />
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm font-medium text-slate-700">
              Este dominio no está asignado a ti.
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Solo puedes responder los dominios en los que figuras como participante.
            </p>
            <Link
              href={`/diagnosticos/${id}`}
              className="mt-4 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Volver al resumen
            </Link>
          </CardContent>
        </Card>
      </>
    );
  }

  const evidencias: string[] = JSON.parse(dd.dominio.evidenciasMinimas || "[]");
  const total = dd.respuestas.length;
  const dominioEnviado = ["EN_VALIDACION", "COMPLETADO"].includes(dd.estado);

  // Los contadores miden cosas distintas segun quien mira, y confundirlas desorienta:
  // el participante necesita saber cuanto lleva EL, no cuanto lleva el dominio. Como
  // responde a ciegas, decirle "16 de 16 respondidas" por el trabajo de un colega le
  // hace creer que ya cumplio con algo que ni siquiera puede ver.
  const miAporte = (r: (typeof dd.respuestas)[number]) =>
    r.aportes.find((a) => a.userId === session.user.id) ?? null;

  const completaDe = (
    valor: string | null,
    comentario: string | null,
    r: (typeof dd.respuestas)[number]
  ) =>
    respuestaCompleta({
      valor,
      comentario,
      evidenciaObligatoria: r.pregunta.evidenciaObligatoria,
      // La evidencia es del dominio, no de cada persona: si un colega ya la subio, cuenta.
      tieneEvidencia: r.evidencias.some((e) => e.archivoPath),
    });

  // El consultor valida la respuesta oficial; el participante trabaja sobre la suya.
  const respondidas = puedeValidar
    ? dd.respuestas.filter((r) => r.valor != null).length
    : dd.respuestas.filter((r) => miAporte(r)?.valor != null).length;
  const completas = puedeValidar
    ? dd.respuestas.filter((r) => completaDe(r.valor, r.comentario, r)).length
    : dd.respuestas.filter((r) => {
        const a = miAporte(r);
        return a ? completaDe(a.valor, a.comentario, r) : false;
      }).length;
  const primerPendiente = puedeValidar
    ? (dd.respuestas.find((r) => r.valor == null)?.pregunta.orden ?? null)
    : (dd.respuestas.find((r) => miAporte(r)?.valor == null)?.pregunta.orden ?? null);

  // Participantes que ya aportaron al menos una respuesta (contador del encabezado).
  const contribuyeron = new Set(dd.respuestas.map((r) => r.respondidoPorId).filter(Boolean)).size;
  const responsablesEvidencia = dd.participantes.filter((p) => p.responsableEvidencia);
  const yoResponsableEvidencia = responsablesEvidencia.some((p) => p.userId === session.user.id);

  return (
    <>
      <div className="mb-2">
        <Link href={`/diagnosticos/${id}`} className="text-sm text-brand-600 hover:underline">
          ← {diag.nombre}
        </Link>
      </div>
      <PageHeader
        title={`Dominio ${dd.dominio.orden}: ${dd.dominio.nombre}`}
        subtitle={`${puedeValidar ? "" : "Tus respuestas: "}${completas} de ${total} preguntas completas${
          respondidas > completas ? ` (${respondidas} con nota, faltan datos)` : ""
        }${
          puedeValidar && participantes.length > 0
            ? ` · ${contribuyeron} de ${participantes.length} participantes`
            : ""
        }`}
      />

      {participo && (
        <div className="-mt-3 mb-5 inline-flex items-center gap-2 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">
          ✓ Este dominio te corresponde a ti
        </div>
      )}

      {yoResponsableEvidencia ? (
        <div className="mb-5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-medium text-orange-700">
          📎 Eres responsable de subir la evidencia documental de este dominio.
        </div>
      ) : puedeValidar && responsablesEvidencia.length > 0 ? (
        <p className="mb-5 text-xs text-slate-500">
          📎 Responsables de evidencia: {responsablesEvidencia.map((p) => p.user.nombre).join(", ")}
        </p>
      ) : null}

      {!dominioEnviado && primerPendiente != null && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <a
            href={`#pregunta-${primerPendiente}`}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            {respondidas > 0 ? "Continuar donde quedaste" : "Comenzar a responder"}
            <span aria-hidden>↓</span>
          </a>
          <span className="text-xs text-slate-500">
            Tus respuestas se guardan solas — puedes salir y volver cuando quieras.
          </span>
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Objetivo del dominio</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-slate-600">{dd.dominio.objetivo}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Evidencias mínimas</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs text-slate-600">
              {evidencias.slice(0, 10).map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-slate-300">•</span>
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Preguntas del diagnóstico</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {dd.respuestas.map((r) => {
            // El participante edita SU aporte; el consultor edita la respuesta oficial.
            const propio = r.aportes.find((a) => a.userId === session.user.id) ?? null;
            const editable = puedeValidar
              ? { valor: r.valor, comentario: r.comentario, riesgoIdentificado: r.riesgoIdentificado }
              : {
                  valor: propio?.valor ?? null,
                  comentario: propio?.comentario ?? null,
                  riesgoIdentificado: propio?.riesgoIdentificado ?? null,
                };
            return (
            <PreguntaItem
              key={r.id}
              respuesta={{
                id: r.id,
                valor: editable.valor,
                comentario: editable.comentario,
                riesgoIdentificado: editable.riesgoIdentificado,
                estado: r.estado,
                observacionConsultor: r.observacionConsultor,
              }}
              aportes={
                puedeValidar
                  ? r.aportes.map((a) => ({
                      autor: a.user.nombre,
                      cargo: a.user.cargo,
                      valor: a.valor,
                      comentario: a.comentario,
                      riesgoIdentificado: a.riesgoIdentificado,
                    }))
                  : []
              }
              consolidadaManual={r.consolidadaManual}
              pregunta={{
                orden: r.pregunta.orden,
                texto: r.pregunta.texto,
                descripcion: r.pregunta.descripcion,
                evidenciaObligatoria: r.pregunta.evidenciaObligatoria,
              }}
              puedeValidar={puedeValidar}
              bloqueado={dominioEnviado}
              evidencias={r.evidencias.map((e) => ({
                id: e.id,
                nombre: e.nombre,
                tipoDocumental: e.tipoDocumental,
                estado: e.estado,
                archivoPath: e.archivoPath,
                observaciones: e.observaciones,
              }))}
            />
            );
          })}
        </CardContent>
      </Card>

      {puedeValidar ? (
        <ValidacionDominio
          diagnosticoDominioId={dd.id}
          completado={dd.estado === "COMPLETADO"}
          cerrado={dominioEnviado}
          total={total}
          respondidas={dd.respuestas.filter((r) => r.valor != null).length}
          validadas={dd.respuestas.filter((r) => r.estado === "VALIDADA").length}
          observadas={dd.respuestas.filter((r) => r.estado === "OBSERVADA").length}
          sinEvidencia={
            dd.respuestas.filter(
              (r) =>
                r.pregunta.evidenciaObligatoria &&
                ["3", "4", "5"].includes(r.valor ?? "") &&
                !r.evidencias.some((e) => e.archivoPath)
            ).length
          }
        />
      ) : (
        <EnviarDominio
          diagnosticoDominioId={dd.id}
          totalPreguntas={total}
          respondidas={completas}
          enviado={dominioEnviado}
        />
      )}
    </>
  );
}
