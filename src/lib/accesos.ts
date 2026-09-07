import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import {
  enviarCorreo,
  plantillaActivacion,
  plantillaCredenciales,
  DIAS_VIGENCIA_ENLACE,
} from "./email";

// Cómo se le devuelve a alguien la entrada a la plataforma.
//
// Vive aquí y no dentro de la acción de la pantalla porque tiene dos llamadores: la
// sección de Accesos, que es por donde debe hacerse, y una línea de comandos para cuando
// hay que resolverlo desde afuera. Es un camino que cambia contraseñas: tenerlo escrito
// dos veces significaría que un día uno de los dos deja de limpiar el token de activación
// y queda una segunda puerta abierta sobre la misma cuenta.
//
// Importa por ruta relativa a propósito: el alias "@/" no lo resuelve la línea de
// comandos, y este módulo tiene que poder importarse desde las dos partes.

export const APP_URL = "https://lpdp.procesos360.cl";

export type Fallido = { nombre: string; motivo: string };
export type Envio = { enviados: number; fallidos: Fallido[] };
export type Destinatario = { id: string; nombre: string; email: string };

/** Las cuentas activas de esa lista. Una desactivada no recibe acceso. */
export async function destinatariosActivos(userIds: string[]): Promise<Destinatario[]> {
  return prisma.user.findMany({
    where: { id: { in: userIds }, activo: true },
    select: { id: true, nombre: true, email: true },
    orderBy: { nombre: "asc" },
  });
}

export async function dominiosDe(userId: string): Promise<string[]> {
  const p = await prisma.participanteDominio.findMany({
    where: { userId },
    select: { diagnosticoDominio: { select: { dominio: { select: { orden: true, nombre: true } } } } },
  });
  return p
    .map((x) => x.diagnosticoDominio.dominio)
    .sort((a, b) => a.orden - b.orden)
    .map((d) => `${d.orden}. ${d.nombre}`);
}

/** Token de un solo uso. Reemplaza cualquier enlace anterior de esa persona. */
async function nuevoEnlace(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.user.update({
    where: { id: userId },
    data: {
      tokenActivacion: token,
      tokenExpira: new Date(Date.now() + DIAS_VIGENCIA_ENLACE * 24 * 60 * 60 * 1000),
    },
  });
  return `${APP_URL}/activar?token=${token}`;
}

/**
 * Contraseña legible pero no adivinable. Se evitan los caracteres que se confunden al
 * dictarla por teléfono o al copiarla de un correo (l/1/I, O/0), porque este camino se
 * usa justamente cuando la persona no logró entrar por el enlace.
 */
function passwordTemporal(): string {
  const abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(14);
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

/** Manda el enlace para que cada persona defina su propia contraseña. */
export async function enviarEnlaceDeActivacion(users: Destinatario[]): Promise<Envio> {
  let enviados = 0;
  const fallidos: Fallido[] = [];

  for (const u of users) {
    try {
      const enlace = await nuevoEnlace(u.id);
      const { subject, html, text } = plantillaActivacion(u.nombre, enlace, await dominiosDe(u.id));
      await enviarCorreo(u.email, subject, html, text);
      await prisma.user.update({
        where: { id: u.id },
        data: { ultimoAccesoEnviado: new Date() },
      });
      enviados++;
    } catch (e) {
      // El rechazo del servidor de correo de uno no puede cortar el envío al resto.
      fallidos.push({ nombre: u.nombre, motivo: (e as Error).message.slice(0, 120) });
    }
  }
  return { enviados, fallidos };
}

/**
 * Genera una contraseña nueva y la manda escrita.
 *
 * Es un reemplazo, no un reenvío: la contraseña original no se puede recuperar porque en
 * la base solo vive su hash. Quien reciba este correo pierde la clave que tuviera.
 */
export async function enviarPasswordDeReemplazo(users: Destinatario[]): Promise<Envio> {
  let enviados = 0;
  const fallidos: Fallido[] = [];

  for (const u of users) {
    const password = passwordTemporal();
    try {
      const { subject, html, text } = plantillaCredenciales(
        u.nombre,
        u.email,
        password,
        await dominiosDe(u.id),
        true
      );
      // Primero se envía y después se guarda: si el correo no sale, la persona conserva
      // la contraseña que tenía en vez de quedarse con una que nadie conoce.
      await enviarCorreo(u.email, subject, html, text);
      await prisma.user.update({
        where: { id: u.id },
        data: {
          passwordHash: bcrypt.hashSync(password, 10),
          // Un enlace de activación pendiente ya no tiene sentido y sería una segunda
          // puerta abierta sobre la misma cuenta.
          tokenActivacion: null,
          tokenExpira: null,
          ultimoAccesoEnviado: new Date(),
        },
      });
      enviados++;
    } catch (e) {
      fallidos.push({ nombre: u.nombre, motivo: (e as Error).message.slice(0, 120) });
    }
  }
  return { enviados, fallidos };
}
