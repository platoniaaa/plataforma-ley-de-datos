// Reporte de avance del levantamiento, para la contraparte de la empresa.
//
// A diferencia del recordatorio (que le pide algo a una persona), esto es un informe
// ejecutivo: cuánto se lleva hecho, cómo va cada dominio y qué falta. Se envía cuando
// el consultor lo decide, no automáticamente.
//
// Las barras son celdas de tabla con ancho en porcentaje, no imágenes ni SVG: es lo
// único que dibuja igual en Outlook, Gmail y el correo del teléfono.
//
// Uso:
//   npx tsx prisma/enviar-reporte.ts --dry-run                 (muestra el resumen)
//   npx tsx prisma/enviar-reporte.ts --html reporte.html       (guarda para revisarlo)
//   npx tsx prisma/enviar-reporte.ts --test tucorreo@x.cl      (te lo manda a ti)
//   npx tsx prisma/enviar-reporte.ts correo1@honda.cl correo2@honda.cl

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
process.env.DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
import { PrismaClient } from "@prisma/client";
import { avanceDelDiagnostico, type AvanceDiagnostico } from "../src/lib/data/avance";
import { pendientesDelDiagnostico } from "../src/lib/data/pendientes";
import { NIVEL_MADUREZ } from "../src/lib/constants";
import { enviarCorreo } from "../src/lib/email";

const prisma = new PrismaClient();
const CONTACTO = "francisco.guajardo@procesos360.cl";
const APP_URL = "https://lpdp.procesos360.cl";

const VERDE = "#16a34a";
const AZUL = "#2563eb";
const GRIS = "#cbd5e1";

function hoy(): string {
  return new Date().toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" });
}

