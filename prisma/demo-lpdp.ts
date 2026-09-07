// Utilidad para las demos en vivo de la plataforma (sesiones con Honda).
//
//   npx tsx prisma/demo-lpdp.ts preparar    → deja la cuenta lista para demostrar:
//        resetea el consentimiento y el tutorial para que se vean en vivo, y deja
//        el dominio de demo vacío y en PENDIENTE (editable).
//
//   npx tsx prisma/demo-lpdp.ts limpiar     → borra las respuestas y evidencias que
//        quedaron de la demo y deja el dominio como estaba, listo para su responsable.
//
//   npx tsx prisma/demo-lpdp.ts estado      → solo muestra cómo está todo (no toca nada).
//
// Ajusta CUENTA_DEMO y DOMINIO_DEMO si cambias de conductor o de dominio.

import { readFileSync } from "fs";
import { join } from "path";
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const CUENTA_DEMO = "francisco.guajardo@procesos360.cl";
const DOMINIO_DEMO = 4; // 4 · Derechos de los Titulares (su responsable aún no tiene acceso)

async function ctx() {
  const user = await prisma.user.findUnique({
    where: { email: CUENTA_DEMO },
    select: { id: true, nombre: true, tourVisto: true, consentimientoVersion: true },
  });
  if (!user) throw new Error(`No existe la cuenta ${CUENTA_DEMO}`);

  const diag = await prisma.diagnostico.findFirst({
    where: { empresa: { rut: "96.870.620-9" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, nombre: true },
  });
  if (!diag) throw new Error("Honda no tiene diagnóstico");

  const dd = await prisma.diagnosticoDominio.findFirst({
    where: { diagnosticoId: diag.id, dominio: { orden: DOMINIO_DEMO } },
    select: { id: true, estado: true, dominio: { select: { orden: true, nombre: true } } },
  });
  if (!dd) throw new Error(`No existe el dominio ${DOMINIO_DEMO} en el diagnóstico`);

  return { user, diag, dd };
}

async function estado() {
  const { user, diag, dd } = await ctx();
  const conNota = await prisma.respuesta.count({ where: { diagnosticoDominioId: dd.id, valor: { not: null } } });
  const evid = await prisma.evidencia.count({ where: { diagnosticoDominioId: dd.id } });
  const evidResp = await prisma.evidencia.count({ where: { respuesta: { diagnosticoDominioId: dd.id } } });
  const total = await prisma.respuesta.count({ where: { diagnosticoDominioId: dd.id } });

  console.log(`\nCUENTA   ${user.nombre} <${CUENTA_DEMO}>`);
  console.log(`  consentimiento : ${user.consentimientoVersion ?? "SIN ACEPTAR  → se mostrará en vivo ✔"}`);
  console.log(`  tutorial       : ${user.tourVisto ? "ya visto  → NO se mostrará" : "sin ver  → se mostrará en vivo ✔"}`);
  console.log(`\nDIAGNÓSTICO  ${diag.nombre}`);
  console.log(`DOMINIO      ${dd.dominio.orden}. ${dd.dominio.nombre}`);
  console.log(`  estado         : ${dd.estado}${["EN_VALIDACION","COMPLETADO"].includes(dd.estado) ? "  ← BLOQUEADO, no se puede responder" : "  → editable ✔"}`);
  console.log(`  preguntas      : ${total}  (con nota: ${conNota})`);
  console.log(`  evidencias     : ${evid + evidResp}`);
  console.log("");
}

async function preparar() {
  const { user, dd } = await ctx();

  await prisma.user.update({
    where: { id: user.id },
    data: { consentimientoVersion: null, consentimientoFecha: null, tourVisto: false },
  });
  console.log(`Cuenta ${CUENTA_DEMO}: consentimiento y tutorial reseteados (se verán en vivo).`);

  await limpiarDominio(dd.id);
  await prisma.diagnosticoDominio.update({ where: { id: dd.id }, data: { estado: "PENDIENTE" } });
  console.log(`Dominio ${dd.dominio.orden} (${dd.dominio.nombre}): vacío y en PENDIENTE.`);

  await estado();
  console.log("Listo para demostrar. Recuerda: entra con la sesión cerrada.\n");
}

/** Borra SOLO lo que se genera en la demo y vacía las respuestas.
 *  Importante: no toca las "evidencias esperadas" del levantamiento — son los
 *  placeholders sin archivo que alimentan la lista de evidencias del dominio. */
async function limpiarDominio(ddId: string) {
  // Los aportes van primero: si quedaran vivos, el participante seguiría viendo la
  // respuesta de la demo como suya aunque la oficial esté vacía.
  const a = await prisma.aporteRespuesta.deleteMany({
    where: { respuesta: { diagnosticoDominioId: ddId } },
  });
  const e1 = await prisma.evidencia.deleteMany({
    where: { diagnosticoDominioId: ddId, archivoPath: { not: null } },
  });
  const e2 = await prisma.evidencia.deleteMany({ where: { respuesta: { diagnosticoDominioId: ddId } } });
  const r = await prisma.respuesta.updateMany({
    where: { diagnosticoDominioId: ddId },
    data: {
      valor: null, comentario: null, riesgoIdentificado: null,
      estado: "PENDIENTE", observacionConsultor: null, respondidoPorId: null,
      consolidadaManual: false,
    },
  });
  console.log(
    `  respuestas vaciadas: ${r.count} · aportes borrados: ${a.count} · evidencias borradas: ${e1.count + e2.count}`
  );
}

async function limpiar() {
  const { dd } = await ctx();
  console.log(`Limpiando el dominio ${dd.dominio.orden} (${dd.dominio.nombre})...`);
  await limpiarDominio(dd.id);
  await prisma.diagnosticoDominio.update({ where: { id: dd.id }, data: { estado: "PENDIENTE" } });
  console.log("Dominio devuelto a PENDIENTE, listo para su responsable.");
  await estado();
}

const cmd = process.argv[2];
const acciones: Record<string, () => Promise<void>> = { preparar, limpiar, estado };
const accion = acciones[cmd ?? ""];
if (!accion) {
  console.log("Uso: npx tsx prisma/demo-lpdp.ts [preparar|limpiar|estado]");
  process.exit(1);
}
accion()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
