// Sin "server-only": este modulo lo comparten la aplicacion y los scripts de
// linea de comandos. La clave de Resend se lee de las variables de entorno del
// servidor, que nunca llegan al navegador.
import { queFalta, type PendientesUsuario } from "@/lib/data/pendientes";

// Envío de correo transaccional. Se usa la API REST de Resend directamente para no
// sumar una dependencia por tres llamadas.

const APP_URL = "https://lpdp.procesos360.cl";
// El remitente no recibe respuestas: todo correo debe ofrecer un contacto real.
const CONTACTO = "francisco.guajardo@procesos360.cl";

export function correoConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/**
 * ¿Este entorno puede escribirle a una persona de verdad?
 *
 * La respuesta por defecto es NO, y hay que habilitarlo a mano. Es deliberado: un
 * ambiente de pruebas al que se le olvidó una variable no puede terminar mandándole
 * credenciales a los participantes del cliente. Producción en Vercel se reconoce sola;
 * la línea de comandos necesita LPDP_CORREO_REAL=true en su .env.
 */
function entregaReal(): boolean {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === "production";
  return process.env.LPDP_CORREO_REAL === "true";
}

export async function enviarCorreo(
  to: string,
  subject: string,
  html: string,
  text: string
): Promise<string> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) throw new Error("Falta RESEND_API_KEY o EMAIL_FROM.");

  // Fuera de producción, el correo se desvía a la casilla de pruebas y el asunto dice a
  // quién habría llegado. Si no hay casilla configurada no se envía nada: es preferible
  // que una prueba falle a que le llegue un recordatorio real a alguien del cliente.
  if (!entregaReal()) {
    const pruebas = process.env.EMAIL_PRUEBAS;
    if (!pruebas) {
      throw new Error(
        `Entorno de pruebas sin EMAIL_PRUEBAS: no se envió nada (iba a ${to}).`
      );
    }
    // El asunto conserva el destinatario original: en una casilla que recibe todo el
    // correo de las pruebas, sin eso no se distingue a quién iba dirigido cada uno.
    subject = `[UAT → ${to}] ${subject}`;
    to = pruebas;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detalle = (body as { message?: string })?.message ?? `error ${res.status}`;
    throw new Error(detalle);
  }
  return (body as { id?: string })?.id ?? "";
}

