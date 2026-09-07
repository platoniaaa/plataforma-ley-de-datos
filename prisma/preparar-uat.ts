// Deja el ambiente de pruebas (UAT) listo para usar.
//
// Lee .env.uat, NO .env: así no hay forma de correrlo contra producción por descuido. Y
// aunque alguien apuntara mal las variables, se detiene al reconocer el proyecto real de
// Supabase antes de tocar nada.
//
// Qué hace, todo idempotente:
//   · Comprueba que el catálogo esté sembrado (npx tsx prisma/seed-catalogo.ts).
//   · Deja la empresa de pruebas visible como un cliente normal: en UAT todo es ficticio,
//     así que marcarla como "demo" solo lograba esconderla del administrador.
//   · Crea las cuentas del equipo con una contraseña conocida.
//
// Uso: npx tsx prisma/preparar-uat.ts

import { readFileSync } from "fs";
import { join } from "path";

const RUTA = join(__dirname, "..", ".env.uat");
let env = "";
try {
  env = readFileSync(RUTA, "utf-8");
} catch {
  console.error("Falta .env.uat. Este script solo opera contra el ambiente de pruebas.");
  process.exit(1);
}
for (const line of env.split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m) process.env[m[1]] = m[2]; // .env.uat manda: aquí no se hereda del entorno
}
process.env.DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;

// Cinturón de seguridad: el proyecto de producción jamás debe aparecer por aquí.
const REF_PRODUCCION = "prkfdcnzodbvzxjzbkcs";
if ((process.env.DATABASE_URL ?? "").includes(REF_PRODUCCION)) {
  console.error("ABORTADO: .env.uat apunta al proyecto de PRODUCCIÓN. Revisa las variables.");
  process.exit(1);
}

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PASS = process.env.UAT_PASSWORD || "UatLpdp2026!";
// `pass` propia donde interesa una contraseña fácil de dictar en una sesión de pruebas.
const EQUIPO: { email: string; nombre: string; pass?: string }[] = [
  { email: "francisco.guajardo@procesos360.cl", nombre: "Francisco Guajardo" },
  { email: "consultor@procesos360.cl", nombre: "Consultor de Pruebas" },
  { email: "admin@procesos360.cl", nombre: "Administrador Procesos360", pass: "Demo1234" },
];

async function main() {
  const dominios = await prisma.dominio.count();
  if (dominios === 0) {
    console.error("El catálogo está vacío. Corre antes: npx tsx prisma/seed-catalogo.ts");
    process.exit(1);
  }
  console.log(`Catálogo: ${dominios} dominios.`);

  // En UAT todo es ficticio: la empresa de pruebas se comporta como un cliente normal.
  const empresas = await prisma.empresa.updateMany({
    where: { esDemo: true },
    data: { esDemo: false },
  });
  if (empresas.count > 0) {
    console.log(`${empresas.count} empresa(s) dejaron de estar marcadas como demo.`);
  }

  // El staff de pruebas no queda acotado a ninguna empresa: tiene que ver todo, como en
  // producción, o el ambiente no sirve para probar lo que se va a desplegar.
  for (const u of EQUIPO) {
    const hash = bcrypt.hashSync(u.pass ?? PASS, 10);
    await prisma.user.upsert({
      where: { email: u.email },
      update: { role: "ADMIN_P360", empresaId: null, activo: true, passwordHash: hash },
      create: {
        email: u.email,
        nombre: u.nombre,
        role: "ADMIN_P360",
        passwordHash: hash,
        activo: true,
        consentimientoVersion: "1.0",
        consentimientoFecha: new Date(),
        tourVisto: true,
      },
    });
    console.log(`  ✓ ${u.email} (ADMIN_P360, ve todo) · ${u.pass ?? PASS}`);
  }

  const [emp, users, diags] = await Promise.all([
    prisma.empresa.count(),
    prisma.user.count(),
    prisma.diagnostico.count(),
  ]);
  console.log(`\nAmbiente listo: ${emp} empresa(s), ${users} usuarios, ${diags} diagnóstico(s).`);
  console.log(`Contraseña por defecto del equipo de pruebas: ${PASS}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
