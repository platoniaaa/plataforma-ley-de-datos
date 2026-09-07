// Crea (o actualiza) el usuario administrador de Procesos360 para PRODUCCIÓN.
// Reemplaza al antiguo admin demo (admin@procesos360.cl / Demo1234), que ya no se siembra.
// La contraseña NO se escribe en el código: se lee de variables de entorno.
//
// Uso:
//   ADMIN_EMAIL=admin@procesos360.cl ADMIN_PASSWORD='<fuerte>' ADMIN_NOMBRE='Nombre Apellido' \
//     npx tsx prisma/crear-admin.ts
// (en Windows PowerShell: $env:ADMIN_EMAIL="..."; $env:ADMIN_PASSWORD="..."; npx tsx prisma/crear-admin.ts)

import { readFileSync } from "fs";
import { join } from "path";

try {
  for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* sin .env local */
}

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const BCRYPT_COST = 12;

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const nombre = process.env.ADMIN_NOMBRE?.trim() || "Administrador Procesos360";

  if (!email || !password) {
    console.error("✋ Define ADMIN_EMAIL y ADMIN_PASSWORD en el entorno.");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("✋ ADMIN_PASSWORD debe tener al menos 12 caracteres.");
    process.exit(1);
  }

  const passwordHash = bcrypt.hashSync(password, BCRYPT_COST);
  const user = await prisma.user.upsert({
    where: { email },
    create: { nombre, email, passwordHash, role: "ADMIN_P360", empresaId: null, cargo: "Administrador" },
    update: { nombre, passwordHash, role: "ADMIN_P360", activo: true },
  });

  console.log(`✅ Admin P360 listo: ${user.email} (rol ADMIN_P360, bcrypt cost ${BCRYPT_COST}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
