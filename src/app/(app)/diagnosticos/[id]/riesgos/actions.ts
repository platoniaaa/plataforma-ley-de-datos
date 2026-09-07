"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession, esStaffP360, sinAccesoAEmpresa } from "@/lib/session";
import { assertAccesoDiagnostico } from "@/lib/data/diagnosticos";
import { generarRiesgos, type BrechaRiesgoInput } from "@/lib/engines/riesgos";
import { nivelRiesgo, PROBABILIDAD, IMPACTO, ROLES } from "@/lib/constants";

export type ActionResult = { ok: boolean; count?: number; error?: string };

/** Genera riesgos a partir de las brechas del diagnóstico (reemplaza los existentes). */
export async function generarRiesgosAction(diagnosticoId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.user.role === ROLES.RESPONSABLE_DOMINIO) {
    return { ok: false, error: "No tienes permiso para esta accion. Tu rol solo responde el cuestionario de sus dominios asignados." };
  }
  const diag = await assertAccesoDiagnostico(diagnosticoId, session);
  if (!diag) return { ok: false, error: "Sin acceso al diagnóstico." };

  const brechas = await prisma.brecha.findMany({
    where: { diagnosticoId },
    include: {
      respuesta: {
        select: { diagnosticoDominio: { select: { dominio: { select: { orden: true, nombre: true } } } } },
      },
    },
  });
  if (brechas.length === 0) {
    return { ok: false, error: "No hay brechas. Genera brechas antes de los riesgos." };
  }

  const inputs: BrechaRiesgoInput[] = brechas.map((b) => ({
    brechaId: b.id,
    codigo: b.codigo,
    descripcion: b.descripcion,
    tipo: b.tipo as BrechaRiesgoInput["tipo"],
    criticidad: b.criticidad,
    dominio: {
      orden: b.respuesta?.diagnosticoDominio.dominio.orden ?? 0,
      nombre: b.respuesta?.diagnosticoDominio.dominio.nombre ?? "—",
    },
  }));

  const riesgos = generarRiesgos(inputs);

  await prisma.riesgo.deleteMany({ where: { diagnosticoId } });
  await prisma.riesgo.createMany({
    data: riesgos.map((r) => ({
      diagnosticoId,
      brechaId: r.brechaId,
      descripcion: r.descripcion,
      causa: r.causa,
      consecuencia: r.consecuencia,
      probabilidad: r.probabilidad,
      impacto: r.impacto,
      nivel: r.nivel,
      controlExistente: r.controlExistente || null,
      mitigacion: r.mitigacion,
    })),
  });

  revalidatePath(`/diagnosticos/${diagnosticoId}/riesgos`);
  return { ok: true, count: riesgos.length };
}

const editSchema = z.object({
  riesgoId: z.string().min(1),
  probabilidad: z.enum(PROBABILIDAD),
  impacto: z.enum(IMPACTO),
  controlExistente: z.string().max(1000).optional().default(""),
  mitigacion: z.string().max(2000).optional().default(""),
});

/** Edita un riesgo (consultor/analista ajusta probabilidad/impacto → recalcula nivel). */
export async function editarRiesgoAction(input: z.input<typeof editSchema>): Promise<ActionResult> {
  const session = await requireSession();
  if (session.user.role === ROLES.RESPONSABLE_DOMINIO) {
    return { ok: false, error: "No tienes permiso para esta accion. Tu rol solo responde el cuestionario de sus dominios asignados." };
  }
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { riesgoId, probabilidad, impacto, controlExistente, mitigacion } = parsed.data;

  const riesgo = await prisma.riesgo.findUnique({
    where: { id: riesgoId },
    select: { diagnosticoId: true, diagnostico: { select: { empresaId: true } } },
  });
  if (!riesgo) return { ok: false, error: "Riesgo no encontrado." };
  if (sinAccesoAEmpresa(session, riesgo.diagnostico.empresaId)) {
    return { ok: false, error: "Sin acceso." };
  }

  await prisma.riesgo.update({
    where: { id: riesgoId },
    data: {
      probabilidad,
      impacto,
      nivel: nivelRiesgo(probabilidad, impacto),
      controlExistente: controlExistente.trim() || null,
      mitigacion: mitigacion.trim() || null,
    },
  });

  revalidatePath(`/diagnosticos/${riesgo.diagnosticoId}/riesgos`);
  return { ok: true };
}
