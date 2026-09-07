"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession, esStaffP360, sinAccesoAEmpresa } from "@/lib/session";
import { ROLES } from "@/lib/constants";
import { generarBrechas, type RespuestaBrechaInput } from "@/lib/engines/brechas";

export type GenerarBrechasResult = { ok: boolean; count?: number; error?: string };

export async function generarBrechasAction(diagnosticoId: string): Promise<GenerarBrechasResult> {
  const session = await requireSession();
  if (session.user.role === ROLES.RESPONSABLE_DOMINIO) {
    return { ok: false, error: "No tienes permiso para esta accion. Tu rol solo responde el cuestionario de sus dominios asignados." };
  }

  const diag = await prisma.diagnostico.findUnique({
    where: { id: diagnosticoId },
    select: { id: true, empresaId: true },
  });
  if (!diag) return { ok: false, error: "Diagnóstico no encontrado." };
  if (sinAccesoAEmpresa(session, diag.empresaId)) {
    return { ok: false, error: "Sin acceso." };
  }

  const dds = await prisma.diagnosticoDominio.findMany({
    where: { diagnosticoId, incluido: true },
    include: {
      dominio: { select: { orden: true, nombre: true } },
      participantes: { select: { userId: true, user: { select: { nombre: true } } } },
      respuestas: {
        include: {
          pregunta: true,
          evidencias: { select: { id: true } },
          aportes: { select: { userId: true } },
        },
      },
    },
  });

  // Las brechas son el resultado del diagnóstico, no un avance de él: se calculan sobre
  // la respuesta consolidada, y esa respuesta no está completa mientras falte gente por
  // opinar. Generarlas antes produce un informe que cambia solo, y de esos números
  // cuelgan después los riesgos, el plan y lo que el cliente firma.
  const faltan = dds.flatMap((dd) =>
    dd.participantes
      .map((p) => ({
        dominio: dd.dominio.orden,
        nombre: p.user.nombre,
        pendientes: dd.respuestas.filter(
          (r) => !r.aportes.some((a) => a.userId === p.userId)
        ).length,
      }))
      .filter((x) => x.pendientes > 0)
  );
  if (faltan.length > 0) {
    const detalle = faltan
      .slice(0, 6)
      .map((f) => `${f.nombre} (dominio ${f.dominio}, ${f.pendientes})`)
      .join("; ");
    return {
      ok: false,
      error:
        `Todavía falta gente por responder, así que las brechas cambiarían: ${detalle}` +
        (faltan.length > 6 ? ` y ${faltan.length - 6} más.` : ".") +
        " Cierra el levantamiento antes de generarlas.",
    };
  }

  const inputs: RespuestaBrechaInput[] = dds.flatMap((dd) =>
    dd.respuestas
      .filter((r) => r.valor != null) // sólo respuestas contestadas
      .map((r) => ({
        respuestaId: r.id,
        valor: r.valor,
        comentario: r.comentario,
        tieneEvidencia: r.evidencias.length > 0,
        pregunta: {
          orden: r.pregunta.orden,
          texto: r.pregunta.texto,
          evidenciaObligatoria: r.pregunta.evidenciaObligatoria,
        },
        dominio: { orden: dd.dominio.orden, nombre: dd.dominio.nombre },
      }))
  );

  const brechas = generarBrechas(inputs);

  // Reemplazar las brechas existentes del diagnóstico.
  await prisma.brecha.deleteMany({ where: { diagnosticoId } });
  if (brechas.length > 0) {
    await prisma.brecha.createMany({
      data: brechas.map((b) => ({
        diagnosticoId,
        respuestaId: b.respuestaId,
        codigo: b.codigo,
        descripcion: b.descripcion,
        tipo: b.tipo,
        criticidad: b.criticidad,
        accionRecomendada: b.accionRecomendada,
        evidenciaEsperada: b.evidenciaEsperada,
      })),
    });
  }

  await prisma.diagnostico.update({
    where: { id: diagnosticoId },
    data: { estado: "CON_BRECHAS" },
  });

  revalidatePath(`/diagnosticos/${diagnosticoId}/brechas`);
  revalidatePath(`/diagnosticos/${diagnosticoId}`);
  return { ok: true, count: brechas.length };
}
