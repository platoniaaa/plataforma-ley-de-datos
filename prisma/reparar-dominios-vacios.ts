// Crea las preguntas que le falten a un dominio incluido en el diagnóstico.
//
// Incluir un dominio después de crear el diagnóstico no generaba sus preguntas: quedaba
// dentro del alcance con el cuestionario vacío y sus participantes sin nada que
// responder. La causa ya está corregida en la pantalla de Configurar; esto repara los
// diagnósticos que alcanzaron a quedar así.
//
// Solo crea lo que falta. Nunca borra ni modifica una respuesta existente.
//
// Uso:
//   npx tsx prisma/reparar-dominios-vacios.ts             (muestra qué falta)
//   npx tsx prisma/reparar-dominios-vacios.ts --aplicar   (lo crea)

import { readFileSync } from "fs";
import { join } from "path";
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
process.env.DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const aplicar = process.argv.includes("--aplicar");

  const dds = await prisma.diagnosticoDominio.findMany({
    where: { incluido: true },
    orderBy: [{ diagnosticoId: "asc" }, { dominio: { orden: "asc" } }],
    select: {
      id: true,
      dominioId: true,
      diagnostico: { select: { nombre: true, empresa: { select: { razonSocial: true } } } },
      dominio: { select: { orden: true, nombre: true } },
      respuestas: { select: { preguntaId: true } },
      _count: { select: { participantes: true } },
    },
  });

  let total = 0;
  for (const dd of dds) {
    const yaEstan = dd.respuestas.map((r) => r.preguntaId);
    const faltan = await prisma.pregunta.findMany({
      where: { dominioId: dd.dominioId, id: { notIn: yaEstan } },
      select: { id: true },
    });
    if (faltan.length === 0) continue;

    total += faltan.length;
    console.log(
      `${dd.diagnostico.empresa.razonSocial} · D${dd.dominio.orden} ${dd.dominio.nombre}: ` +
        `faltan ${faltan.length} preguntas (${dd._count.participantes} participantes esperando)`
    );
    if (!aplicar) continue;

    await prisma.respuesta.createMany({
      data: faltan.map((p) => ({
        diagnosticoDominioId: dd.id,
        preguntaId: p.id,
        estado: "PENDIENTE",
      })),
      skipDuplicates: true,
    });
    console.log(`   ✓ creadas`);
  }

  if (total === 0) console.log("Ningún dominio incluido tiene preguntas faltantes.");
  else if (!aplicar) console.log(`\n${total} preguntas por crear. Corre con --aplicar para hacerlo.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
