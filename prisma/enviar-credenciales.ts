// Envia por correo (Resend) las credenciales de acceso a la plataforma LPDP.
// Lee las contrasenas de docs/credenciales-iniciales.csv y los dominios asignados
// desde la base. NO envia a nadie por defecto: hay que indicar destinatarios.
//
// Uso:
//   npx tsx prisma/enviar-credenciales.ts --dry-run --all-honda        (previsualiza los 9)
//   npx tsx prisma/enviar-credenciales.ts --test tucorreo@dominio.cl   (prueba a un correo)
//   npx tsx prisma/enviar-credenciales.ts correo1@honda.cl correo2@...  (envia a esos)
//   npx tsx prisma/enviar-credenciales.ts --all-honda                   (envia a los 9)
//
// Flags: --dry-run (no envia, solo muestra) · --all-honda (todos los RESPONSABLE_DOMINIO
// de Honda que esten en el CSV) · --test <correo> (envia a ti la version de un usuario demo).

import { readFileSync } from "fs";
import { join } from "path";
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
import { PrismaClient } from "@prisma/client";
import { plantillaCredenciales , enviarCorreo } from "../src/lib/email";

const prisma = new PrismaClient();

type Cred = { nombre: string; email: string; cargo: string; password: string };

// ── Parse simple del CSV (campos entre comillas) ────────────────────────────
function leerCSV(): Map<string, Cred> {
  const txt = readFileSync(join(__dirname, "..", "docs", "credenciales-iniciales.csv"), "utf-8");
  const map = new Map<string, Cred>();
  const lines = txt.split(/\r?\n/).slice(1); // salta encabezado
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.match(/"([^"]*)"/g)?.map((s) => s.slice(1, -1)) ?? [];
    if (cols.length < 6) continue;
    const [nombre, email, cargo, , , password] = cols;
    map.set(email.toLowerCase(), { nombre, email, cargo, password });
  }
  return map;
}

// La plantilla vive en src/lib/email.ts: la comparten esta linea de comandos y la
// seccion de accesos de la plataforma. Aqui la contrasena sale del CSV del alta
// inicial; alla se genera una nueva, porque la original no se puede recuperar.


async function dominiosDe(email: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      participaciones: {
        select: { diagnosticoDominio: { select: { dominio: { select: { orden: true, nombre: true } } } } },
      },
    },
  });
  if (!user) return [];
  return user.participaciones
    .map((p) => p.diagnosticoDominio.dominio)
    .sort((a, b) => a.orden - b.orden)
    .map((d) => `${d.orden}. ${d.nombre}`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const allHonda = args.includes("--all-honda");
  const testIdx = args.indexOf("--test");
  const testTo = testIdx >= 0 ? args[testIdx + 1] : null;

  const cred = leerCSV();

  // Determina destinatarios (emails de usuarios).
  let objetivos: string[] = [];
  if (allHonda) {
    const honda = await prisma.user.findMany({
      where: { role: "RESPONSABLE_DOMINIO", empresa: { rut: "96.870.620-9" } },
      select: { email: true },
      orderBy: { email: "asc" },
    });
    objetivos = honda.map((u) => u.email);
  } else {
    objetivos = args.filter((a) => a.includes("@") && a !== testTo);
  }

  if (testTo) {
    // Prueba: usa los datos del primer objetivo (o de jeannette) pero envia a testTo.
    const modeloEmail = objetivos[0] ?? "jeannette_gaete@honda.cl";
    const c = cred.get(modeloEmail.toLowerCase());
    if (!c) throw new Error(`No hay credencial en el CSV para ${modeloEmail}`);
    const doms = await dominiosDe(modeloEmail);
    const { subject, html, text } = plantillaCredenciales(c.nombre, c.email, c.password, doms);
    console.log(`[TEST] Enviando a ${testTo} la version de ${c.nombre} (${modeloEmail})...`);
    if (dryRun) { console.log("  (dry-run: no se envio)"); return; }
    const id = await enviarCorreo(testTo, `[PRUEBA] ${subject}`, html, text);
    console.log(`  Enviado. id=${id}`);
    return;
  }

  if (!objetivos.length) {
    console.log("Sin destinatarios. Usa --all-honda, o pasa correos, o --test <correo>.");
    console.log("Agrega --dry-run para previsualizar sin enviar.");
    return;
  }

  console.log(`${dryRun ? "[DRY-RUN] " : ""}Destinatarios: ${objetivos.length}\n`);
  for (const email of objetivos) {
    const c = cred.get(email.toLowerCase());
    if (!c) { console.log(`  SALTADO ${email}: sin credencial en el CSV`); continue; }
    const doms = await dominiosDe(email);
    const { subject, html, text } = plantillaCredenciales(c.nombre, c.email, c.password, doms);
    if (dryRun) {
      console.log(`  → ${c.nombre} <${email}>  | dominios: ${doms.join(" · ") || "(ninguno)"}  | pass: ${c.password}`);
      continue;
    }
    try {
      const id = await enviarCorreo(email, subject, html, text);
      console.log(`  ✓ ${email}  id=${id}`);
    } catch (e) {
      console.log(`  ✗ ${email}  ERROR: ${(e as Error).message}`);
    }
  }
  if (dryRun) console.log("\n(dry-run: no se envió ningún correo)");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
