// Migración a respuestas por participante (AporteRespuesta).
//
// Antes: una sola Respuesta por pregunta, compartida por todos los participantes del
// dominio, que se pisaban entre sí. Ahora cada persona escribe su AporteRespuesta y la
// Respuesta pasa a ser la oficial consolidada.
//
// Esta migración conserva TODO lo ya respondido, sin cambiar ningún valor oficial:
//   · Respuesta respondida con autor conocido → se crea su aporte equivalente. Al
//     consolidar un único aporte, la oficial da exactamente el mismo valor de antes.
//   · Respuesta respondida sin autor (no se sabe quién fue) → no se puede reconstruir el
//     aporte, así que se marca consolidadaManual para que la consolidación no la toque.
//
// Idempotente: se puede correr las veces que sea.
//
// Uso: npx tsx prisma/migrar-aportes.ts [--dry-run]

import { readFileSync } from "fs";
import { join } from "path";
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const respuestas = await prisma.respuesta.findMany({
    where: { valor: { not: null } },
    select: {
      id: true,
      valor: true,
      comentario: true,
      riesgoIdentificado: true,
      respondidoPorId: true,
      consolidadaManual: true,
      aportes: { select: { userId: true } },
      pregunta: { select: { orden: true } },
      diagnosticoDominio: { select: { dominio: { select: { orden: true, nombre: true } } } },
    },
  });

  console.log(`${dryRun ? "[DRY-RUN] " : ""}Respuestas con valor: ${respuestas.length}\n`);

  let aportesCreados = 0, yaTenian = 0, congeladas = 0;

  for (const r of respuestas) {
    const etiqueta = `D${r.diagnosticoDominio.dominio.orden} P${r.pregunta.orden}`;

    if (r.aportes.length > 0) { yaTenian++; continue; }

    if (r.respondidoPorId) {
      // Se conoce el autor: su aporte reproduce exactamente la respuesta actual.
      if (!dryRun) {
        await prisma.aporteRespuesta.create({
          data: {
            respuestaId: r.id,
            userId: r.respondidoPorId,
            valor: r.valor,
            comentario: r.comentario,
            riesgoIdentificado: r.riesgoIdentificado,
          },
        });
      }
      aportesCreados++;
    } else if (!r.consolidadaManual) {
      // Sin autor conocido: se congela para que la consolidación no la borre.
      if (!dryRun) {
        await prisma.respuesta.update({
          where: { id: r.id },
          data: { consolidadaManual: true },
        });
      }
      congeladas++;
      console.log(`  ${etiqueta}: sin autor → oficial congelada (valor ${r.valor})`);
    }
  }

  console.log(`\nAportes creados:        ${aportesCreados}`);
  console.log(`Ya tenían aporte:       ${yaTenian}`);
  console.log(`Oficiales congeladas:   ${congeladas}`);
  if (dryRun) console.log("\n(dry-run: no se escribió nada)");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
