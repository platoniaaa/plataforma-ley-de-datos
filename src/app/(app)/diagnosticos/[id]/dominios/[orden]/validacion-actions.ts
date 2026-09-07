"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession, puedeRevisarDominios } from "@/lib/session";

// Cierre del ciclo de revisión: validar, observar y cerrar.
//
// El vocabulario ya estaba en el esquema (Respuesta.estado, DiagnosticoDominio.estado
// COMPLETADO) y `guardarRespuesta` ya sabía reabrir una pregunta observada aunque el
// dominio esté cerrado. Lo único que faltaba era quién disparara todo eso: hasta ahora
// un dominio entraba en validación y se quedaba ahí para siempre.
//
// Quién puede hacerlo lo decide `puedeRevisarDominios`: el equipo consultor en cualquiera
// de sus clientes, y la contraparte del cliente que revisa, solo dentro de su empresa. La
// comprobación va SIEMPRE después de cargar el contexto, porque lo que autoriza no es el
// rol sino el rol junto con la empresa a la que pertenece lo que se está tocando.

export type ValidacionResult = { ok: boolean; error?: string };

const observacionSchema = z.object({
  respuestaId: z.string().min(1),
  // La observación es obligatoria: el punto de observar es decir qué hay que corregir.
  observacion: z.string().trim().min(3, "Escribe qué hay que corregir.").max(1000),
});

/** Carga la respuesta con la cadena hasta el diagnóstico, para el control de acceso. */
async function contexto(respuestaId: string) {
  return prisma.respuesta.findUnique({
    where: { id: respuestaId },
    select: {
      id: true,
      valor: true,
      diagnosticoDominio: {
        select: {
          id: true,
          estado: true,
          dominio: { select: { orden: true } },
          diagnostico: { select: { id: true, empresaId: true } },
        },
      },
    },
  });
}

function revalidar(diagId: string, orden: number) {
  revalidatePath(`/diagnosticos/${diagId}/dominios/${orden}`);
  revalidatePath(`/diagnosticos/${diagId}`);
  revalidatePath(`/diagnosticos/${diagId}/seguimiento`);
}

/** Da por buena la respuesta consolidada de una pregunta. */
export async function validarRespuesta(respuestaId: string): Promise<ValidacionResult> {
  await requireSession();

  const r = await contexto(respuestaId);
  if (!r) return { ok: false, error: "Pregunta no encontrada." };
  if (!(await puedeRevisarDominios(r.diagnosticoDominio.diagnostico.empresaId))) {
    return { ok: false, error: "No tienes permiso para revisar este dominio." };
  }
  if (r.valor == null) {
    return { ok: false, error: "No se puede validar una pregunta sin responder." };
  }

  await prisma.respuesta.update({
    where: { id: respuestaId },
    // Se limpia la observación anterior: si quedara, la pregunta se vería validada y
    // objetada a la vez, y el participante no sabría cuál de las dos rige.
    data: { estado: "VALIDADA", observacionConsultor: null },
  });

  revalidar(r.diagnosticoDominio.diagnostico.id, r.diagnosticoDominio.dominio.orden);
  return { ok: true };
}

/**
 * Devuelve una pregunta al participante con una observación.
 *
 * Es la vía formal para pedir una corrección puntual: `guardarRespuesta` deja editar
 * una pregunta OBSERVADA aunque el dominio esté en solo lectura, así que esto reabre
 * esa pregunta —y solo esa— sin devolver el dominio entero a ejecución.
 */
export async function observarRespuesta(
  input: z.input<typeof observacionSchema>
): Promise<ValidacionResult> {
  await requireSession();
  const parsed = observacionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const { respuestaId, observacion } = parsed.data;

  const r = await contexto(respuestaId);
  if (!r) return { ok: false, error: "Pregunta no encontrada." };
  if (!(await puedeRevisarDominios(r.diagnosticoDominio.diagnostico.empresaId))) {
    return { ok: false, error: "No tienes permiso para revisar este dominio." };
  }

  await prisma.respuesta.update({
    where: { id: respuestaId },
    data: { estado: "OBSERVADA", observacionConsultor: observacion },
  });

  // Un dominio dado por cerrado con una pregunta objetada no está cerrado: vuelve a
  // validación, para que el tablero no lo cuente como terminado.
  if (r.diagnosticoDominio.estado === "COMPLETADO") {
    await prisma.diagnosticoDominio.update({
      where: { id: r.diagnosticoDominio.id },
      data: { estado: "EN_VALIDACION" },
    });
  }

  revalidar(r.diagnosticoDominio.diagnostico.id, r.diagnosticoDominio.dominio.orden);
  return { ok: true };
}

async function contextoDominio(diagnosticoDominioId: string) {
  return prisma.diagnosticoDominio.findUnique({
    where: { id: diagnosticoDominioId },
    select: {
      id: true,
      estado: true,
      dominio: { select: { orden: true } },
      diagnostico: { select: { id: true, empresaId: true } },
      respuestas: { select: { estado: true, valor: true, pregunta: { select: { orden: true } } } },
    },
  });
}

