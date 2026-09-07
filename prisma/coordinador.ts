// Otorga (o quita) a la contraparte del cliente los permisos de control interno.
//
// Son dos, y se dan por separado a propósito:
//
//   SEGUIMIENTO  ve el panel de "qué le falta a cada uno" de SU empresa y puede mandar el
//                recordatorio. Es un permiso de lectura: no cambia nada del levantamiento.
//
//   REVISIÓN     valida y observa respuestas, y abre y cierra los dominios de SU empresa,
//                igual que el equipo consultor. Además entra a los diez dominios y no solo
//                a los que responde. Cambia el estado del levantamiento —cerrar un dominio
//                deja a los colegas en solo lectura— y por eso no viene de regalo con el
//                anterior: se pide aparte, con --revision.
//
// En los dos casos quien lo recibe sigue siendo un participante más: responde los dominios
// que tiene asignados como cualquier otro.
//
// Uso:
//   npx tsx prisma/coordinador.ts                                   (lista quién tiene qué)
//   npx tsx prisma/coordinador.ts pablo_torrealba@honda.cl          (seguimiento)
//   npx tsx prisma/coordinador.ts --revision pablo_torrealba@honda.cl
//   npx tsx prisma/coordinador.ts --revision --quitar pablo_torrealba@honda.cl

import { readFileSync } from "fs";
import { join } from "path";
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
process.env.DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function listar() {
  const us = await prisma.user.findMany({
    where: { OR: [{ coordinaSeguimiento: true }, { revisaLevantamiento: true }] },
    select: {
      nombre: true,
      email: true,
      role: true,
      coordinaSeguimiento: true,
      revisaLevantamiento: true,
      empresa: { select: { razonSocial: true } },
    },
    orderBy: { nombre: "asc" },
  });
  if (us.length === 0) {
    console.log("Nadie del lado cliente tiene permisos de control interno todavía.");
    return;
  }
  console.log("Control interno del lado cliente:");
  for (const u of us) {
    const tiene = [
      u.coordinaSeguimiento ? "seguimiento" : null,
      u.revisaLevantamiento ? "revisión" : null,
    ].filter(Boolean);
    console.log(
      `  ${u.nombre} <${u.email}> · ${u.empresa?.razonSocial ?? "sin empresa"} · ${tiene.join(" + ")}`
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const quitar = args.includes("--quitar");
  const revision = args.includes("--revision");
  const correos = args.filter((a) => a.includes("@")).map((a) => a.trim().toLowerCase());

  if (correos.length === 0) return listar();

  for (const email of correos) {
    const u = await prisma.user.findUnique({
      where: { email },
      select: { id: true, nombre: true, empresaId: true, empresa: { select: { razonSocial: true } } },
    });
    if (!u) {
      console.log(`  ✗ ${email}: no existe.`);
      continue;
    }
    // Sin empresa asignada el permiso no acota nada: es del staff, que ya ve todo.
    if (!u.empresaId) {
      console.log(`  ✗ ${u.nombre}: no tiene empresa asignada, este permiso es para la contraparte del cliente.`);
      continue;
    }
    await prisma.user.update({
      where: { id: u.id },
      data: revision ? { revisaLevantamiento: !quitar } : { coordinaSeguimiento: !quitar },
    });
    const que = revision ? "revisa el levantamiento" : "coordina el seguimiento";
    console.log(
      `  ✓ ${u.nombre} (${u.empresa!.razonSocial}) ${quitar ? `ya no ${que}` : que}.`
    );
  }
  console.log();
  await listar();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
