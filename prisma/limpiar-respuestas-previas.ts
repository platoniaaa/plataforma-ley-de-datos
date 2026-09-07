// Borra las respuestas cargadas ANTES de la sesión del 13-08-2026: eran del
// levantamiento de prueba y no deben mezclarse con las que responden los
// participantes reales.
//
// Qué hace con cada respuesta anterior al corte:
//   · borra los aportes de los participantes,
//   · borra sus evidencias (registro y archivo en Storage),
//   · deja la pregunta vacía y en PENDIENTE (la fila se conserva: es la que enlaza
//     el dominio con la pregunta del catálogo),
//   · y si el dominio queda sin ninguna respuesta, lo devuelve a PENDIENTE para que
//     no quede bloqueado y vacío.
//
// Las respuestas del 13-08 en adelante no se tocan.
//
// Uso: npx tsx prisma/limpiar-respuestas-previas.ts [--dry-run]

import { readFileSync } from "fs";
import { join } from "path";
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const prisma = new PrismaClient();

// Chile es UTC-4: el 13-08-2026 00:00 local equivale a las 04:00 UTC.
const CORTE = new Date("2026-08-13T04:00:00.000Z");
const BUCKET = "evidencias";

async function borrarArchivos(paths: string[]) {
  if (paths.length === 0) return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("  (Storage no configurado: los archivos quedan sin borrar)");
    return;
  }
  const { error } = await createClient(url, key).storage.from(BUCKET).remove(paths);
  if (error) console.warn(`  Aviso al borrar archivos: ${error.message}`);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const previas = await prisma.respuesta.findMany({
    where: { valor: { not: null }, updatedAt: { lt: CORTE } },
    select: {
      id: true,
      valor: true,
      updatedAt: true,
      pregunta: { select: { orden: true } },
      diagnosticoDominio: {
        select: { id: true, dominio: { select: { orden: true, nombre: true } } },
      },
      aportes: { select: { id: true } },
      evidencias: { select: { id: true, archivoPath: true } },
    },
    orderBy: [{ diagnosticoDominio: { dominio: { orden: "asc" } } }, { pregunta: { orden: "asc" } }],
  });

  if (previas.length === 0) {
    console.log("No hay respuestas anteriores al corte. Nada que hacer.");
    return;
  }

  const ids = previas.map((r) => r.id);
  const aportes = previas.reduce((n, r) => n + r.aportes.length, 0);
  const archivos = previas.flatMap((r) => r.evidencias.map((e) => e.archivoPath).filter(Boolean) as string[]);
  const dominios = new Set(previas.map((r) => r.diagnosticoDominio.id));

  console.log(`${dryRun ? "[DRY-RUN] " : ""}Corte: 13-08-2026 00:00 (Chile)\n`);
  console.log(`Respuestas a vaciar : ${previas.length}`);
  console.log(`Aportes a borrar    : ${aportes}`);
  console.log(`Archivos a borrar   : ${archivos.length}`);
  console.log(`Dominios afectados  : ${dominios.size}\n`);

  if (dryRun) {
    for (const r of previas) {
      console.log(`  D${r.diagnosticoDominio.dominio.orden} P${r.pregunta.orden} = ${r.valor}  (${r.updatedAt.toISOString().slice(0, 10)})`);
    }
    console.log("\n(dry-run: no se escribió nada)");
    return;
  }

  await prisma.aporteRespuesta.deleteMany({ where: { respuestaId: { in: ids } } });
  await prisma.evidencia.deleteMany({ where: { respuestaId: { in: ids } } });
  await borrarArchivos(archivos);

  await prisma.respuesta.updateMany({
    where: { id: { in: ids } },
    data: {
      valor: null,
      comentario: null,
      riesgoIdentificado: null,
      estado: "PENDIENTE",
      observacionConsultor: null,
      respondidoPorId: null,
      consolidadaManual: false,
    },
  });
  console.log(`Vaciadas ${previas.length} respuestas, ${aportes} aportes y ${archivos.length} archivos.`);

  // Un dominio sin ninguna respuesta no puede quedar bloqueado: vuelve a PENDIENTE.
  for (const ddId of dominios) {
    const quedan = await prisma.respuesta.count({
      where: { diagnosticoDominioId: ddId, valor: { not: null } },
    });
    if (quedan === 0) {
      const dd = await prisma.diagnosticoDominio.update({
        where: { id: ddId },
        data: { estado: "PENDIENTE" },
        select: { dominio: { select: { orden: true, nombre: true } } },
      });
      console.log(`  Dominio ${dd.dominio.orden} (${dd.dominio.nombre}) → PENDIENTE (quedó vacío)`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
