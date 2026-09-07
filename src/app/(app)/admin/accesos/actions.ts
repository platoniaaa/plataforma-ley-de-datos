"use server";

import { revalidatePath } from "next/cache";
import { requireAdminGlobal } from "@/lib/session";
import { correoConfigurado } from "@/lib/email";
import {
  destinatariosActivos,
  enviarEnlaceDeActivacion,
  enviarPasswordDeReemplazo,
  type Fallido,
} from "@/lib/accesos";

export type ResultadoEnvio = {
  ok: boolean;
  error?: string;
  enviados?: number;
  fallidos?: Fallido[];
};

/**
 * Lo común a los dos caminos: quién puede hacerlo, si hay correo, y a quién se le manda.
 *
 * El envío en sí vive en `@/lib/accesos`, que comparte esta pantalla con la línea de
 * comandos. Aquí queda solo lo que es propio de la pantalla: el permiso y el registro de
 * quién lo autorizó.
 */
async function preparar(userIds: string[]) {
  const session = await requireAdminGlobal();
  if (!correoConfigurado()) {
    return { error: "El envío de correo no está configurado en el servidor." };
  }
  if (userIds.length === 0) return { error: "No seleccionaste a nadie." };

  const users = await destinatariosActivos(userIds);
  if (users.length === 0) return { error: "Ninguna de esas cuentas está activa." };
  return { session, users };
}

function registrar(email: string | null | undefined, que: string, enviados: number, fallidos: Fallido[]) {
  console.log(
    `[accesos] ${email ?? "sin identificar"} ${que}: ${enviados} enviado(s)` +
      (fallidos.length ? `, ${fallidos.length} fallidos` : "")
  );
  revalidatePath("/admin/accesos");
}

/** Manda el enlace para que cada persona defina su propia contraseña. */
export async function enviarEnlaceActivacion(userIds: string[]): Promise<ResultadoEnvio> {
  const { error, session, users } = await preparar(userIds);
  if (error || !session || !users) return { ok: false, error };

  const { enviados, fallidos } = await enviarEnlaceDeActivacion(users);
  registrar(session.user.email, "envió enlaces de activación", enviados, fallidos);
  return { ok: true, enviados, fallidos };
}

/**
 * Genera una contraseña nueva y la manda escrita.
 *
 * Es un reemplazo, no un reenvío: la contraseña original no se puede recuperar porque en
 * la base solo vive su hash. Quien reciba este correo pierde la clave que tuviera.
 */
export async function enviarPasswordNueva(userIds: string[]): Promise<ResultadoEnvio> {
  const { error, session, users } = await preparar(userIds);
  if (error || !session || !users) return { ok: false, error };

  // Restablecer la propia contraseña desde aquí solo genera confusión: para eso está el
  // flujo normal de la cuenta, y de paso evita dejarse fuera por accidente.
  if (userIds.includes(session.user.id)) {
    return { ok: false, error: "No puedes generarte una contraseña nueva a ti mismo desde aquí." };
  }

  const { enviados, fallidos } = await enviarPasswordDeReemplazo(users);
  registrar(session.user.email, "generó contraseñas nuevas", enviados, fallidos);
  return { ok: true, enviados, fallidos };
}
