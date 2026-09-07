// Envia por correo (Resend) el COMUNICADO de aviso previo: anuncia que llegara el
// correo de acceso a la plataforma LPDP. No entrega credenciales.
//
// Uso:
//   npx tsx prisma/enviar-comunicado.ts --dry-run --all-honda
//   npx tsx prisma/enviar-comunicado.ts --test correo1@x.cl correo2@y.cl   (asunto [PRUEBA])
//   npx tsx prisma/enviar-comunicado.ts correo1@honda.cl correo2@...        (envio real)
//   npx tsx prisma/enviar-comunicado.ts --all-honda
//
// El saludo se personaliza con el nombre (desde el CSV/base; si no, desde el correo).

import { readFileSync } from "fs";
import { join } from "path";
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APP_URL = "https://lpdp.procesos360.cl";
const RESEND_API_KEY = process.env.RESEND_API_KEY!;
const EMAIL_FROM = process.env.EMAIL_FROM!;
// El remitente no recibe respuestas: hay que dar un contacto real.
const CONTACTO = "francisco.guajardo@procesos360.cl";

// Alias para correos de prueba que no son usuarios del sistema.
const ALIAS: Record<string, string> = { "fj.guajardos@gmail.com": "Francisco Guajardo" };

function leerNombresCSV(): Map<string, string> {
  const txt = readFileSync(join(__dirname, "..", "docs", "credenciales-iniciales.csv"), "utf-8");
  const map = new Map<string, string>();
  for (const line of txt.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const cols = line.match(/"([^"]*)"/g)?.map((s) => s.slice(1, -1)) ?? [];
    if (cols.length >= 2) map.set(cols[1].toLowerCase(), cols[0]);
  }
  return map;
}

