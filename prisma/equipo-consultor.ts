// Equipo consultor asignado a un diagnóstico: quiénes responden por él ante el cliente.
//
// No otorga permisos —el staff de Procesos360 ya ve todas las empresas—: deja constancia
// de quién interviene, que es lo que el expediente tiene que poder acreditar y lo que el
// cliente necesita para saber a quién dirigirse si el que está a cargo no está.
//
// Uso:
//   npx tsx prisma/equipo-consultor.ts                      (muestra el estado)
//   npx tsx prisma/equipo-consultor.ts --todos              (asigna a todo el equipo)
//   npx tsx prisma/equipo-consultor.ts --lider correo@p360.cl
//
// Con --todos y sin --lider, conserva el líder que ya estuviera designado.

import { readFileSync } from "fs";
import { join } from "path";
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
process.env.DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function estado() {
  const diags = await prisma.diagnostico.findMany({
    select: {
      nombre: true,
      empresa: { select: { razonSocial: true, esDemo: true } },
      consultor: { select: { nombre: true } },
      equipo: { select: { user: { select: { nombre: true } } }, orderBy: { user: { nombre: "asc" } } },
    },
    orderBy: { createdAt: "desc" },
  });
  console.log("\nEquipo por diagnóstico:");
  for (const d of diags) {
    console.log(`\n  ${d.empresa.razonSocial}${d.empresa.esDemo ? " [DEMO]" : ""} · ${d.nombre}`);
    console.log(`    A cargo: ${d.consultor?.nombre ?? "SIN ASIGNAR"}`);
    const apoyo = d.equipo.map((e) => e.user.nombre).filter((n) => n !== d.consultor?.nombre);
    console.log(`    Equipo : ${apoyo.length ? apoyo.join(", ") : "(nadie más)"}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const todos = args.includes("--todos");
  const liderIdx = args.indexOf("--lider");
  const liderEmail = liderIdx >= 0 ? args[liderIdx + 1]?.trim().toLowerCase() : null;

  if (!todos && !liderEmail) return estado();

  const diag = await prisma.diagnostico.findFirst({
    where: { empresa: { esDemo: false } },
    select: { id: true, nombre: true, consultorId: true, empresa: { select: { razonSocial: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!diag) {
    console.log("No hay diagnósticos reales.");
    return;
  }
  console.log(`Diagnóstico: ${diag.empresa.razonSocial} · ${diag.nombre}`);

  // Solo staff sin empresa asignada: la cuenta acotada al entorno de demostración no
  // puede figurar como responsable del trabajo de un cliente real.
  const equipo = await prisma.user.findMany({
    where: { role: { in: ["ADMIN_P360", "CONSULTOR"] }, empresaId: null, activo: true },
    select: { id: true, nombre: true, email: true },
    orderBy: { nombre: "asc" },
  });

  let liderId = diag.consultorId;
  if (liderEmail) {
    const l = equipo.find((u) => u.email.toLowerCase() === liderEmail);
    if (!l) {
      console.log(`  ✗ ${liderEmail} no es del equipo Procesos360 (o está acotado a una empresa).`);
      return;
    }
    liderId = l.id;
  }

  if (todos) {
    for (const u of equipo) {
      await prisma.consultorDiagnostico.upsert({
        where: { diagnosticoId_userId: { diagnosticoId: diag.id, userId: u.id } },
        create: { diagnosticoId: diag.id, userId: u.id },
        update: {},
      });
    }
    console.log(`  ✓ ${equipo.length} consultores asignados al diagnóstico.`);
  }

  if (liderId) {
    // Quien está a cargo tiene que formar parte del equipo: no se responde por un
    // trabajo del que no se forma parte.
    await prisma.consultorDiagnostico.upsert({
      where: { diagnosticoId_userId: { diagnosticoId: diag.id, userId: liderId } },
      create: { diagnosticoId: diag.id, userId: liderId },
      update: {},
    });
    await prisma.diagnostico.update({
      where: { id: diag.id },
      data: { consultorId: liderId },
    });
    const l = equipo.find((u) => u.id === liderId);
    console.log(`  ✓ A cargo: ${l?.nombre ?? liderId}`);
  }

  await estado();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
