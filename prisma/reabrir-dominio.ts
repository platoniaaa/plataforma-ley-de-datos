// Reabre un dominio que se envió a validación antes de tiempo.
//
// Enviar un dominio lo deja en solo lectura para TODOS sus participantes, no solo para
// quien lo envió. Cuando alguien aprieta el botón mientras un colega va por la mitad, el
// colega se queda afuera sin haber hecho nada.
//
// Devuelve el dominio a EN_EJECUCION. No toca ninguna respuesta.
//
// Uso:
//   npx tsx prisma/reabrir-dominio.ts                  (muestra el estado de los dominios)
//   npx tsx prisma/reabrir-dominio.ts 2                (reabre el dominio 2)

import { readFileSync } from "fs";
import { join } from "path";
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
process.env.DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function estado(diagnosticoId: string) {
  const dds = await prisma.diagnosticoDominio.findMany({
    where: { diagnosticoId, incluido: true },
    orderBy: { dominio: { orden: "asc" } },
    select: {
      estado: true,
      dominio: { select: { orden: true, nombre: true } },
      participantes: { select: { userId: true, user: { select: { nombre: true } } } },
      respuestas: { select: { aportes: { select: { userId: true, valor: true } } } },
    },
  });
  console.log("\nDominios del diagnóstico:");
  for (const dd of dds) {
    const total = dd.respuestas.length;
    const atrasados = dd.participantes
      .map((p) => ({
        nombre: p.user.nombre,
        faltan: dd.respuestas.filter(
          (r) => !r.aportes.some((a) => a.userId === p.userId && a.valor != null)
        ).length,
      }))
      .filter((x) => x.faltan > 0);
    const cerrado = ["EN_VALIDACION", "COMPLETADO"].includes(dd.estado);
    console.log(
      `  D${String(dd.dominio.orden).padStart(2)} ${dd.dominio.nombre.slice(0, 34).padEnd(36)} ` +
        `${dd.estado.padEnd(13)} ${cerrado ? "🔒" : "  "} ${total} preguntas`
    );
    for (const a of atrasados) {
      console.log(`        ${cerrado ? "⚠ " : "· "}${a.nombre}: le faltan ${a.faltan}`);
    }
  }
}

async function main() {
  const orden = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));

  const diag = await prisma.diagnostico.findFirst({
    where: { empresa: { esDemo: false } },
    select: { id: true, nombre: true },
    orderBy: { createdAt: "desc" },
  });
  if (!diag) {
    console.log("No hay diagnósticos reales.");
    return;
  }
  console.log(`Diagnóstico: ${diag.nombre}`);

  if (orden.length === 0) return estado(diag.id);

  for (const o of orden) {
    const dd = await prisma.diagnosticoDominio.findFirst({
      where: { diagnosticoId: diag.id, dominio: { orden: o } },
      select: { id: true, estado: true, dominio: { select: { orden: true, nombre: true } } },
    });
    if (!dd) {
      console.log(`  ✗ No existe el dominio ${o} en este diagnóstico.`);
      continue;
    }
    if (!["EN_VALIDACION", "COMPLETADO"].includes(dd.estado)) {
      console.log(`  · D${o} ya está abierto (${dd.estado}). Sin cambios.`);
      continue;
    }
    await prisma.diagnosticoDominio.update({
      where: { id: dd.id },
      data: { estado: "EN_EJECUCION" },
    });
    console.log(`  ✓ D${o} ${dd.dominio.nombre}: ${dd.estado} → EN_EJECUCION (reabierto)`);
  }

  await estado(diag.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
