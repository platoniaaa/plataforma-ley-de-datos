// Instala los disparadores que alimentan HistorialCambio.
//
// Van en la base y no en la aplicación a propósito: así queda registrado TODO cambio,
// incluido el que hagan los scripts de mantención, y ninguna ruta puede saltárselo.
//
// La autoría no necesita pasarse desde la app: cada fila ya la lleva dentro
// (Respuesta.respondidoPorId, AporteRespuesta.userId, Evidencia.subidoPorId), y el
// disparador guarda la fila completa.
//
// Idempotente: se puede correr las veces que sea.
//
// Uso: npx tsx prisma/instalar-historial.ts

import { readFileSync } from "fs";
import { join } from "path";
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
// Conexión directa: DDL no debe pasar por el pooler.
process.env.DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// DiagnosticoDominio se suma porque enviar un dominio a validación lo cierra para
// TODOS sus participantes, y cuando eso ocurre antes de tiempo la primera pregunta es
// quién lo hizo y cuándo. Sin registro, esa pregunta no tenía respuesta.
const TABLAS = ["Respuesta", "AporteRespuesta", "Evidencia", "DiagnosticoDominio"];

const FUNCION = `
CREATE OR REPLACE FUNCTION registrar_cambio() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE
  v_ant jsonb;
  v_nue jsonb;
BEGIN
  IF (TG_OP = 'UPDATE') THEN
    -- Un guardado que solo mueve la marca de tiempo no es un cambio: no se registra.
    v_ant := to_jsonb(OLD) - 'updatedAt';
    v_nue := to_jsonb(NEW) - 'updatedAt';
    IF v_ant IS NOT DISTINCT FROM v_nue THEN
      RETURN NEW;
    END IF;
    INSERT INTO "HistorialCambio" ("tabla","registroId","operacion","anterior","nuevo","fecha")
    VALUES (TG_TABLE_NAME, OLD.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), now());
    RETURN NEW;

  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO "HistorialCambio" ("tabla","registroId","operacion","anterior","nuevo","fecha")
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD), NULL, now());
    RETURN OLD;

  ELSE
    INSERT INTO "HistorialCambio" ("tabla","registroId","operacion","anterior","nuevo","fecha")
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', NULL, to_jsonb(NEW), now());
    RETURN NEW;
  END IF;
END;
$fn$;
`;

async function main() {
  await prisma.$executeRawUnsafe(FUNCION);
  console.log("Función registrar_cambio() creada.");

  for (const tabla of TABLAS) {
    const trg = `hist_${tabla.toLowerCase()}`;
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trg}" ON "${tabla}"`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${trg}"
      AFTER INSERT OR UPDATE OR DELETE ON "${tabla}"
      FOR EACH ROW EXECUTE FUNCTION registrar_cambio()
    `);
    console.log(`  disparador instalado en ${tabla}`);
  }

  const activos: { tgname: string }[] = await prisma.$queryRawUnsafe(
    `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'hist_%' ORDER BY tgname`
  );
  console.log(`\nDisparadores activos: ${activos.map((t) => t.tgname).join(", ")}`);
  console.log("Desde ahora todo cambio en esas tablas queda registrado en HistorialCambio.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
