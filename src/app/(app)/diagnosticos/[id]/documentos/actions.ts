"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession, esStaffP360, sinAccesoAEmpresa } from "@/lib/session";

export type ClasificarResult = { ok: boolean; error?: string };

const schema = z.object({
  evidenciaId: z.string().min(1),
  // Cadena vacía = quitar la clasificación.
  cubreEvidencia: z.string().max(300),
});

/**
 * Declara qué evidencia mínima del dominio queda cubierta con este documento.
 *
 * Lo hace el consultor y no el participante: es una lectura del documento contra el
 * estándar, no un dato que quien lo sube tenga por qué saber. Se valida que el valor
 * pertenezca a la lista del dominio para que la cobertura no se llene de texto libre
 * que después no calce con nada.
 */
export async function clasificarEvidencia(
  input: z.input<typeof schema>
): Promise<ClasificarResult> {
  const session = await requireSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { evidenciaId, cubreEvidencia } = parsed.data;

  if (!esStaffP360(session.user.role)) {
    return { ok: false, error: "Solo el equipo consultor puede clasificar la evidencia." };
  }

  const ev = await prisma.evidencia.findUnique({
    where: { id: evidenciaId },
    select: {
      archivoPath: true,
      respuesta: {
        select: {
          diagnosticoDominio: {
            select: {
              dominio: { select: { orden: true, evidenciasMinimas: true } },
              diagnostico: { select: { id: true, empresaId: true } },
            },
          },
        },
      },
    },
  });
  if (!ev?.respuesta) return { ok: false, error: "Documento no encontrado." };
  if (!ev.archivoPath) return { ok: false, error: "Esta evidencia todavía no tiene archivo." };

  const dd = ev.respuesta.diagnosticoDominio;
  if (sinAccesoAEmpresa(session, dd.diagnostico.empresaId)) {
    return { ok: false, error: "Sin acceso." };
  }

  const valor = cubreEvidencia.trim();
  if (valor) {
    const esperadas: string[] = JSON.parse(dd.dominio.evidenciasMinimas || "[]");
    if (!esperadas.includes(valor)) {
      return { ok: false, error: "Esa evidencia no pertenece a este dominio." };
    }
  }

  await prisma.evidencia.update({
    where: { id: evidenciaId },
    data: { cubreEvidencia: valor || null },
  });

  revalidatePath(`/diagnosticos/${dd.diagnostico.id}/documentos`);
  return { ok: true };
}
