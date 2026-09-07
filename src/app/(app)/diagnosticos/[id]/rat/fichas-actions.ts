"use server";

import { randomUUID } from "crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession, esStaffP360, sinAccesoAEmpresa } from "@/lib/session";
import {
  crearUrlSubidaEvidencia,
  eliminarArchivoEvidencia,
  storageConfigurado,
} from "@/lib/storage";
import { MAX_EVIDENCIA_BYTES, MAX_EVIDENCIA_MB, MAX_FICHAS_LOTE } from "@/lib/constants";

// Fichas de proceso: el trabajo de campo del equipo consultor.
//
// Solo las sube y las borra Procesos360. No es una restricción por desconfianza: una
// ficha es lo que NOSOTROS levantamos en la entrevista, y si el cliente pudiera
// editarla dejaría de servir como contraste independiente de lo que él mismo declaró en
// el cuestionario. El cliente aporta por el otro carril, que son las evidencias.

export type FichaResult = { ok: boolean; error?: string; creadas?: number };

async function permiso(empresaId: string) {
  const session = await requireSession();
  if (!esStaffP360(session.user.role)) {
    return { error: "Las fichas de proceso las mantiene el equipo consultor." };
  }
  if (sinAccesoAEmpresa(session, empresaId)) return { error: "Sin acceso." };
  // Que la empresa exista se comprueba aquí y no al registrar. El staff global pasa el
  // control de acceso con cualquier id, y antes eso alcanzaba para firmar las URL de
  // subida: los archivos llegaban a Storage y recién despues fallaba el registro, dejando
  // basura sin dueño que nadie iba a encontrar.
  if ((await prisma.empresa.count({ where: { id: empresaId } })) === 0) {
    return { error: "Esa empresa no existe." };
  }
  return { session };
}

function sanitizar(nombre: string): string {
  return nombre.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
}

export type Destino = { signedUrl?: string; path?: string; error?: string };

/**
 * Paso 1: una URL firmada por archivo, para que viajen del navegador directo a Storage.
 *
 * Se piden todas juntas y no una por una. Subir de a uno era el reclamo: cada ficha
 * costaba dos viajes al servidor más el formulario completo, y un levantamiento de área
 * son seis fichas. Ahora una jornada entera son dos viajes.
 *
 * Los destinos vuelven alineados por posición con lo que se pidió, cada uno con su
 * error si lo tiene: que un archivo se pase de tamaño no puede cancelar los otros
 * diecinueve.
 */
export async function prepararSubidaFichas(
  empresaId: string,
  archivos: { nombre: string; tamano: number }[]
): Promise<{ ok: boolean; error?: string; destinos?: Destino[] }> {
  const { error } = await permiso(empresaId);
  if (error) return { ok: false, error };
  if (!storageConfigurado()) {
    return { ok: false, error: "Storage no configurado en el servidor." };
  }
  if (archivos.length === 0) return { ok: false, error: "No elegiste ningún archivo." };
  if (archivos.length > MAX_FICHAS_LOTE) {
    return { ok: false, error: `Son ${archivos.length} archivos: el máximo por tanda es ${MAX_FICHAS_LOTE}.` };
  }

  const destinos: Destino[] = [];
  for (const a of archivos) {
    if (a.tamano > MAX_EVIDENCIA_BYTES) {
      destinos.push({ error: `supera ${MAX_EVIDENCIA_MB} MB` });
      continue;
    }
    // Prefijo propio: las fichas no se mezclan con las evidencias del cliente ni en la ruta.
    const path = `fichas/${empresaId}/${randomUUID()}-${sanitizar(a.nombre)}`;
    try {
      const { signedUrl } = await crearUrlSubidaEvidencia(path);
      destinos.push({ signedUrl, path });
    } catch (e) {
      destinos.push({ error: `no se pudo preparar: ${(e as Error).message.slice(0, 80)}` });
    }
  }
  return { ok: true, destinos };
}

const registrarSchema = z.object({
  empresaId: z.string().min(1),
  // El área y el contexto valen para la tanda entera: quien sube seis fichas de una
  // entrevista las sube todas de la misma área, y escribirlo seis veces es el trámite que
  // hacía preferible no usar la plataforma.
  areaId: z.string().optional(),
  descripcion: z.string().max(1000).optional(),
  fichas: z
    .array(
      z.object({
        nombre: z.string().trim().min(3, "Ponle un nombre a la ficha.").max(200),
        archivoPath: z.string().min(1),
        mimeType: z.string().optional(),
        tamano: z.number().int().nonnegative().optional(),
      })
    )
    .min(1)
    .max(MAX_FICHAS_LOTE),
});

/** Paso 2: registra las fichas cuyos archivos ya llegaron a Storage. */
export async function registrarFichas(
  input: z.input<typeof registrarSchema>
): Promise<FichaResult> {
  const parsed = registrarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const d = parsed.data;
  const { session, error } = await permiso(d.empresaId);
  if (error || !session) return { ok: false, error };

  if (d.areaId) {
    const ok = await prisma.area.count({ where: { id: d.areaId, empresaId: d.empresaId } });
    if (ok === 0) return { ok: false, error: "Esa área no pertenece a esta empresa." };
  }

  await prisma.fichaProceso.createMany({
    data: d.fichas.map((f) => ({
      empresaId: d.empresaId,
      areaId: d.areaId || null,
      nombre: f.nombre,
      descripcion: d.descripcion?.trim() || null,
      archivoPath: f.archivoPath,
      mimeType: f.mimeType ?? null,
      tamano: f.tamano ?? null,
      subidoPorId: session.user.id,
    })),
  });

  revalidatePath("/diagnosticos", "layout");
  return { ok: true, creadas: d.fichas.length };
}

export async function eliminarFicha(id: string): Promise<FichaResult> {
  const ficha = await prisma.fichaProceso.findUnique({
    where: { id },
    select: { empresaId: true, archivoPath: true },
  });
  if (!ficha) return { ok: false, error: "Ficha no encontrada." };
  const { error } = await permiso(ficha.empresaId);
  if (error) return { ok: false, error };

  // Primero la fila y después el archivo: si falla el borrado en Storage queda un archivo
  // huérfano, que es molesto; al revés queda una ficha que apunta a la nada, que rompe.
  await prisma.fichaProceso.delete({ where: { id } });
  if (ficha.archivoPath) await eliminarArchivoEvidencia(ficha.archivoPath);

  revalidatePath("/diagnosticos", "layout");
  return { ok: true };
}