/** Cierra el dominio: revisado y conforme. */
export async function cerrarDominio(
  diagnosticoDominioId: string
): Promise<ValidacionResult> {
  await requireSession();

  const dd = await contextoDominio(diagnosticoDominioId);
  if (!dd) return { ok: false, error: "Dominio no encontrado." };
  if (!(await puedeRevisarDominios(dd.diagnostico.empresaId))) {
    return { ok: false, error: "No tienes permiso para revisar este dominio." };
  }
  if (dd.estado === "COMPLETADO") return { ok: false, error: "Este dominio ya está cerrado." };

  const sinResponder = dd.respuestas.filter((r) => r.valor == null).map((r) => r.pregunta.orden);
  if (sinResponder.length > 0) {
    return {
      ok: false,
      error: `Quedan preguntas sin responder: ${sinResponder.join(", ")}.`,
    };
  }
  const observadas = dd.respuestas
    .filter((r) => r.estado === "OBSERVADA")
    .map((r) => r.pregunta.orden);
  if (observadas.length > 0) {
    return {
      ok: false,
      error: `Hay observaciones sin resolver en ${
        observadas.length === 1 ? "la pregunta" : "las preguntas"
      } ${observadas.join(", ")}.`,
    };
  }

  await prisma.diagnosticoDominio.update({
    where: { id: dd.id },
    data: { estado: "COMPLETADO" },
  });

  revalidar(dd.diagnostico.id, dd.dominio.orden);
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Devuelve el dominio a ejecución.
 *
 * El contrapeso de enviar: un dominio cerrado deja a sus participantes en solo lectura,
 * y cuando se cierra antes de tiempo —alguien apretó enviar mientras un colega iba por
 * la mitad— esta es la única forma de recoger lo que falta.
 */
export async function reabrirDominio(
  diagnosticoDominioId: string
): Promise<ValidacionResult> {
  await requireSession();

  const dd = await contextoDominio(diagnosticoDominioId);
  if (!dd) return { ok: false, error: "Dominio no encontrado." };
  if (!(await puedeRevisarDominios(dd.diagnostico.empresaId))) {
    return { ok: false, error: "No tienes permiso para revisar este dominio." };
  }
  if (!["EN_VALIDACION", "COMPLETADO"].includes(dd.estado)) {
    return { ok: false, error: "Este dominio ya está abierto." };
  }

  await prisma.diagnosticoDominio.update({
    where: { id: dd.id },
    data: { estado: "EN_EJECUCION" },
  });

  revalidar(dd.diagnostico.id, dd.dominio.orden);
  revalidatePath("/dashboard");
  return { ok: true };
}

// ───────────────────── Revisión en bloque ─────────────────────
//
// Un dominio tiene entre 4 y 16 preguntas y la mayoría se valida sin observaciones:
// obligar a apretar "Validar" dieciséis veces convierte la revisión en un trámite, y lo
// que se vuelve trámite se hace sin mirar.

export type BloqueResult = { ok: boolean; error?: string; afectadas?: number };

async function accesoAlDominio(diagnosticoDominioId: string) {
  await requireSession();
  const dd = await prisma.diagnosticoDominio.findUnique({
    where: { id: diagnosticoDominioId },
    select: {
      id: true,
      dominio: { select: { orden: true } },
      diagnostico: { select: { id: true, empresaId: true } },
    },
  });
  if (!dd) return { error: "Dominio no encontrado." };
  if (!(await puedeRevisarDominios(dd.diagnostico.empresaId))) {
    return { error: "No tienes permiso para revisar este dominio." };
  }
  return { dd };
}

/** Da por buenas todas las respuestas contestadas del dominio. */
export async function validarTodas(diagnosticoDominioId: string): Promise<BloqueResult> {
  const { dd, error } = await accesoAlDominio(diagnosticoDominioId);
  if (error || !dd) return { ok: false, error };

  const { count } = await prisma.respuesta.updateMany({
    // Una pregunta sin responder no se puede dar por buena: no hay qué validar.
    where: { diagnosticoDominioId, valor: { not: null }, estado: { not: "VALIDADA" } },
    data: { estado: "VALIDADA", observacionConsultor: null },
  });

  revalidar(dd.diagnostico.id, dd.dominio.orden);
  return { ok: true, afectadas: count };
}

/**
 * Deshace la validación: las respuestas vuelven a estar simplemente contestadas.
 *
 * No toca las observadas: esas esperan una corrección del participante, y devolverlas a
 * "respondida" borraría el pedido sin que nadie lo haya atendido.
 */
export async function deshacerValidaciones(
  diagnosticoDominioId: string
): Promise<BloqueResult> {
  const { dd, error } = await accesoAlDominio(diagnosticoDominioId);
  if (error || !dd) return { ok: false, error };

  const { count } = await prisma.respuesta.updateMany({
    where: { diagnosticoDominioId, estado: "VALIDADA" },
    data: { estado: "RESPONDIDA" },
  });

  revalidar(dd.diagnostico.id, dd.dominio.orden);
  return { ok: true, afectadas: count };
}

/** Quita la validación de una sola pregunta. */
export async function quitarValidacion(respuestaId: string): Promise<ValidacionResult> {
  await requireSession();
  const r = await contexto(respuestaId);
  if (!r) return { ok: false, error: "Pregunta no encontrada." };
  if (!(await puedeRevisarDominios(r.diagnosticoDominio.diagnostico.empresaId))) {
    return { ok: false, error: "No tienes permiso para revisar este dominio." };
  }

  await prisma.respuesta.update({
    where: { id: respuestaId },
    data: { estado: "RESPONDIDA" },
  });

  revalidar(r.diagnosticoDominio.diagnostico.id, r.diagnosticoDominio.dominio.orden);
  return { ok: true };
}
