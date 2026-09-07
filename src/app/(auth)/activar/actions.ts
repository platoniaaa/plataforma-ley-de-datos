"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

export type ActivarState = { error?: string; ok?: boolean };

const schema = z
  .object({
    token: z.string().min(10),
    password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres."),
    confirmacion: z.string(),
  })
  .refine((d) => d.password === d.confirmacion, {
    message: "Las dos contraseñas no coinciden.",
    path: ["confirmacion"],
  });

/**
 * Activa la cuenta: la persona define su propia contraseña a partir del enlace que
 * recibió. El token se invalida en el mismo paso, así el enlace sirve una sola vez.
 */
export async function activarAction(_prev: ActivarState, formData: FormData): Promise<ActivarState> {
  const parsed = schema.safeParse({
    token: String(formData.get("token") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirmacion: String(formData.get("confirmacion") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const { token, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { tokenActivacion: token },
    select: { id: true, tokenExpira: true, activo: true },
  });
  if (!user || !user.activo) {
    return { error: "Este enlace no es válido. Solicita uno nuevo a tu contacto de Procesos360." };
  }
  if (user.tokenExpira && user.tokenExpira < new Date()) {
    return { error: "Este enlace ya expiró. Solicita uno nuevo a tu contacto de Procesos360." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: bcrypt.hashSync(password, 10),
      tokenActivacion: null,
      tokenExpira: null,
    },
  });

  return { ok: true };
}