/** Recordatorio de lo que le falta a un participante. */
export function plantillaRecordatorio(u: PendientesUsuario) {
  const primerNombre = u.nombre.split(" ")[0];
  const porResponder = u.dominios.reduce((n, d) => n + d.sinResponder, 0);
  const sinMirada = u.dominios.reduce((n, d) => n + d.sinTuMirada, 0);
  const porEnviar = u.dominios.filter((d) => d.listoSinEnviar);
  const evidencias = u.dominios.reduce((n, d) => n + d.sinEvidencia, 0);
  const soloCuestionarioListo = porResponder === 0 && sinMirada === 0;
  // A quien no ha registrado ni una respuesta no se le habla del detalle: "7 sin tu
  // mirada" da a entender que revisó algo y lo dejó a medias. Lo que necesita saber es
  // que todavía no empieza y por dónde entrar.
  const nuncaEmpezo = u.aportes === 0;

  const subject = nuncaEmpezo
    ? u.dominios.length === 1
      ? `Diagnóstico LPDP — te espera el dominio de ${u.dominios[0].nombre}`
      : `Diagnóstico LPDP — te esperan ${u.dominios.length} dominios por responder`
    : !soloCuestionarioListo
    ? u.dominios.length === 1
      ? `Diagnóstico LPDP — te queda pendiente el dominio de ${u.dominios[0].nombre}`
      : `Diagnóstico LPDP — tienes ${u.dominios.length} dominios pendientes`
    : evidencias > 0
      ? `Diagnóstico LPDP — falta adjuntar ${evidencias === 1 ? "1 documento" : `${evidencias} documentos`}`
      : porEnviar.length > 0
        ? `Diagnóstico LPDP — solo falta que envíes ${porEnviar.length === 1 ? "tu dominio" : `tus ${porEnviar.length} dominios`}`
        : "Diagnóstico LPDP — te queda un paso pendiente";

  const intro = nuncaEmpezo
    ? `Todavía no registras ninguna respuesta en la plataforma. ${
        u.dominios.length === 1
          ? "Este es el dominio que tienes a tu cargo"
          : `Estos son los ${u.dominios.length} dominios que tienes a tu cargo`
      }:`
    : soloCuestionarioListo
    ? evidencias > 0
      ? "Ya respondiste todas las preguntas. Lo único que falta es adjuntar los documentos que respaldan tus respuestas."
      : "Buenas noticias: ya está todo respondido. Solo queda un paso para que podamos revisarlo."
    : `Para poder avanzar con el diagnóstico, esto es lo que queda pendiente en ${
        u.dominios.length === 1 ? "el dominio" : "los dominios"
      } a tu cargo:`;

  // Sin nada registrado, "qué falta" es todo: se muestra el tamaño de la tarea.
  const detalle = (d: (typeof u.dominios)[number]) =>
    nuncaEmpezo ? `${d.total} ${d.total === 1 ? "pregunta" : "preguntas"}` : queFalta(d);

  const filas = u.dominios
    .map(
      (d) => `<tr>
        <td style="padding:11px 14px;border-bottom:1px solid #eef1f5;font-weight:600;color:#111827">${d.orden}. ${d.nombre}</td>
        <td style="padding:11px 14px;border-bottom:1px solid #eef1f5;text-align:right;white-space:nowrap;color:#374151">${detalle(d)}</td>
      </tr>`
    )
    .join("");

  const notas: string[] = [];
  if (nuncaEmpezo) {
    notas.push(
      `Entra con tu usuario y contraseña, acepta el <strong>consentimiento informado</strong> y
       abre cualquiera de tus dominios. Cada pregunta se guarda sola apenas la respondes, así
       que puedes hacerlo en varias veces y salir cuando quieras.`
    );
  }
  if (!nuncaEmpezo && sinMirada > 0) {
    notas.push(
      `Donde dice <em>“sin tu mirada”</em> ya respondió un colega. <strong>Registra igual la tuya</strong>,
       aunque no coincida: cada uno conoce una parte distinta de la operación y esas diferencias son
       justamente lo que necesitamos ver.`
    );
  }
  if (!nuncaEmpezo && evidencias > 0) {
    notas.push(
      `Marcaste que el control existe, así que necesitamos el documento que lo demuestra: se adjunta
       en la misma pregunta, con <strong>“Subir evidencia”</strong>. Mientras falte, el dominio no se
       puede enviar a validación aunque el cuestionario se vea completo.`
    );
  }
  if (!nuncaEmpezo && porEnviar.length > 0) {
    notas.push(
      `${porEnviar.length === 1 ? "Un dominio ya está completo" : `${porEnviar.length} dominios ya están completos`}:
       solo falta apretar <strong>“Enviar respuestas a validación”</strong> dentro del dominio.
       Mientras no lo hagas, no podemos empezar a revisarlo.`
    );
  }
  const nota = notas
    .map(
      (t) =>
        `<p style="margin:16px 0 0;line-height:1.6;background:#f7f9fb;border-left:3px solid #2f6df0;padding:12px 15px;font-size:14px;color:#3c4854">${t}</p>`
    )
    .join("");

  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2937">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
      <p style="margin:0 0 4px;font-size:13px;color:#6b7280">Procesos360 · Ley 21.719 de Protección de Datos Personales</p>
      <h1 style="margin:0 0 14px;font-size:20px;color:#111827">Hola ${primerNombre},</h1>
      <p style="margin:0 0 14px;line-height:1.6">${intro}</p>

      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:14px">
        <thead><tr style="background:#f7f9fb">
          <th style="text-align:left;padding:9px 14px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">Dominio</th>
          <th style="text-align:right;padding:9px 14px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">Qué falta</th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>

      ${
        porResponder + sinMirada > 0
          ? `<p style="margin:14px 0 0;line-height:1.6;font-size:14px;color:#374151">
               Son <strong>${porResponder + sinMirada} preguntas</strong> en total. Para cada una necesitamos
               la nota del 0 al 5, un comentario breve y, si existe, el documento que lo respalde.
               Se guarda solo, así que puedes hacerlo en varias veces.
             </p>`
          : ""
      }
      ${nota}

      <div style="text-align:center;margin:24px 0 8px">
        <a href="${APP_URL}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600">Ir a responder</a>
      </div>
      <p style="margin:12px 0 0;line-height:1.55;font-size:13px;color:#374151">
        Ante cualquier problema, escríbeme directamente a
        <a href="mailto:${CONTACTO}" style="color:#2563eb;font-weight:600">${CONTACTO}</a>.
        Este correo es automático y no recibe respuestas.
      </p>
    </div>
    <p style="text-align:center;margin:14px 0 0;font-size:12px;color:#9ca3af">Procesos360 SpA · Diagnóstico LPDP Honda</p>
  </div></body></html>`;

  const text = `Hola ${primerNombre},

${intro}

${u.dominios.map((d) => `  - ${d.orden}. ${d.nombre}: ${detalle(d)}`).join("\n")}
${porResponder + sinMirada > 0 ? `\nSon ${porResponder + sinMirada} preguntas en total. Para cada una necesitamos la nota del 0 al 5, un comentario breve y, si existe, el documento que lo respalde.` : ""}
${nuncaEmpezo ? `\nEntra con tu usuario y contraseña, acepta el consentimiento informado y abre cualquiera de tus dominios. Cada pregunta se guarda sola apenas la respondes, así que puedes hacerlo en varias veces y salir cuando quieras.` : ""}
${!nuncaEmpezo && evidencias > 0 ? `\nFalta adjuntar ${evidencias === 1 ? "1 documento" : `${evidencias} documentos`}: se sube en la misma pregunta, con "Subir evidencia". Mientras falte, el dominio no se puede enviar a validación.` : ""}
${!nuncaEmpezo && porEnviar.length > 0 ? `\n${porEnviar.length === 1 ? "Un dominio ya está completo" : `${porEnviar.length} dominios ya están completos`}: falta apretar "Enviar respuestas a validación" dentro del dominio.` : ""}

Ingresa en: ${APP_URL}

Ante cualquier problema, escríbeme directamente a ${CONTACTO}.
Este correo es automático y no recibe respuestas.

Procesos360 · Diagnóstico LPDP Honda`;

  return { subject, html, text };
}

// ───────────────────────── Acceso a la plataforma ─────────────────────────
//
// Dos formas de entregar el acceso, para dos situaciones distintas:
//
//   · El enlace de activación es el camino normal. La contraseña nunca viaja ni queda
//     archivada en una bandeja de entrada, y los filtros corporativos no leen el correo
//     como phishing —Honda llegó a bloquear al remitente justamente por eso—.
//   · La contraseña escrita se reserva para cuando la persona no logra usar el enlace.
//     Sirve de inmediato y no depende de que abra nada.
//
// Las plantillas viven aquí y no en los scripts porque las usan la sección de accesos
// de la plataforma y la línea de comandos, y ambas tienen que decir lo mismo.

export const DIAS_VIGENCIA_ENLACE = 7;

function listaDominiosHtml(dominios: string[]): string {
  if (dominios.length === 0) return "";
  return `<p style="margin:16px 0 6px;line-height:1.6">Vas a responder ${
    dominios.length === 1 ? "el siguiente dominio" : "los siguientes dominios"
  }:</p>
   <ul style="margin:0 0 8px;padding-left:20px;line-height:1.6;color:#111827">${dominios
     .map((d) => `<li style="margin:2px 0">${d}</li>`)
     .join("")}</ul>`;
}

function envoltorio(cuerpo: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2937">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
      <p style="margin:0 0 4px;font-size:13px;color:#6b7280">Procesos360 · Ley 21.719 de Protección de Datos Personales</p>
      ${cuerpo}
      <p style="margin:16px 0 0;line-height:1.55;font-size:13px;color:#374151">
        Ante cualquier duda o problema para ingresar, escríbeme directamente a
        <a href="mailto:${CONTACTO}" style="color:#2563eb;font-weight:600">${CONTACTO}</a>.
        Este correo es automático y no recibe respuestas.
      </p>
    </div>
    <p style="text-align:center;margin:14px 0 0;font-size:12px;color:#9ca3af">Procesos360 SpA · Diagnóstico LPDP</p>
  </div></body></html>`;
}

