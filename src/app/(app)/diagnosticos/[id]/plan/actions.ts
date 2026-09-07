"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession, esStaffP360, sinAccesoAEmpresa } from "@/lib/session";
import { assertAccesoDiagnostico } from "@/lib/data/diagnosticos";
import { generarPlan, type BrechaPlanInput } from "@/lib/engines/plan";
import { ESTADO_ACCION, ROLES } from "@/lib/constants";

export type ActionResult = { ok: boolean; count?: number; error?: string };

/** Genera el plan de tratamiento a partir de las brechas (reemplaza el existente). */
export async function generarPlanAction(diagnosticoId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.user.role === ROLES.RESPONSABLE_DOMINIO) {
    return { ok: false, error: "No tienes permiso para esta accion. Tu rol solo responde el cuestionario de sus dominios asignados." };
  }
  const diag = await assertAccesoDiagnostico(diagnosticoId, session);
  if (!diag) return { ok: false, error: "Sin acceso al diagnóstico." };

  const brechas = await prisma.brecha.findMany({ where: { diagnosticoId } });
  if (brechas.length === 0) {
    return { ok: false, error: "No hay brechas. Genera brechas antes del plan." };
  }

  const inputs: BrechaPlanInput[] = brechas.map((b) => ({
    brechaId: b.id,
    codigo: b.codigo,
    descripcion: b.descripcion,
    criticidad: b.criticidad,
    accionRecomendada: b.accionRecomendada,
    evidenciaEsperada: b.evidenciaEsperada,
    responsableSugerido: b.responsableSugerido,
  }));

  const acciones = generarPlan(inputs);
  const base = diag.fechaInicio ?? new Date();

  await prisma.accionTratamiento.deleteMany({ where: { diagnosticoId } });
  await prisma.accionTratamiento.createMany({
    data: acciones.map((a) => ({
      diagnosticoId,
      brechaId: a.brechaId,
      descripcion: a.descripcion,
      responsable: a.responsable,
      prioridad: a.prioridad,
      esfuerzo: a.esfuerzo,
      plazo: new Date(base.getTime() + a.plazoDias * 24 * 60 * 60 * 1000),
      evidenciaEsperada: a.evidenciaEsperada,
    })),
  });

  await prisma.diagnostico.update({ where: { id: diagnosticoId }, data: { estado: "CON_PLAN" } });

  revalidatePath(`/diagnosticos/${diagnosticoId}/plan`);
  revalidatePath(`/diagnosticos/${diagnosticoId}/roadmap`);
  revalidatePath(`/diagnosticos/${diagnosticoId}`);
  return { ok: true, count: acciones.length };
}

const updateSchema = z.object({
  accionId: z.string().min(1),
  estado: z.enum(Object.keys(ESTADO_ACCION) as [string, ...string[]]),
  avance: z.number().int().min(0).max(100),
  validacionConsultor: z.boolean().optional(),
});

/** Actualiza el seguimiento de una acción (estado, % avance, validación del consultor). */
export async function actualizarAccionAction(input: z.input<typeof updateSchema>): Promise<ActionResult> {
  const session = await requireSession();
  if (session.user.role === ROLES.RESPONSABLE_DOMINIO) {
    return { ok: false, error: "No tienes permiso para esta accion. Tu rol solo responde el cuestionario de sus dominios asignados." };
  }
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { accionId, estado, avance, validacionConsultor } = parsed.data;

  const accion = await prisma.accionTratamiento.findUnique({
    where: { id: accionId },
    select: { diagnosticoId: true, diagnostico: { select: { empresaId: true } } },
  });
  if (!accion) return { ok: false, error: "Acción no encontrada." };
  if (sinAccesoAEmpresa(session, accion.diagnostico.empresaId)) {
    return { ok: false, error: "Sin acceso." };
  }

  // Solo el staff de Procesos360 (consultor) puede marcar la validación.
  const puedeValidar = esStaffP360(session.user.role);

  await prisma.accionTratamiento.update({
    where: { id: accionId },
    data: {
      estado,
      avance: estado === "CERRADA" ? 100 : avance,
      ...(puedeValidar && validacionConsultor !== undefined ? { validacionConsultor } : {}),
    },
  });

  revalidatePath(`/diagnosticos/${accion.diagnosticoId}/plan`);
  return { ok: true };
}
