"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession, esStaffP360, sinAccesoAEmpresa } from "@/lib/session";
import { assertAccesoDiagnostico } from "@/lib/data/diagnosticos";
import { TIPO_DIAGNOSTICO, ESTADO_DIAGNOSTICO, ROLES_P360 } from "@/lib/constants";

export type CrearResult = { ok: boolean; id?: string; error?: string };
export type ConfigResult = { ok: boolean; error?: string };

const crearSchema = z.object({
  empresaId: z.string().min(1),
  nombre: z.string().min(3).max(200),
  tipo: z.enum(Object.keys(TIPO_DIAGNOSTICO) as [string, ...string[]]),
  fechaInicio: z.string().optional().default(""),
  fechaCierre: z.string().optional().default(""),
  consultorId: z.string().optional().default(""),
});

/** Crea un diagnóstico con sus 10 dominios y respuestas pendientes. */
export async function crearDiagnosticoAction(input: z.input<typeof crearSchema>): Promise<CrearResult> {
  const session = await requireSession();
  const parsed = crearSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { empresaId, nombre, tipo, fechaInicio, fechaCierre, consultorId } = parsed.data;

  // Acceso: staff P360 crea para cualquier empresa; ADMIN_EMPRESA solo la suya.
  if (sinAccesoAEmpresa(session, empresaId)) {
    return { ok: false, error: "Sin acceso a esa empresa." };
  }

  // El consultor asignado debe existir y ser staff P360; no cualquier userId del cliente.
  if (consultorId) {
    const ok = await prisma.user.count({ where: { id: consultorId, role: { in: ROLES_P360 } } });
    if (ok === 0) return { ok: false, error: "El consultor asignado no es parte del staff Procesos360." };
  }

  const dominios = await prisma.dominio.findMany({
    orderBy: { orden: "asc" },
    include: { preguntas: { select: { id: true } } },
  });
  if (dominios.length === 0) return { ok: false, error: "No hay catálogo de dominios." };

  const diag = await prisma.diagnostico.create({
    data: {
      empresaId,
      nombre,
      tipo,
      estado: "BORRADOR",
      fechaInicio: fechaInicio ? new Date(fechaInicio) : null,
      fechaCierre: fechaCierre ? new Date(fechaCierre) : null,
      consultorId: consultorId || null,
    },
  });

  for (const d of dominios) {
    const dd = await prisma.diagnosticoDominio.create({
      data: { diagnosticoId: diag.id, dominioId: d.id, estado: "PENDIENTE" },
    });
    if (d.preguntas.length > 0) {
      await prisma.respuesta.createMany({
        data: d.preguntas.map((p) => ({
          diagnosticoDominioId: dd.id,
          preguntaId: p.id,
          estado: "PENDIENTE",
        })),
      });
    }
  }

  revalidatePath("/diagnosticos");
  return { ok: true, id: diag.id };
}

const configSchema = z.object({
  diagnosticoId: z.string().min(1),
  nombre: z.string().min(3).max(200).optional(),
  tipo: z.enum(Object.keys(TIPO_DIAGNOSTICO) as [string, ...string[]]).optional(),
  fechaInicio: z.string().optional(),
  fechaCierre: z.string().optional(),
  consultorId: z.string().optional(),
  dominios: z.array(
    z.object({
      diagnosticoDominioId: z.string().min(1),
      incluido: z.boolean(),
      participantesIds: z.array(z.string()).optional().default([]),
      responsablesEvidenciaIds: z.array(z.string()).optional().default([]),
      areaId: z.string().optional().default(""),
      justificacionNoAplica: z.string().max(1000).optional().default(""),
    })
  ),
});