/** Invitación a activar la cuenta: la persona define su propia contraseña. */
export function plantillaActivacion(nombre: string, enlace: string, dominios: string[]) {
  const primerNombre = nombre.split(" ")[0];
  const subject = "Activa tu cuenta — Diagnóstico LPDP";

  const html = envoltorio(`
      <h1 style="margin:0 0 12px;font-size:20px;color:#111827">Hola ${primerNombre},</h1>
      <p style="margin:0 0 12px;line-height:1.6">Tu empresa está realizando su <strong>diagnóstico de cumplimiento de la Ley de Protección de Datos Personales</strong> junto a Procesos360, y te hemos habilitado una cuenta para participar.</p>
      ${listaDominiosHtml(dominios)}
      <p style="margin:16px 0 12px;line-height:1.6">Para empezar, activa tu cuenta y <strong>define tu propia contraseña</strong>:</p>
      <div style="text-align:center;margin:22px 0">
        <a href="${enlace}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:13px 30px;border-radius:8px;font-weight:600">Activar mi cuenta</a>
      </div>
      <p style="margin:0 0 12px;line-height:1.55;font-size:13px;color:#6b7280">
        El enlace sirve una sola vez y vence en ${DIAS_VIGENCIA_ENLACE} días. Si el botón no funciona,
        copia esta dirección en tu navegador:<br>
        <span style="word-break:break-all;color:#374151">${enlace}</span>
      </p>
      <p style="margin:14px 0 0;line-height:1.6;font-size:14px;color:#374151">
        Al entrar por primera vez se te pedirá aceptar el <strong>consentimiento informado</strong>.
      </p>`);

  const text = `Hola ${primerNombre},

Tu empresa está realizando su diagnóstico de cumplimiento de la Ley de Protección de Datos Personales junto a Procesos360, y te hemos habilitado una cuenta para participar.
${dominios.length ? `\nVas a responder:\n${dominios.map((d) => `  - ${d}`).join("\n")}\n` : ""}
Para empezar, activa tu cuenta y define tu propia contraseña en este enlace:

${enlace}

El enlace sirve una sola vez y vence en ${DIAS_VIGENCIA_ENLACE} días.
Al entrar por primera vez se te pedirá aceptar el consentimiento informado.

Ante cualquier duda o problema, escríbeme directamente a ${CONTACTO}.
Este correo es automático y no recibe respuestas.

Procesos360 · Diagnóstico LPDP`;

  return { subject, html, text };
}

