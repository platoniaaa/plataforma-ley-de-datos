// Rol del equipo de Procesos360.
//
// ADMIN_P360 y CONSULTOR ven exactamente lo mismo de los clientes: diagnósticos,
// seguimiento, motores y reportes. Lo único que separa a un administrador es lo que
// es transversal a la plataforma —el catálogo LPDP y el alta de empresas—, y por eso
// tener a todo el equipo como administrador es lo que permite que cualquiera cubra
// una ausencia sin quedarse a medias.
//
// Las cuentas acotadas a una empresa (la de demostración) quedan fuera a propósito:
// el catálogo de dominios y preguntas es uno solo para todos los clientes, y una
// cuenta de demostración no tiene por qué poder editarlo.
//
// Uso:
//   npx tsx prisma/rol-staff.ts                                (muestra el estado)
//   npx tsx prisma/rol-staff.ts --todos-admin                  (promueve al equipo)
//   npx tsx prisma/rol-staff.ts --consultor correo@p360.cl     (baja a uno)

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
  const us = await prisma.user.findMany({
    where: { role: { in: ["ADMIN_P360", "CONSULTOR"] } },
    select: {
      nombre: true, email: true, role: true, activo: true,
      empresa: { select: { razonSocial: true, esDemo: true } },
    },
    orderBy: [{ role: "asc" }, { email: "asc" }],
  });
  console.log("\nEquipo Procesos360:");
  for (const u of us) {
    const acotada = u.empresa ? ` · acotada a ${u.empresa.razonSocial}${u.empresa.esDemo ? " (demo)" : ""}` : "";
    const alcance = u.empresa
      ? "solo esa empresa"
      : u.role === "ADMIN_P360"
        ? "todo, incluidos catálogo y empresas"
        : "todos los clientes, sin catálogo ni empresas";
    console.log(`  ${u.email.padEnd(34)} ${u.role.padEnd(11)} ${alcance}${acotada}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const todosAdmin = args.includes("--todos-admin");
  const bajarIdx = args.indexOf("--consultor");
  const bajar = bajarIdx >= 0 ? args.slice(bajarIdx + 1).filter((a) => a.includes("@")) : [];

  if (bajar.length > 0) {
    for (const email of bajar.map((e) => e.trim().toLowerCase())) {
      const u = await prisma.user.findUnique({ where: { email }, select: { id: true, nombre: true, role: true } });
      if (!u || !["ADMIN_P360", "CONSULTOR"].includes(u.role)) {
        console.log(`  ✗ ${email}: no es una cuenta del equipo Procesos360.`);
        continue;
      }
      await prisma.user.update({ where: { id: u.id }, data: { role: "CONSULTOR" } });
      console.log(`  ✓ ${u.nombre} vuelve a CONSULTOR.`);
    }
    return estado();
  }

  if (!todosAdmin) return estado();

  // Solo el equipo real: quien está acotado a una empresa se queda como está.
  const candidatos = await prisma.user.findMany({
    where: { role: "CONSULTOR", empresaId: null },
    select: { id: true, nombre: true, email: true },
    orderBy: { nombre: "asc" },
  });
  if (candidatos.length === 0) {
    console.log("Todo el equipo ya es administrador.");
    return estado();
  }
  for (const u of candidatos) {
    await prisma.user.update({ where: { id: u.id }, data: { role: "ADMIN_P360" } });
    console.log(`  ✓ ${u.nombre} <${u.email}> ahora es ADMIN_P360.`);
  }

  const acotadas = await prisma.user.findMany({
    where: { role: "CONSULTOR", empresaId: { not: null } },
    select: { email: true, empresa: { select: { razonSocial: true } } },
  });
  for (const u of acotadas) {
    console.log(`  · ${u.email} se mantiene como consultor: está acotada a ${u.empresa!.razonSocial}.`);
  }
  return estado();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
