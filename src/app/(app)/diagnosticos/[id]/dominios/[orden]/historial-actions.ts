"use server";

import { prisma } from "@/lib/db";
import { requireSession, puedeRevisarDominios } from "@/lib/session";

export type EntradaHistorial = {
  fecha: string;
  operacion: string;
  origen: "oficial" | "aporte" | "evidencia";
  autor: string;
  cambios: { campo: string; antes: string | null; despues: string | null }[];
};

export type HistorialResult = { ok: boolean; entradas?: EntradaHistorial[]; error?: string };

const ETIQUETA: Record<string, string> = {
  valor: "Nota",
  comentario: "Comentario",
  riesgoIdentificado: "Riesgo identificado",
  estado: "Estado",
  observacionConsultor: "Observación del consultor",
  nombre: "Nombre del documento",
  archivoPath: "Archivo",
};

/** Campos cuyo cambio interesa mostrar. El resto es ruido interno. */
const RELEVANTES = Object.keys(ETIQUETA);

function texto(v: unknown): string | null {
  if (v == null || v === "") return null;
  return String(v);
}

/**
 * Historial de una pregunta: cambios en la respuesta oficial, en los aportes de cada
 * participante y en sus evidencias.
 *
 * Lo ven quienes revisan el levantamiento, y solo el de su empresa: el historial muestra
 * quién escribió qué y cuándo lo cambió, que es justo lo que no puede cruzarse entre
 * clientes.
 */
export async function historialPregunta(respuestaId: string): Promise<HistorialResult> {
  await requireSession();

  // La respuesta debe existir (y de paso valida que el id es real).
  const existe = await prisma.respuesta.findUnique({
    where: { id: respuestaId },
    select: { id: true, diagnosticoDominio: { select: { diagnostico: { select: { empresaId: true } } } } },
  });
  if (!existe) return { ok: false, error: "Pregunta no encontrada." };
  if (!(await puedeRevisarDominios(existe.diagnosticoDominio.diagnostico.empresaId))) {
    return { ok: false, error: "No tienes permiso para ver este historial." };
  }

  // Se buscan también los aportes y evidencias que YA no existen: su id vive dentro
  // del propio registro histórico, así que se filtra por el respuestaId que llevan.
  const filas = await prisma.$queryRaw<
    { tabla: string; operacion: string; anterior: unknown; nuevo: unknown; fecha: Date }[]
  >`
    SELECT tabla, operacion, anterior, nuevo, fecha
    FROM "HistorialCambio"
    WHERE (tabla = 'Respuesta' AND "registroId" = ${respuestaId})
       OR (tabla IN ('AporteRespuesta','Evidencia')
           AND COALESCE(nuevo->>'respuestaId', anterior->>'respuestaId') = ${respuestaId})
    ORDER BY fecha DESC
    LIMIT 200
  `;

  // Nombres de los autores, resueltos de una sola vez.
  const ids = new Set<string>();
  for (const f of filas) {
    for (const reg of [f.nuevo, f.anterior] as (Record<string, unknown> | null)[]) {
      if (!reg) continue;
      for (const campo of ["userId", "respondidoPorId", "subidoPorId"]) {
        const v = reg[campo];
        if (typeof v === "string") ids.add(v);
      }
    }
  }
  const usuarios = ids.size
    ? await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, nombre: true } })
    : [];
  const nombre = new Map(usuarios.map((u) => [u.id, u.nombre]));

  const entradas: EntradaHistorial[] = [];
  for (const f of filas) {
    const nuevo = (f.nuevo ?? {}) as Record<string, unknown>;
    const anterior = (f.anterior ?? {}) as Record<string, unknown>;
    const reg = f.nuevo ? nuevo : anterior;

    const autorId =
      (reg["userId"] as string) ?? (reg["respondidoPorId"] as string) ?? (reg["subidoPorId"] as string);
    const autor = (autorId && nombre.get(autorId)) || "—";

    const origen =
      f.tabla === "Evidencia" ? "evidencia" : f.tabla === "AporteRespuesta" ? "aporte" : "oficial";

    const cambios = RELEVANTES.map((campo) => ({
      campo: ETIQUETA[campo],
      antes: texto(anterior[campo]),
      despues: texto(nuevo[campo]),
    })).filter((c) => c.antes !== c.despues);

    // Un registro sin cambios visibles no aporta nada al lector.
    if (cambios.length === 0 && f.operacion === "UPDATE") continue;

    entradas.push({
      fecha: f.fecha.toISOString(),
      operacion: f.operacion,
      origen,
      autor,
      cambios,
    });
  }

  return { ok: true, entradas };
}
