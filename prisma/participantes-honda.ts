// Participantes por dominio: reemplaza el "responsable único" por el conjunto de roles
// que el Excel "Levantamiento por los 10 dominios de la LPDP - Honda.xlsx" lista en la
// columna "Roles participantes en Honda". Todos los participantes de un dominio son
// responsables por igual de responderlo (no hay responsable principal).
//
// Deja los participantes de Honda exactamente como el Excel. Idempotente: se puede correr
// las veces que sea.
//
// Nota: la migración de los antiguos DiagnosticoDominio.responsableId (un responsable
// único por dominio) a filas de ParticipanteDominio ya se ejecutó junto con el cambio de
// esquema; esa columna ya no existe.
//
// Uso: npx tsx prisma/participantes-honda.ts   (usa DATABASE_URL de .env → producción)

import { readFileSync } from "fs";
import { join } from "path";

// Carga .env sin depender de dotenv (tsx no lo carga solo)
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const RUT_HONDA = "96.870.620-9";

// Columna "Roles participantes en Honda" del Excel, por dominio del CATÁLOGO.
// Mapeo Excel→catálogo: Excel 6 (Incidentes) → catálogo 8; Excel 7 (Terceros) → catálogo 7.
// Excel 8 (Transferencias) se reparte entre catálogo 2 (RAT) y 7 (Terceros).
// Excel 9 (Riesgos y evaluaciones) se suma a catálogo 1 (Gobierno).
// Catálogo 6 y 9 quedaron excluidos del diagnóstico → sin participantes.
const PARTICIPANTES: Record<number, string[]> = {
  // Excel 1: Gobierno y responsabilidad  +  Excel 9: Gestión de riesgos y evaluaciones
  1: [
    "Gerente General",
    "Gerente de RR. HH.",
    "Gerente de TI",
    "Gerente Legal",
    "Cumplimiento",
    "Auditoría Interna",
    "Riesgos",
    "Auditoría",
  ],
  // Excel 2: RAT  +  Excel 8: Transferencias y comunicaciones de datos
  2: [
    "Comercial",
    "Marketing",
    "Postventa",
    "RR. HH.",
    "Finanzas",
    "TI",
    "Atención de Clientes",
    "Legal",
  ],
  // Excel 3: Bases legales y consentimiento
  3: ["Legal", "Marketing", "Comercial", "RR. HH.", "Atención de Clientes"],
  // Excel 4: Derechos de los titulares
  4: ["Atención de Clientes", "Servicio al Cliente", "RR. HH.", "Legal"],
  // Excel 5: Seguridad de la información
  5: ["TI", "Ciberseguridad", "Infraestructura", "Riesgo Operacional"],
  // Excel 7: Encargados y terceros  +  Excel 8: Transferencias (contratos)
  7: ["Compras", "Legal", "TI", "RR. HH.", "Marketing", "Comercial"],
  // Excel 6: Gestión de incidentes y brechas
  8: ["TI", "Ciberseguridad", "Riesgos", "Legal"],
  // Excel 10: Cultura, capacitación y mejora continua
  10: ["RR. HH.", "Cumplimiento", "TI", "Comunicaciones Internas"],
};

async function main() {
  const empresa = await prisma.empresa.findUnique({ where: { rut: RUT_HONDA } });
  if (!empresa) {
    console.error("No existe la empresa Honda. Corre primero prisma/parametrizar-honda.ts.");
    process.exit(1);
  }

  const usuarios = await prisma.user.findMany({
    where: { empresaId: empresa.id },
    select: { id: true, nombre: true, cargo: true },
  });
  // Los usuarios de roles se crearon con nombre = cargo (ver usuarios-honda.ts).
  const idPorCargo = new Map<string, string>();
  for (const u of usuarios) {
    if (u.cargo) idPorCargo.set(u.cargo, u.id);
    idPorCargo.set(u.nombre, u.id);
  }

  const diagnostico = await prisma.diagnostico.findFirst({
    where: { empresaId: empresa.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, nombre: true },
  });
  if (!diagnostico) {
    console.error("Honda no tiene diagnóstico.");
    process.exit(1);
  }

  const dds = await prisma.diagnosticoDominio.findMany({
    where: { diagnosticoId: diagnostico.id },
    include: { dominio: { select: { orden: true, nombre: true } } },
    orderBy: { dominio: { orden: "asc" } },
  });

  console.log(`\nParticipantes por dominio en "${diagnostico.nombre}":`);
  const faltantes = new Set<string>();

  for (const dd of dds) {
    const cargos = PARTICIPANTES[dd.dominio.orden];
    if (!cargos) {
      // Dominio excluido: sin participantes.
      await prisma.participanteDominio.deleteMany({ where: { diagnosticoDominioId: dd.id } });
      console.log(`  ${dd.dominio.orden}. ${dd.dominio.nombre} — excluido, sin participantes`);
      continue;
    }

    const userIds: string[] = [];
    for (const cargo of cargos) {
      const id = idPorCargo.get(cargo);
      if (!id) {
        faltantes.add(cargo);
        continue;
      }
      if (!userIds.includes(id)) userIds.push(id);
    }

    // Deja el conjunto exactamente igual al Excel.
    await prisma.participanteDominio.deleteMany({
      where: { diagnosticoDominioId: dd.id, userId: { notIn: userIds } },
    });
    await prisma.participanteDominio.createMany({
      data: userIds.map((userId) => ({ diagnosticoDominioId: dd.id, userId })),
      skipDuplicates: true,
    });

    console.log(`  ${dd.dominio.orden}. ${dd.dominio.nombre} — ${userIds.length}: ${cargos.join(", ")}`);
  }

  if (faltantes.size > 0) {
    console.warn(`\nOJO: sin usuario para estos cargos: ${[...faltantes].join(", ")}`);
  }
  console.log("\nListo.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
