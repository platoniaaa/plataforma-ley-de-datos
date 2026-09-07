"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdminGlobal } from "@/lib/session";

export type Result = { ok: boolean; error?: string };

const dominioSchema = z.object({
  dominioId: z.string().min(1),
  nombre: z.string().min(2).max(200),
  objetivo: z.string().min(2).max(1000),
});

/** Edita nombre y objetivo de un dominio del catálogo. */
export async function actualizarDominioAction(input: z.input<typeof dominioSchema>): Promise<Result> {
  await requireAdminGlobal();
  const parsed = dominioSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  await prisma.dominio.update({
    where: { id: parsed.data.dominioId },
    data: { nombre: parsed.data.nombre, objetivo: parsed.data.objetivo },
  });
  revalidatePath("/admin/catalogo");
  return { ok: true };
}

const preguntaSchema = z.object({
  id: z.string().optional(),
  dominioId: z.string().min(1),
  texto: z.string().min(3).max(600),
  descripcion: z.string().max(1000).optional().default(""),
  evidenciaObligatoria: z.boolean().optional().default(false),
});

/** Crea o edita una pregunta de un dominio. */
export async function guardarPreguntaAction(input: z.input<typeof preguntaSchema>): Promise<Result> {
  await requireAdminGlobal();
  const parsed = preguntaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const d = parsed.data;

  if (d.id) {
    await prisma.pregunta.update({
      where: { id: d.id },
      data: { texto: d.texto, descripcion: d.descripcion, evidenciaObligatoria: d.evidenciaObligatoria },
    });
  } else {
    const max = await prisma.pregunta.aggregate({
      where: { dominioId: d.dominioId },
      _max: { orden: true },
    });
    await prisma.pregunta.create({
      data: {
        dominioId: d.dominioId,
        orden: (max._max.orden ?? 0) + 1,
        texto: d.texto,
        descripcion: d.descripcion,
        evidenciaObligatoria: d.evidenciaObligatoria,
      },
    });
  }
  revalidatePath("/admin/catalogo");
  return { ok: true };
}

/** Elimina una pregunta (y sus respuestas asociadas por cascada). */
export async function eliminarPreguntaAction(preguntaId: string): Promise<Result> {
  await requireAdminGlobal();
  await prisma.pregunta.delete({ where: { id: preguntaId } });
  revalidatePath("/admin/catalogo");
  return { ok: true };
}
