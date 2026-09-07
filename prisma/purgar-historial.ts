// Purga la bitácora de cambios más antigua que la retención definida.
//
// 12 meses: cubre un ciclo completo de certificación, que es el plazo en que podría
// pedirse acreditar quién cambió qué. Más allá de eso el detalle deja de tener uso y
// solo ocupa espacio.
//
// Uso:
//   npx tsx prisma/purgar-historial.ts --dry-run   (muestra qué se borraría)
//   npx tsx prisma/purgar-historial.ts             (purga)
//
// Puede automatizarse con pg_cron (disponible en este proyecto):
//   CREATE EXTENSION IF NOT EXISTS pg_cron;
//   SELECT cron.schedule('purgar-historial', '0 4 1 * *',
//     $$DELETE FROM "HistorialCambio" WHERE fecha < now() - interval '12 months'$$);

import { readFileSync } from "fs";
import { join } from "path";
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const MESES_RETENCION = 12;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const corte = new Date();
  corte.setMonth(corte.getMonth() - MESES_RETENCION);

  const total = await prisma.historialCambio.count();
  const viejos = await prisma.historialCambio.count({ where: { fecha: { lt: corte } } });

  const [tamano]: { total: string }[] = await prisma.$queryRawUnsafe(
    `SELECT pg_size_pretty(pg_total_relation_size('"HistorialCambio"')) AS total`
  );

  console.log(`Retención: ${MESES_RETENCION} meses (corte: ${corte.toISOString().slice(0, 10)})`);
  console.log(`Registros: ${total} · a purgar: ${viejos} · tamaño de la tabla: ${tamano.total}`);

  if (viejos === 0) { console.log("Nada que purgar."); return; }
  if (dryRun) { console.log("\n(dry-run: no se borró nada)"); return; }

  const { count } = await prisma.historialCambio.deleteMany({ where: { fecha: { lt: corte } } });
  console.log(`Purgados ${count} registros.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
