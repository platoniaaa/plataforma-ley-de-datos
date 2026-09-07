"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession, esStaffP360, sinAccesoAEmpresa } from "@/lib/session";
import { esParticipanteDominio } from "@/lib/data/diagnosticos";
import { requiereComentario, ROLES, VALORES } from "@/lib/constants";
import { consolidarAportes } from "@/lib/engines/consolidacion";

const schema = z.object({
  respuestaId: z.string().min(1),
  valor: z.enum(VALORES),
  comentario: z.string().max(2000).optional().default(""),
  riesgoIdentificado: z.string().max(1000).optional().default(""),
});

export type RespuestaResult = { ok: boolean; error?: string };

/**
 * Recalcula la respuesta oficial a partir de los aportes de los participantes.
 * No hace nada si el consultor la fijó a mano: su criterio manda sobre la regla.
 */
async function reconsolidarRespuesta(respuestaId: string, ultimoAutorId: string): Promise<void> {
  const respuesta = await prisma.respuesta.findUnique({
    where: { id: respuestaId },
    select: {
      consolidadaManual: true,
      aportes: {
        select: {
          valor: true,
          comentario: true,
          riesgoIdentificado: true,
          user: { select: { nombre: true } },
        },
      },
    },
  });
  if (!respuesta || respuesta.consolidadaManual) return;

  const consolidado = consolidarAportes(
    respuesta.aportes.map((a) => ({
      valor: a.valor,
      comentario: a.comentario,
      riesgoIdentificado: a.riesgoIdentificado,
      autor: a.user.nombre,
    }))
  );

  const completa =
    consolidado.valor != null &&
    (!requiereComentario(consolidado.valor) || Boolean(consolidado.comentario?.trim()));

  await prisma.respuesta.update({
    where: { id: respuestaId },
    data: {
      valor: consolidado.valor,
      comentario: consolidado.comentario,
      riesgoIdentificado: consolidado.riesgoIdentificado,
      estado: completa ? "RESPONDIDA" : "PENDIENTE",
      respondidoPorId: ultimoAutorId,
    },
  });
}

export async function guardarRespuesta(input: z.input<typeof schema>): Promise<RespuestaResult> {
  const session = await requireSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { respuestaId, valor, comentario, riesgoIdentificado } = parsed.data;

  // Cargar respuesta + cadena hacia el diagnóstico para control de acceso.
  const respuesta = await prisma.respuesta.findUnique({
    where: { id: respuestaId },
    include: {
      diagnosticoDominio: {
        include: { diagnostico: { select: { id: true, empresaId: true } }, dominio: { select: { orden: true } } },
      },
    },
  });
  if (!respuesta) return { ok: false, error: "Respuesta no encontrada." };

  const diag = respuesta.diagnosticoDominio.diagnostico;
  if (sinAccesoAEmpresa(session, diag.empresaId)) {
    return { ok: false, error: "Sin acceso." };
  }
  // El Responsable de Dominio solo responde los dominios en los que participa.
  if (
    session.user.role === ROLES.RESPONSABLE_DOMINIO &&
    !(await esParticipanteDominio(respuesta.diagnosticoDominio.id, session.user.id))
  ) {
    return { ok: false, error: "Este dominio no está asignado a ti." };
  }

  // Ya enviado a validación: solo se reabre lo que el consultor observó (§6.6).
  const dominioBloqueado = ["EN_VALIDACION", "COMPLETADO"].includes(
    respuesta.diagnosticoDominio.estado
  );
  if (dominioBloqueado && respuesta.estado !== "OBSERVADA") {
    return { ok: false, error: "El dominio ya fue enviado a validación." };
  }

  const esConsultor = esStaffP360(session.user.role);

  if (esConsultor) {
    // El consultor escribe directamente la respuesta oficial y la deja fijada, para que
    // un aporte posterior de un participante no le sobrescriba el criterio.
    const completa = !requiereComentario(valor) || Boolean(comentario.trim());
    await prisma.respuesta.update({
      where: { id: respuestaId },
      data: {
        valor,
        comentario: comentario.trim() || null,
        riesgoIdentificado: riesgoIdentificado.trim() || null,
        estado: completa ? "RESPONDIDA" : "PENDIENTE",
        respondidoPorId: session.user.id,
        consolidadaManual: true,
      },
    });
  } else {
    // El participante escribe SU aporte: nunca toca lo de sus colegas. La respuesta
    // oficial se recalcula a partir de todos los aportes del dominio.
    await prisma.aporteRespuesta.upsert({
      where: { respuestaId_userId: { respuestaId, userId: session.user.id } },
      create: {
        respuestaId,
        userId: session.user.id,
        valor,
        comentario: comentario.trim() || null,
        riesgoIdentificado: riesgoIdentificado.trim() || null,
      },
      update: {
        valor,
        comentario: comentario.trim() || null,
        riesgoIdentificado: riesgoIdentificado.trim() || null,
      },
    });
    await reconsolidarRespuesta(respuestaId, session.user.id);
  }

  // Marcar el dominio en ejecución (si no venía de una corrección post-validación).
  if (!dominioBloqueado) {
    await prisma.diagnosticoDominio.update({
      where: { id: respuesta.diagnosticoDominioId },
      data: { estado: "EN_EJECUCION" },
    });
  }

  revalidatePath(
    `/diagnosticos/${diag.id}/dominios/${respuesta.diagnosticoDominio.dominio.orden}`
  );
  revalidatePath(`/diagnosticos/${diag.id}`);
  return { ok: true };
}

