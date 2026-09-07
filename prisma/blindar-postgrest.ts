// Cierra el acceso directo a las tablas por la API de datos de Supabase (PostgREST).
//
// Supabase publica automáticamente cada tabla del esquema `public` como API REST, y las
// tablas que crea Prisma nacen SIN row level security. Resultado: con la clave anónima
// —que en el modelo de Supabase es pública por diseño— se podían leer todas las tablas,
// incluidos los hashes de contraseña, y borrar filas.
//
// La aplicación no usa esa API en absoluto: habla con la base por Prisma, conectada como
// `postgres`, que tiene rolbypassrls. Por eso activar RLS no le afecta en nada — y por eso
// mismo la protección faltaba sin que nadie lo notara: nada dejaba de funcionar.
//
// Se hacen las dos cosas, cinturón y tirantes:
//   1. RLS activo en todas las tablas, sin políticas. Sin política que lo permita, nadie
//      que no evada RLS lee ni escribe.
//   2. Se revocan los privilegios de `anon` y `authenticated`, y se cambian los permisos
//      por defecto para que una tabla futura no vuelva a nacer abierta.
//
// Uso:
//   npx tsx prisma/blindar-postgrest.ts              (revisa y muestra el estado)
//   npx tsx prisma/blindar-postgrest.ts --aplicar    (aplica en la base de .env)
//   npx tsx prisma/blindar-postgrest.ts --uat --aplicar

import { readFileSync } from "fs";
import { join } from "path";

const usarUat = process.argv.includes("--uat");
const archivo = usarUat ? ".env.uat" : ".env";
for (const line of readFileSync(join(__dirname, "..", archivo), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m) process.env[m[1]] = m[2];
}
process.env.DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function estado() {
  const filas = await prisma.$queryRawUnsafe<{ tabla: string; rls: boolean }[]>(`
    select t.tablename as tabla, c.relrowsecurity as rls
    from pg_tables t join pg_class c on c.relname = t.tablename
    where t.schemaname = 'public'
    order by t.tablename
  `);
  const sin = filas.filter((f) => !f.rls);
  console.log(`\nTablas: ${filas.length} · con RLS: ${filas.length - sin.length} · SIN RLS: ${sin.length}`);
  if (sin.length > 0) console.log(`  Desprotegidas: ${sin.map((f) => f.tabla).join(", ")}`);

  const permisos = await prisma.$queryRawUnsafe<{ grantee: string; n: number }[]>(`
    select grantee, count(*)::int as n
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon','authenticated')
    group by grantee order by grantee
  `);
  if (permisos.length === 0) console.log("  Privilegios de anon/authenticated: ninguno");
  else for (const p of permisos) console.log(`  Privilegios de ${p.grantee}: ${p.n}`);
}

async function aplicar() {
  const tablas = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `select tablename from pg_tables where schemaname = 'public'`
  );

  for (const t of tablas) {
    // Sin políticas a propósito: nadie que no evada RLS debe pasar. La app no pasa por
    // aquí, y si algún día se quisiera exponer algo, se agrega la política explícita.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "public"."${t.tablename}" ENABLE ROW LEVEL SECURITY`
    );
  }
  console.log(`RLS activado en ${tablas.length} tablas.`);

  for (const rol of ["anon", "authenticated"]) {
    await prisma.$executeRawUnsafe(
      `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "public" FROM "${rol}"`
    );
    await prisma.$executeRawUnsafe(
      `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "public" FROM "${rol}"`
    );
    // Para que una tabla creada mañana por `prisma db push` no vuelva a nacer abierta.
    await prisma.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE ALL ON TABLES FROM "${rol}"`
    );
  }
  console.log("Privilegios de anon y authenticated revocados, incluidos los futuros.");
}

async function main() {
  console.log(`Base: ${usarUat ? "UAT (.env.uat)" : "PRODUCCIÓN (.env)"}`);
  await estado();

  if (!process.argv.includes("--aplicar")) {
    console.log("\n(solo revisión — agrega --aplicar para blindar)");
    return;
  }
  console.log("\nAplicando…");
  await aplicar();
  await estado();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
