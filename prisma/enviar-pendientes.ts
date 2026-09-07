// Recordatorio de lo pendiente, desde la línea de comandos.
//
// Misma regla y misma plantilla que el botón "Recordar" del panel de Seguimiento:
// ambos usan src/lib/data/pendientes.ts y src/lib/email.ts, así que nunca pueden
// decir cosas distintas. Este script existe para envíos masivos o cuando no se
// quiere entrar a la plataforma.
//
// Uso:
//   npx tsx prisma/enviar-pendientes.ts --dry-run            (todos los pendientes)
//   npx tsx prisma/enviar-pendientes.ts --dry-run correo@x.cl
//   npx tsx prisma/enviar-pendientes.ts correo@honda.cl [otro@...]
//   npx tsx prisma/enviar-pendientes.ts --todos

import { readFileSync } from "fs";
import { join } from "path";
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
process.env.DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
import { PrismaClient } from "@prisma/client";
import { pendientesDelDiagnostico, queFalta } from "../src/lib/data/pendientes";
import { enviarCorreo, plantillaRecordatorio } from "../src/lib/email";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const todos = args.includes("--todos");
  const correos = args.filter((a) => a.includes("@")).map((a) => a.toLowerCase());

  const diag = await prisma.diagnostico.findFirst({
    where: { empresa: { rut: "96.870.620-9" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, nombre: true },
  });
  if (!diag) throw new Error("Honda no tiene diagnóstico");

  const participantes = await pendientesDelDiagnostico(diag.id);
  const objetivo = participantes.filter(
    (u) => !u.alDia && (todos || correos.length === 0 || correos.includes(u.email.toLowerCase()))
  );

  if (objetivo.length === 0) {
    console.log("No hay a quién recordarle: todos están al día (o los correos indicados no tienen pendientes).");
    return;
  }

  console.log(`${dryRun ? "[DRY-RUN] " : ""}Destinatarios: ${objetivo.length}\n`);
  for (const u of objetivo) {
    console.log(`${u.nombre} <${u.email}> — ${u.totalPreguntas} preguntas`);
    for (const d of u.dominios) console.log(`    ${d.orden}. ${d.nombre}: ${queFalta(d)}`);
    if (dryRun) { console.log("  (dry-run: no se envió)\n"); continue; }

    const { subject, html, text } = plantillaRecordatorio(u);
    try {
      const id = await enviarCorreo(u.email, subject, html, text);
      await prisma.user.update({ where: { id: u.userId }, data: { ultimoRecordatorio: new Date() } });
      console.log(`  ✓ enviado · id=${id}\n`);
    } catch (e) {
      console.log(`  ✗ ERROR: ${(e as Error).message.slice(0, 140)}\n`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
