"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdminGlobal } from "@/lib/session";
import { ROLES } from "@/lib/constants";

export type Result = { ok: boolean; id?: string; error?: string };

const empresaSchema = z.object({
  razonSocial: z.string().min(2).max(200),
  rut: z.string().min(3).max(20),
  industria: z.string().max(120).optional().default(""),
  tamano: z.string().max(20).optional().default(""),
  // Usuario administrador inicial (opcional).
  adminNombre: z.string().max(120).optional().default(""),
  adminEmail: z.string().email().max(160).optional().or(z.literal("")),
  adminPassword: z.string().min(6).max(100).optional().or(z.literal("")),
});

/** Crea una empresa cliente y, opcionalmente, su usuario administrador. */
export async function crearEmpresaAction(input: z.input<typeof empresaSchema>): Promise<Result> {
  await requireAdminGlobal();
  const parsed = empresaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const d = parsed.data;

  const dup = await prisma.empresa.findUnique({ where: { rut: d.rut }, select: { id: true } });
  if (dup) return { ok: false, error: "Ya existe una empresa con ese RUT." };

  const empresa = await prisma.empresa.create({
    data: {
      razonSocial: d.razonSocial,
      rut: d.rut,
      industria: d.industria || null,
      tamano: d.tamano || null,
    },
  });

  if (d.adminEmail && d.adminPassword) {
    const existe = await prisma.user.findUnique({ where: { email: d.adminEmail }, select: { id: true } });
    if (!existe) {
      await prisma.user.create({
        data: {
          nombre: d.adminNombre || "Administrador",
          email: d.adminEmail,
          role: ROLES.ADMIN_EMPRESA,
          empresaId: empresa.id,
          passwordHash: bcrypt.hashSync(d.adminPassword, 10),
        },
      });
    }
  }

  revalidatePath("/admin/empresas");
  return { ok: true, id: empresa.id };
}

/** Activa o desactiva una empresa. */
export async function toggleEmpresaActivaAction(empresaId: string): Promise<Result> {
  await requireAdminGlobal();
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { activa: true } });
  if (!empresa) return { ok: false, error: "Empresa no encontrada." };
  await prisma.empresa.update({ where: { id: empresaId }, data: { activa: !empresa.activa } });
  revalidatePath("/admin/empresas");
  return { ok: true };
}