/** Barra de progreso hecha con tablas: es lo que Outlook dibuja sin romper. */
function barra(porcentaje: number, color: string, alto = 10): string {
  const lleno = Math.max(0, Math.min(100, porcentaje));
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;background:#eef1f5;border-radius:${alto / 2}px;">
    <tr><td style="height:${alto}px;line-height:${alto}px;font-size:0;">
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:${lleno}%;">
        <tr><td style="height:${alto}px;line-height:${alto}px;font-size:0;background:${color};border-radius:${alto / 2}px;">&nbsp;</td></tr>
      </table>
    </td></tr></table>`;
}

function plantilla(a: AvanceDiagnostico, pendientesPorDominio: Map<number, string[]>) {
  const subject = `Diagnóstico LPDP ${a.empresa} — avance ${a.porcentaje}% al ${hoy()}`;

  const filas = a.dominios
    .map((d) => {
      const color = d.cerrado || d.porcentaje === 100 ? VERDE : d.porcentaje === 0 ? GRIS : AZUL;
      const nivel = d.nivel ? NIVEL_MADUREZ[d.nivel] : null;
      const estado = d.cerrado
        ? `<span style="color:${VERDE};font-weight:700;">Cerrado</span>`
        : d.porcentaje === 0
          ? `<span style="color:#94a3b8;">Sin iniciar</span>`
          : `<span style="color:${AZUL};">En curso</span>`;
      const quienes = pendientesPorDominio.get(d.orden) ?? [];
      return `<tr>
        <td style="padding:10px 10px 10px 0;vertical-align:top;">
          <div style="font-size:14px;font-weight:600;color:#111827;">${d.orden}. ${d.nombre}</div>
          <div style="margin-top:5px;">${barra(d.porcentaje, color, 8)}</div>
          ${quienes.length ? `<div style="margin-top:5px;font-size:12px;color:#94a3b8;">Pendiente: ${quienes.join(", ")}</div>` : ""}
        </td>
        <td style="padding:10px 0;vertical-align:top;text-align:right;white-space:nowrap;font-size:13px;color:#374151;">
          <div style="font-weight:700;">${d.completas}/${d.total}</div>
          <div style="margin-top:3px;font-size:12px;">${estado}</div>
          ${nivel ? `<div style="margin-top:3px;font-size:12px;color:${nivel.color};">Madurez ${d.promedio}</div>` : ""}
        </td>
      </tr>`;
    })
    .join("");

  const sinIniciar = a.dominios.filter((d) => d.porcentaje === 0);

  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2937;">
  <div style="max-width:620px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:30px;">

      <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">Procesos360 · Ley 21.719 de Protección de Datos Personales</p>
      <h1 style="margin:0 0 4px;font-size:21px;color:#111827;">Avance del diagnóstico — ${a.empresa}</h1>
      <p style="margin:0 0 22px;font-size:13px;color:#9ca3af;">Al ${hoy()}</p>

      <!-- Avance global -->
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:10px;">
        <tr><td style="padding:20px;">
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="vertical-align:bottom;">
                <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Avance del levantamiento</div>
                <div style="margin-top:4px;font-size:36px;font-weight:700;color:#111827;line-height:1;">${a.porcentaje}%</div>
              </td>
              <td style="vertical-align:bottom;text-align:right;font-size:13px;color:#6b7280;">
                ${a.completas} de ${a.total}<br>preguntas completas
              </td>
            </tr>
          </table>
          <div style="margin-top:14px;">${barra(a.porcentaje, AZUL, 12)}</div>
        </td></tr>
      </table>

      <!-- Cifras -->
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-top:14px;text-align:center;">
        <tr>
          ${[
            [`${a.dominiosCerrados}/${a.dominios.length}`, "Dominios cerrados"],
            [String(a.evidencias), "Evidencias cargadas"],
            [`${a.participantesActivos}/${a.participantes}`, "Participantes activos"],
          ]
            .map(
              ([v, l]) => `<td style="padding:12px 6px;background:#f9fafb;border-radius:8px;">
                <div style="font-size:20px;font-weight:700;color:#111827;">${v}</div>
                <div style="margin-top:2px;font-size:11px;color:#6b7280;">${l}</div>
              </td><td style="width:8px;"></td>`
            )
            .join("")}
        </tr>
      </table>

      <!-- Por dominio -->
      <h2 style="margin:26px 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Detalle por dominio</h2>
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${filas}</table>

      ${
        sinIniciar.length > 0
          ? `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-top:20px;">
               <tr><td style="padding:14px 16px;background:#fdf6e7;border-left:4px solid #d97706;font-size:14px;color:#374151;">
                 <b style="color:#92400e;">Lo que falta para avanzar.</b>
                 ${sinIniciar.length === 1 ? "Queda un dominio" : `Quedan ${sinIniciar.length} dominios`} sin iniciar:
                 ${sinIniciar.map((d) => d.nombre).join(", ")}. Una vez respondidos, podemos cerrar el levantamiento
                 y pasar al análisis de brechas.
               </td></tr>
             </table>`
          : ""
      }

      <p style="margin:22px 0 0;line-height:1.6;font-size:14px;color:#374151;">
        El detalle completo está disponible en la plataforma:
        <a href="${APP_URL}" style="color:#2563eb;font-weight:600;">${APP_URL.replace("https://", "")}</a>
      </p>
      <p style="margin:14px 0 0;line-height:1.55;font-size:13px;color:#374151;">
        Cualquier consulta sobre este reporte, escríbeme a
        <a href="mailto:${CONTACTO}" style="color:#2563eb;font-weight:600;">${CONTACTO}</a>.
        Este correo es automático y no recibe respuestas.
      </p>
    </div>
    <p style="text-align:center;margin:14px 0 0;font-size:12px;color:#9ca3af;">Procesos360 SpA · Diagnóstico LPDP</p>
  </div></body></html>`;

  const text = `Avance del diagnóstico — ${a.empresa}
Al ${hoy()}

AVANCE DEL LEVANTAMIENTO: ${a.porcentaje}% (${a.completas} de ${a.total} preguntas completas)
Dominios cerrados: ${a.dominiosCerrados}/${a.dominios.length} · Evidencias: ${a.evidencias} · Participantes activos: ${a.participantesActivos}/${a.participantes}

DETALLE POR DOMINIO
${a.dominios
  .map(
    (d) =>
      `  ${d.orden}. ${d.nombre}: ${d.completas}/${d.total} (${d.porcentaje}%)` +
      `${d.cerrado ? " — cerrado" : d.porcentaje === 0 ? " — sin iniciar" : " — en curso"}` +
      `${d.promedio != null ? ` · madurez ${d.promedio}` : ""}`
  )
  .join("\n")}
${sinIniciar.length ? `\nFalta iniciar: ${sinIniciar.map((d) => d.nombre).join(", ")}.` : ""}

Detalle completo en ${APP_URL}
Consultas: ${CONTACTO}`;

  return { subject, html, text };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const htmlIdx = args.indexOf("--html");
  const htmlOut = htmlIdx >= 0 ? args[htmlIdx + 1] : null;
  const testIdx = args.indexOf("--test");
  const testTo = testIdx >= 0 ? args[testIdx + 1] : null;
  const destinos = args.filter((a) => a.includes("@") && a !== testTo);

  const diag = await prisma.diagnostico.findFirst({
    where: { empresa: { rut: "96.870.620-9" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!diag) throw new Error("No hay diagnóstico");

  const avance = await avanceDelDiagnostico(diag.id);
  if (!avance) throw new Error("No se pudo calcular el avance");

  // Quién tiene pendiente cada dominio: el reporte no solo dice qué falta, dice de quién.
  const porDominio = new Map<number, string[]>();
  for (const u of await pendientesDelDiagnostico(diag.id)) {
    for (const d of u.dominios) {
      if (d.sinResponder === 0) continue;
      const lista = porDominio.get(d.orden) ?? [];
      if (!lista.includes(u.nombre)) lista.push(u.nombre);
      porDominio.set(d.orden, lista);
    }
  }

  const { subject, html, text } = plantilla(avance, porDominio);

  console.log(`${avance.empresa} — avance ${avance.porcentaje}% (${avance.completas}/${avance.total})`);
  console.log(`Asunto: ${subject}\n`);
  for (const d of avance.dominios) {
    const b = "█".repeat(Math.round(d.porcentaje / 5)).padEnd(20, "·");
    console.log(`  ${String(d.orden).padStart(2)}. ${d.nombre.slice(0, 36).padEnd(36)} ${b} ${String(d.porcentaje).padStart(3)}%${d.cerrado ? " [cerrado]" : ""}`);
  }

  if (htmlOut) {
    writeFileSync(htmlOut, html, "utf-8");
    console.log(`\nGuardado en ${htmlOut} — ábrelo para revisarlo antes de enviar.`);
  }
  if (dryRun || (!testTo && destinos.length === 0)) {
    console.log("\n(no se envió: usa --test <correo> o indica destinatarios)");
    return;
  }

  for (const to of testTo ? [testTo] : destinos) {
    try {
      const id = await enviarCorreo(to, testTo ? `[PRUEBA] ${subject}` : subject, html, text);
      console.log(`  ✓ ${to} · id=${id}`);
    } catch (e) {
      console.log(`  ✗ ${to} · ERROR: ${(e as Error).message.slice(0, 140)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