/** Configura el alcance del diagnóstico: dominios incluidos, responsables y áreas. */
export async function configurarDiagnosticoAction(input: z.input<typeof configSchema>): Promise<ConfigResult> {
  const session = await requireSession();
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const data = parsed.data;

  const diag = await assertAccesoDiagnostico(data.diagnosticoId, session);
  if (!diag) return { ok: false, error: "Sin acceso al diagnóstico." };

  // El acceso valida `diagnosticoId`, no los IDs del array de dominios: sin este chequeo se
  // podrían configurar dominios de OTRO diagnóstico (y otra empresa) — IDOR de escritura.
  const ddIds = data.dominios.map((d) => d.diagnosticoDominioId);
  if (new Set(ddIds).size !== ddIds.length) return { ok: false, error: "Dominios duplicados." };
  const ddValidos = await prisma.diagnosticoDominio.count({
    where: { id: { in: ddIds }, diagnosticoId: data.diagnosticoId },
  });
  if (ddValidos !== ddIds.length) {
    return { ok: false, error: "Dominios inválidos para este diagnóstico." };
  }

  // Participantes y áreas deben pertenecer a la empresa del diagnóstico, no a la del solicitante.
  const participanteIds = [...new Set(data.dominios.flatMap((d) => d.participantesIds).filter(Boolean))];
  const areaIds = [...new Set(data.dominios.map((d) => d.areaId).filter(Boolean))];
  const [participantesOk, areasOk, consultorOk] = await Promise.all([
    participanteIds.length
      ? prisma.user.count({ where: { id: { in: participanteIds }, empresaId: diag.empresaId } })
      : 0,
    areaIds.length
      ? prisma.area.count({ where: { id: { in: areaIds }, empresaId: diag.empresaId } })
      : 0,
    data.consultorId
      ? prisma.user.count({ where: { id: data.consultorId, role: { in: ROLES_P360 } } })
      : 0,
  ]);
  if (participantesOk !== participanteIds.length) {
    return { ok: false, error: "Un participante no pertenece a la empresa del diagnóstico." };
  }
  if (areasOk !== areaIds.length) {
    return { ok: false, error: "Un área no pertenece a la empresa del diagnóstico." };
  }
  if (data.consultorId && consultorOk === 0) {
    return { ok: false, error: "El consultor asignado no es parte del staff Procesos360." };
  }

  // Atómico: la configuración del alcance no puede quedar aplicada a medias.
  await prisma.$transaction(
    async (tx) => {
      await tx.diagnostico.update({
        where: { id: data.diagnosticoId },
        data: {
          ...(data.nombre ? { nombre: data.nombre } : {}),
          ...(data.tipo ? { tipo: data.tipo } : {}),
          ...(data.fechaInicio !== undefined ? { fechaInicio: data.fechaInicio ? new Date(data.fechaInicio) : null } : {}),
          ...(data.fechaCierre !== undefined ? { fechaCierre: data.fechaCierre ? new Date(data.fechaCierre) : null } : {}),
          ...(data.consultorId !== undefined ? { consultorId: data.consultorId || null } : {}),
          estado: diag.estado === "BORRADOR" ? "CONFIGURADO" : diag.estado,
        },
      });

      for (const d of data.dominios) {
        // Scope por diagnóstico repetido a propósito: defensa en profundidad.
        await tx.diagnosticoDominio.updateMany({
          where: { id: d.diagnosticoDominioId, diagnosticoId: data.diagnosticoId },
          data: {
            incluido: d.incluido,
            areaId: d.areaId || null,
            justificacionNoAplica: d.justificacionNoAplica.trim() || null,
          },
        });

        // Incluir un dominio no creaba sus preguntas: solo se generaban al crear el
        // diagnóstico. Un dominio sumado despues quedaba dentro del alcance con el
        // cuestionario vacío, y sus participantes sin nada que responder —le pasó a
        // Honda con Tecnología y Ciberseguridad y con Retención de Datos—. Se crean las
        // que falten, nunca se borran: una respuesta ya escrita no se toca.
        if (d.incluido) {
          const dd = await tx.diagnosticoDominio.findUnique({
            where: { id: d.diagnosticoDominioId },
            select: { dominioId: true, respuestas: { select: { preguntaId: true } } },
          });
          if (dd) {
            const yaEstan = dd.respuestas.map((r) => r.preguntaId);
            const faltan = await tx.pregunta.findMany({
              where: { dominioId: dd.dominioId, id: { notIn: yaEstan } },
              select: { id: true },
            });
            if (faltan.length > 0) {
              await tx.respuesta.createMany({
                data: faltan.map((preg) => ({
                  diagnosticoDominioId: d.diagnosticoDominioId,
                  preguntaId: preg.id,
                  estado: "PENDIENTE",
                })),
                skipDuplicates: true,
              });
            }
          }
        }

        const ids = [...new Set(d.participantesIds.filter(Boolean))];
        await tx.participanteDominio.deleteMany({
          where: { diagnosticoDominioId: d.diagnosticoDominioId, userId: { notIn: ids } },
        });
        if (ids.length > 0) {
          await tx.participanteDominio.createMany({
            data: ids.map((userId) => ({ diagnosticoDominioId: d.diagnosticoDominioId, userId })),
            skipDuplicates: true,
          });
          // Responsables de evidencia: subconjunto de los participantes del dominio.
          const responsables = ids.filter((id) => d.responsablesEvidenciaIds.includes(id));
          await tx.participanteDominio.updateMany({
            where: { diagnosticoDominioId: d.diagnosticoDominioId },
            data: { responsableEvidencia: false },
          });
          if (responsables.length > 0) {
            await tx.participanteDominio.updateMany({
              where: { diagnosticoDominioId: d.diagnosticoDominioId, userId: { in: responsables } },
              data: { responsableEvidencia: true },
            });
          }
        }
      }
    },
    { timeout: 20000, maxWait: 10000 }
  );

  revalidatePath(`/diagnosticos/${data.diagnosticoId}`);
  revalidatePath(`/diagnosticos/${data.diagnosticoId}/configurar`);
  return { ok: true };
}

/** Cambia el estado del diagnóstico (avance del flujo). */
export async function cambiarEstadoAction(
  diagnosticoId: string,
  estado: keyof typeof ESTADO_DIAGNOSTICO
): Promise<ConfigResult> {
  const session = await requireSession();
  const diag = await assertAccesoDiagnostico(diagnosticoId, session);
  if (!diag) return { ok: false, error: "Sin acceso al diagnóstico." };
  if (!(estado in ESTADO_DIAGNOSTICO)) return { ok: false, error: "Estado inválido." };

  await prisma.diagnostico.update({ where: { id: diagnosticoId }, data: { estado } });
  revalidatePath(`/diagnosticos/${diagnosticoId}`);
  return { ok: true };
}
