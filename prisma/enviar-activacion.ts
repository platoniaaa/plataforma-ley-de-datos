// Invita a un participante a activar su cuenta.
//
// Reemplaza al correo de credenciales: en vez de mandar la contraseña escrita, manda
// un enlace de un solo uso para que la persona defina la suya. Los filtros de
// seguridad corporativos leen "aquí va tu usuario y contraseña" como phishing —de
// hecho Honda bloqueó al remitente por eso—, y este formato además es más seguro:
// la contraseña nunca viaja ni queda archivada en una bandeja de entrada.
//
// Uso:
//   npx tsx prisma/enviar-activacion.ts --dry-run --all-honda
//   npx tsx prisma/enviar-activacion.ts --test tucorreo@x.cl correo@honda.cl
//   npx tsx prisma/enviar-activacion.ts correo@honda.cl [otro@honda.cl ...]
//   npx tsx prisma/enviar-activacion.ts --all-honda
//
// --solo-enlaces  no envía nada: imprime los enlaces para repartirlos por otro medio
//                 (útil mientras el remitente siga bloqueado).

import { readFileSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
process.env.DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
import { PrismaClient } from "@prisma/client";
import { plantillaActivacion, DIAS_VIGENCIA_ENLACE , enviarCorreo } from "../src/lib/email";

const prisma = new PrismaClient();
const APP_URL = "https://lpdp.procesos360.cl";

/** Genera y guarda un token de un solo uso. Reemplaza cualquier anterior. */
async function nuevoEnlace(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expira = new Date(Date.now() + DIAS_VIGENCIA_ENLACE * 24 * 60 * 60 * 1000);
  await prisma.user.update({
    where: { id: userId },
    data: { tokenActivacion: token, tokenExpira: expira },
  });
  return `${APP_URL}/activar?token=${token}`;
}

// La plantilla vive en src/lib/email.ts: la comparten esta linea de comandos y la
// seccion de accesos de la plataforma, y tienen que decir exactamente lo mismo.


async function dominiosDe(userId: string): Promise<string[]> {
  const p = await prisma.participanteDominio.findMany({
    where: { userId },
    select: { diagnosticoDominio: { select: { dominio: { select: { orden: true, nombre: true } } } } },
  });
  return p
    .map((x) => x.diagnosticoDominio.dominio)
    .sort((a, b) => a.orden - b.orden)
    .map((d) => `${d.orden}. ${d.nombre}`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const soloEnlaces = args.includes("--solo-enlaces");
  const allHonda = args.includes("--all-honda");
  const testIdx = args.indexOf("--test");
  const testTo = testIdx >= 0 ? args[testIdx + 1] : null;

  let objetivos: string[];
  if (allHonda) {
    const honda = await prisma.user.findMany({
      where: { role: "RESPONSABLE_DOMINIO", empresa: { rut: "96.870.620-9" } },
      select: { email: true }, orderBy: { email: "asc" },
    });
    objetivos = honda.map((u) => u.email);
  } else {
    objetivos = args.filter((a) => a.includes("@") && a !== testTo);
  }
  if (objetivos.length === 0) {
    console.log("Indica correos, o usa --all-honda. Añade --dry-run para previsualizar.");
    return;
  }

  for (const email of objetivos) {
    const u = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, nombre: true, email: true },
    });
    if (!u) { console.log(`  ${email}: no existe`); continue; }

    if (dryRun) {
      console.log(`  → ${u.nombre} <${u.email}>  (no se generó token)`);
      continue;
    }

    const enlace = await nuevoEnlace(u.id);
    if (soloEnlaces) {
      console.log(`\n${u.nombre} <${u.email}>\n${enlace}`);
      continue;
    }

    const { subject, html, text } = plantillaActivacion(u.nombre, enlace, await dominiosDe(u.id));
    const to = testTo ?? u.email;
    try {
      const id = await enviarCorreo(to, testTo ? `[PRUEBA] ${subject}` : subject, html, text);
      console.log(`  ✓ ${to} (${u.nombre})  id=${id}`);
    } catch (e) {
      console.log(`  ✗ ${to}  ERROR: ${(e as Error).message.slice(0, 120)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