function nombreDesdeCorreo(email: string): string {
  const local = email.split("@")[0].split(/[._]/)[0];
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function plantilla(nombre: string): { subject: string; html: string; text: string } {
  const primerNombre = nombre.split(" ")[0];
  const subject = "Diagnóstico Ley de Protección de Datos (LPDP) — en breve recibirás tu acceso a la plataforma";

  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2937">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
      <p style="margin:0 0 4px;font-size:13px;color:#6b7280">Procesos360 · Ley 21.719 de Protección de Datos Personales</p>
      <h1 style="margin:0 0 14px;font-size:20px;color:#111827">Estimado/a ${primerNombre},</h1>
      <p style="margin:0 0 12px;line-height:1.6">En el marco del cumplimiento de la nueva <strong>Ley N° 21.719 de Protección de Datos Personales</strong>, Honda ha iniciado un <strong>diagnóstico de cumplimiento</strong> de la mano de <strong>Procesos360</strong>. El objetivo es levantar, dominio por dominio, cómo la organización trata los datos personales, identificar brechas y construir el plan de adecuación.</p>
      <p style="margin:0 0 16px;line-height:1.6">Has sido identificado/a como <strong>responsable de responder uno o más dominios</strong> del diagnóstico, según tu área y conocimiento. Por eso te escribimos.</p>

      <p style="margin:0 0 6px;font-weight:600;color:#111827">¿Qué va a pasar ahora?</p>
      <p style="margin:0 0 8px;line-height:1.6">En las próximas horas recibirás un <strong>segundo correo</strong> —desde esta misma dirección— con:</p>
      <ul style="margin:0 0 16px;padding-left:20px;line-height:1.6">
        <li>Tus <strong>credenciales de acceso</strong> (usuario y contraseña).</li>
        <li>El <strong>detalle de los dominios asignados</strong> a ti.</li>
        <li>El <strong>enlace directo</strong> para ingresar: <a href="${APP_URL}" style="color:#2563eb">${APP_URL.replace("https://", "")}</a></li>
      </ul>

      <p style="margin:0 0 6px;font-weight:600;color:#111827">¿Qué te pediremos hacer?</p>
      <ol style="margin:0 0 16px;padding-left:20px;line-height:1.6">
        <li>Ingresar a la plataforma con tus credenciales.</li>
        <li>Aceptar el <strong>consentimiento informado</strong> (paso único, la primera vez).</li>
        <li>Responder las <strong>preguntas de tu(s) dominio(s)</strong> y <strong>adjuntar la evidencia</strong> disponible.</li>
      </ol>

      <p style="margin:0 0 12px;line-height:1.6">Es importante contar con tus respuestas dentro de los plazos que coordinaremos en las sesiones de trabajo. Ante cualquier duda o problema, escríbeme directamente a <a href="mailto:${CONTACTO}" style="color:#2563eb;font-weight:600">${CONTACTO}</a>. Este correo es automático y no recibe respuestas.</p>
      <p style="margin:0 0 4px;line-height:1.6"><strong>Por favor, mantente atento/a al correo de acceso</strong> (revisa también correo no deseado / spam por si acaso).</p>
      <p style="margin:16px 0 0;line-height:1.6;font-size:14px;color:#374151">Agradecemos desde ya tu colaboración en este proceso.</p>
      <p style="margin:14px 0 0;line-height:1.5;font-size:14px;color:#111827"><strong>Equipo Procesos360</strong><br><span style="color:#6b7280">Diagnóstico LPDP — Ley N° 21.719</span></p>
    </div>
    <p style="text-align:center;margin:14px 0 0;font-size:12px;color:#9ca3af">Este es un correo automático de notificación. Procesos360 SpA.</p>
  </div></body></html>`;

  const text = `Estimado/a ${primerNombre},

En el marco del cumplimiento de la nueva Ley N° 21.719 de Protección de Datos Personales, Honda ha iniciado un diagnóstico de cumplimiento de la mano de Procesos360. El objetivo es levantar, dominio por dominio, cómo la organización trata los datos personales, identificar brechas y construir el plan de adecuación.

Has sido identificado/a como responsable de responder uno o más dominios del diagnóstico, según tu área y conocimiento.

¿Qué va a pasar ahora?
En las próximas horas recibirás un segundo correo, desde esta misma dirección, con:
  - Tus credenciales de acceso (usuario y contraseña).
  - El detalle de los dominios asignados a ti.
  - El enlace directo para ingresar: ${APP_URL}

¿Qué te pediremos hacer?
  1. Ingresar a la plataforma con tus credenciales.
  2. Aceptar el consentimiento informado (paso único, la primera vez).
  3. Responder las preguntas de tu(s) dominio(s) y adjuntar la evidencia disponible.

Por favor, mantente atento/a al correo de acceso (revisa también spam por si acaso).

Ante cualquier duda o problema, escríbeme directamente a ${CONTACTO}.
Este correo es automático y no recibe respuestas.

Agradecemos tu colaboración.

Equipo Procesos360
Diagnóstico LPDP — Ley N° 21.719`;

  return { subject, html, text };
}

async function enviarResend(to: string, subject: string, html: string, text: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, html, text }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(body)}`);
  return body?.id as string;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const test = args.includes("--test");
  const allHonda = args.includes("--all-honda");
  if (!RESEND_API_KEY || !EMAIL_FROM) throw new Error("Falta RESEND_API_KEY o EMAIL_FROM en .env");

  const nombresCSV = leerNombresCSV();

  let objetivos: string[] = [];
  if (allHonda) {
    const honda = await prisma.user.findMany({
      where: { role: "RESPONSABLE_DOMINIO", empresa: { rut: "96.870.620-9" } },
      select: { email: true }, orderBy: { email: "asc" },
    });
    objetivos = honda.map((u) => u.email);
  } else {
    objetivos = args.filter((a) => a.includes("@"));
  }
  if (!objetivos.length) {
    console.log("Sin destinatarios. Usa --all-honda, o pasa correos, o --test <correos>.");
    return;
  }

  // Resuelve nombres (CSV -> base -> alias -> desde el correo).
  const dbUsers = await prisma.user.findMany({
    where: { email: { in: objetivos } }, select: { email: true, nombre: true },
  });
  const nombresDB = new Map(dbUsers.map((u) => [u.email.toLowerCase(), u.nombre]));

  console.log(`${dryRun ? "[DRY-RUN] " : ""}${test ? "[PRUEBA] " : ""}Destinatarios: ${objetivos.length}\n`);
  for (const email of objetivos) {
    const key = email.toLowerCase();
    const nombre = nombresCSV.get(key) ?? nombresDB.get(key) ?? ALIAS[key] ?? nombreDesdeCorreo(email);
    const { subject, html, text } = plantilla(nombre);
    const asunto = test ? `[PRUEBA] ${subject}` : subject;
    if (dryRun) { console.log(`  → ${nombre} <${email}>`); continue; }
    try {
      const id = await enviarResend(email, asunto, html, text);
      console.log(`  ✓ ${email} (${nombre})  id=${id}`);
    } catch (e) {
      console.log(`  ✗ ${email}  ERROR: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
