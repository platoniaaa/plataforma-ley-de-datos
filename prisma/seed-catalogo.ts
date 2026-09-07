// Seed de CATÁLOGO — apto para PRODUCCIÓN. Idempotente, no borra nada.
// Siembra los 10 dominios y 83 preguntas de la Ley 21.719. No crea empresas ni usuarios.
//
// Uso:  npm run db:seed        (vía prisma db seed)
//   o:  npx tsx prisma/seed-catalogo.ts

import { readFileSync } from "fs";
import { join } from "path";

// Carga .env sin depender de dotenv (tsx no lo carga solo; prisma db seed sí, pero
// duplicarlo lo hace robusto ejecutándolo de forma directa).
try {
  for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* sin .env local: se asume que las variables ya están en el entorno (ej. CI/Vercel). */
}

import { PrismaClient } from "@prisma/client";
import { sembrarCatalogo } from "./catalogo";

const prisma = new PrismaClient();

async function main() {
  console.log("Sembrando catálogo LPDP (idempotente)...");
  const { dominios, preguntas } = await sembrarCatalogo(prisma);
  console.log(`✅ Catálogo listo: ${dominios} dominios, ${preguntas} preguntas.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
