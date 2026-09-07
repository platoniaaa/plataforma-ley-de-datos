"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession, esStaffP360, sinAccesoAEmpresa } from "@/lib/session";
import { ROLES_P360 } from "@/lib/constants";

export type EquipoResult = { ok: boolean; error?: string };

const schema = z.object({
  diagnosticoId: z.string().min(1),
  // Cadena vacía = sin líder designado.
  liderId: z.string(),
  miembrosIds: z.array(z.string()).max(20),
});

/**
 * Define quién responde por este diagnóstico: un líder y su equipo.
 *
 * No otorga permisos —el staff de Procesos360 ya ve todas las empresas—, así que lo
 * único que hay que cuidar es que no se cuele gente del cliente en la lista: es la
 * constancia de quién intervino, y ahí no puede figurar quien no corresponde.
 */
export async function configurarEquipoAction(
  input: z.input<typeof schema>
): Promise<EquipoResult> {
  const session = await requireSession();
  if (!esStaffP360(session.user.role)) {
    return { ok: false, error: "Solo el equipo consultor puede asignarse a un diagnóstico." };
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { diagnosticoId, liderId, miembrosIds } = parsed.data;

  const diag = await prisma.diagnostico.findUnique({
    where: { id: diagnosticoId },
    select: { id: true, empresaId: true },
  });
  if (!diag) return { ok: false, error: "Diagnóstico no encontrado." };
  if (sinAccesoAEmpresa(session, diag.empresaId)) return { ok: false, error: "Sin acceso." };

  // El líder cuenta como parte del equipo: aparece una sola vez en la lista.
  const ids = [...new Set([...(liderId ? [liderId] : []), ...miembrosIds].filter(Boolean))];

  if (ids.length > 0) {
    // Solo staff sin empresa asignada: una cuenta acotada al entorno de demostración no
    // puede figurar como responsable del trabajo de un cliente real.
    const validos = await prisma.user.count({
      where: { id: { in: ids }, role: { in: ROLES_P360 }, empresaId: null, activo: true },
    });
    if (validos !== ids.length) {
      return { ok: false, error: "Solo pueden asignarse consultores activos de Procesos360." };
    }
  }

  await prisma.$transaction([
    prisma.diagnostico.update({
      where: { id: diagnosticoId },
      data: { consultorId: liderId || null },
    }),
    prisma.consultorDiagnostico.deleteMany({
      where: { diagnosticoId, userId: { notIn: ids.length > 0 ? ids : ["__ninguno__"] } },
    }),
    ...ids.map((userId) =>
      prisma.consultorDiagnostico.upsert({
        where: { diagnosticoId_userId: { diagnosticoId, userId } },
        create: { diagnosticoId, userId },
        update: {},
      })
    ),
  ]);

  revalidatePath(`/diagnosticos/${diagnosticoId}`);
  revalidatePath(`/diagnosticos/${diagnosticoId}/configurar`);
  revalidatePath(`/diagnosticos/${diagnosticoId}/expediente`);
  revalidatePath("/diagnosticos");
  return { ok: true };
}