/**
 * Credenciales escritas. `nueva` distingue el primer envío de un reemplazo: si es un
 * reemplazo hay que decirlo, porque la clave anterior deja de servir en ese momento y
 * quien la tenía anotada necesita saber por qué dejó de entrar.
 */
export function plantillaCredenciales(
  nombre: string,
  email: string,
  password: string,
  dominios: string[],
  nueva = false
) {
  const primerNombre = nombre.split(" ")[0];
  const subject = nueva
    ? "Tu nueva contraseña — Diagnóstico LPDP"
    : "Acceso a la plataforma de diagnóstico LPDP";

  const apertura = nueva
    ? `<p style="margin:0 0 12px;line-height:1.6">Te generamos una <strong>contraseña nueva</strong> para la plataforma del diagnóstico LPDP. La anterior, si la tenías, ya no sirve.</p>`
    : `<p style="margin:0 0 12px;line-height:1.6">Te damos acceso a la plataforma con la que tu empresa está realizando su <strong>diagnóstico de cumplimiento de la Ley de Protección de Datos Personales (LPDP)</strong>. Desde ahí responderás las preguntas de los dominios a tu cargo y adjuntarás la evidencia correspondiente.</p>`;

  const html = envoltorio(`
      <h1 style="margin:0 0 12px;font-size:20px;color:#111827">Hola ${primerNombre},</h1>
      ${apertura}
      ${listaDominiosHtml(dominios)}
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin:18px 0">
        <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Tus credenciales</p>
        <p style="margin:0 0 4px"><strong>Usuario:</strong> ${email}</p>
        <p style="margin:0"><strong>Contraseña:</strong> <span style="font-family:monospace;font-size:15px">${password}</span></p>
      </div>
      <div style="text-align:center;margin:22px 0">
        <a href="${APP_URL}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600">Ingresar a la plataforma</a>
      </div>
      <p style="margin:0 0 12px;line-height:1.55;font-size:14px;color:#374151">Al ingresar por primera vez se te pedirá <strong>aceptar el consentimiento informado</strong> antes de comenzar. La dirección es <a href="${APP_URL}" style="color:#2563eb">${APP_URL.replace("https://", "")}</a>.</p>`);

  const text = `Hola ${primerNombre},

${
  nueva
    ? "Te generamos una contraseña nueva para la plataforma del diagnóstico LPDP. La anterior, si la tenías, ya no sirve."
    : "Te damos acceso a la plataforma del diagnóstico de la Ley de Protección de Datos Personales (LPDP) de tu empresa."
}
${dominios.length ? `\nDominios asignados:\n${dominios.map((d) => `  - ${d}`).join("\n")}\n` : ""}
Tus credenciales:
  Usuario: ${email}
  Contraseña: ${password}

Ingresa en: ${APP_URL}
Al entrar por primera vez se te pedirá aceptar el consentimiento informado.

Ante cualquier duda o problema para ingresar, escríbeme directamente a ${CONTACTO}.
Este correo es automático y no recibe respuestas.

Procesos360 · Diagnóstico LPDP`;

  return { subject, html, text };
}