// ───────────────────────── Envío del dominio a validación ─────────────────────────

export type Faltante = { orden: number; motivo: string };
export type Colega = { nombre: string; faltan: number; eresTu: boolean };
export type EnvioResult = {
  ok: boolean;
  error?: string;
  faltantes?: Faltante[];
  /** Participantes del dominio que todavía no registran todas sus respuestas. */
  colegas?: Colega[];
};

/**
 * Cierra el cuestionario del dominio y lo deja en manos del consultor.
 * Aquí se exigen las reglas del §7.5: toda pregunta respondida, comentario obligatorio
 * en 0/1/2/N-A/Otro, y evidencia cargada donde la pregunta la exige.
 */
export async function enviarDominio(diagnosticoDominioId: string): Promise<EnvioResult> {
  const session = await requireSession();

  const dd = await prisma.diagnosticoDominio.findUnique({
    where: { id: diagnosticoDominioId },
    include: {
      diagnostico: { select: { id: true, empresaId: true } },
      dominio: { select: { orden: true } },
      participantes: { select: { userId: true, user: { select: { nombre: true } } } },
      respuestas: {
        include: {
          pregunta: { select: { orden: true, evidenciaObligatoria: true } },
          evidencias: { select: { id: true, archivoPath: true } },
          aportes: { select: { userId: true, valor: true } },
        },
        orderBy: { pregunta: { orden: "asc" } },
      },
    },
  });
  if (!dd) return { ok: false, error: "Dominio no encontrado." };

  if (sinAccesoAEmpresa(session, dd.diagnostico.empresaId)) {
    return { ok: false, error: "Sin acceso." };
  }
  if (
    session.user.role === ROLES.RESPONSABLE_DOMINIO &&
    !(await esParticipanteDominio(dd.id, session.user.id))
  ) {
    return { ok: false, error: "Este dominio no está asignado a ti." };
  }
  if (["EN_VALIDACION", "COMPLETADO"].includes(dd.estado)) {
    return { ok: false, error: "Este dominio ya fue enviado a validación." };
  }

  // Enviar deja el dominio en solo lectura para TODOS sus participantes, no solo para
  // quien aprieta el botón. Antes de permitírselo a un participante hay que verificar que
  // sus colegas ya registraron lo suyo: el 21-08 el primero en terminar el RAT cerró el
  // dominio mientras una compañera iba en la pregunta 5, y la dejó afuera sin aviso.
  //
  // El consultor sí puede cerrarlo con lo que haya: es su decisión de alcance, y de otro
  // modo un participante mal asignado dejaría el dominio abierto para siempre.
  if (session.user.role === ROLES.RESPONSABLE_DOMINIO) {
    const colegas: Colega[] = dd.participantes
      .map((p) => ({
        nombre: p.user.nombre,
        eresTu: p.userId === session.user.id,
        faltan: dd.respuestas.filter(
          (r) => !r.aportes.some((a) => a.userId === p.userId && a.valor != null)
        ).length,
      }))
      .filter((c) => c.faltan > 0)
      .sort((a, b) => b.faltan - a.faltan);

    if (colegas.length > 0) return { ok: false, colegas };
  }

  const faltantes: Faltante[] = [];
  for (const r of dd.respuestas) {
    const orden = r.pregunta.orden;
    if (r.valor == null) {
      faltantes.push({ orden, motivo: "sin responder" });
      continue;
    }
    if (requiereComentario(r.valor) && !r.comentario?.trim()) {
      faltantes.push({ orden, motivo: "falta el comentario obligatorio" });
      continue;
    }
    // La evidencia solo se exige cuando la respuesta afirma que el control EXISTE (3/4/5).
    // Para 0/1/2/N-A/Otro no hay qué adjuntar; el comentario obligatorio es la justificación.
    // (Consistente con el motor de brechas, src/lib/engines/brechas.ts.)
    if (
      r.pregunta.evidenciaObligatoria &&
      ["3", "4", "5"].includes(r.valor) &&
      !r.evidencias.some((e) => e.archivoPath)
    ) {
      faltantes.push({ orden, motivo: "falta la evidencia obligatoria" });
    }
  }
  if (faltantes.length > 0) return { ok: false, faltantes };

  await prisma.diagnosticoDominio.update({
    where: { id: dd.id },
    data: { estado: "EN_VALIDACION" },
  });
  // El diagnóstico entra en validación en cuanto llega el primer dominio.
  await prisma.diagnostico.update({
    where: { id: dd.diagnostico.id },
    data: { estado: "EN_VALIDACION" },
  });

  revalidatePath(`/diagnosticos/${dd.diagnostico.id}/dominios/${dd.dominio.orden}`);
  revalidatePath(`/diagnosticos/${dd.diagnostico.id}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
