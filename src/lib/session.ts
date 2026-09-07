import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ROLES, ROLES_P360, type Role } from "@/lib/constants";

/** Sesión memoizada dentro del request. */
export const getSession = cache(async () => auth());

export async function requireSession() {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  return session;
}

/** Exige que el usuario tenga uno de los roles indicados; si no, lo manda al dashboard. */
export async function requireRole(roles: Role[]) {
  const session = await requireSession();
  if (!roles.includes(session.user.role)) redirect("/dashboard");
  return session;
}

export const getCurrentUser = cache(async () => {
  const session = await getSession();
  if (!session?.user) return null;
  return prisma.user.findUnique({
    where: { id: session.user.id },
    include: { empresa: true },
  });
});

/**
 * Guard de las secciones de gestión de un diagnóstico (configurar, madurez,
 * brechas, riesgos, plan, roadmap, certificación, reportes, expediente).
 * El Responsable de Dominio solo responde su cuestionario: se le redirige
 * al resumen del diagnóstico.
 */
export async function requireAccesoSecciones(diagnosticoId: string) {
  const session = await requireSession();
  if (session.user.role === ROLES.RESPONSABLE_DOMINIO) redirect(`/diagnosticos/${diagnosticoId}`);
  return session;
}

/**
 * Guard de las secciones transversales de la plataforma (catálogo LPDP y empresas).
 *
 * No basta el rol: el catálogo de dominios y preguntas es uno solo para todos los
 * clientes, así que una cuenta de Procesos360 acotada a una empresa —la de
 * demostración— no puede editarlo aunque sea administradora.
 */
export async function requireAdminGlobal() {
  const session = await requireSession();
  // El rol se lee de la base y no del token: al ascender a alguien, su sesión abierta
  // sigue diciendo lo que decía al entrar, y tendría que cerrarla y volver para que le
  // tomara efecto. Justo lo que no queremos de un permiso que existe para cubrir una
  // ausencia. Es una consulta más, sobre una tabla que la portada ya consulta igual.
  const user = await getCurrentUser();
  if (!user || user.role !== ROLES.ADMIN_P360) redirect("/dashboard");
  if (session.user.empresaId) redirect("/dashboard");
  return session;
}

/** ¿El usuario pertenece al staff de Procesos360 (ve todas las empresas)? */
export function esStaffP360(role: Role): boolean {
  return ROLES_P360.includes(role);
}

type SesionMinima = { user: { role: Role; empresaId: string | null } };

/**
 * Filtro de empresa para listar diagnósticos.
 *
 * La regla es una sola: **quien tiene una empresa asignada ve esa y ninguna otra**, sea
 * del cliente o del staff. Eso permite acotar una cuenta de Procesos360 a un entorno de
 * demostración sin darle un rol distinto: conserva la vista de consultor, pero encerrada.
 *
 * El staff sin empresa asignada ve todas las empresas reales, y las de demostración
 * quedan fuera para que no se mezclen con el trabajo diario.
 */
export function empresaScope(session: SesionMinima) {
  if (session.user.empresaId) return { empresaId: session.user.empresaId };
  if (esStaffP360(session.user.role)) return { empresa: { esDemo: false } };
  return { empresaId: "__none__" };
}

/**
 * ¿Este usuario NO puede ver un recurso de esta empresa? Misma regla que empresaScope,
 * aplicada a un recurso concreto (un diagnóstico, una respuesta, una evidencia).
 *
 * Reemplaza el control que antes se repetía en doce lugares: tenerlo en uno solo evita
 * que al agregar una pantalla se olvide, y que las reglas se separen entre sí.
 */
export function sinAccesoAEmpresa(
  session: SesionMinima,
  empresaIdRecurso: string | null | undefined
): boolean {
  if (session.user.empresaId) return empresaIdRecurso !== session.user.empresaId;
  return !esStaffP360(session.user.role);
}

/**
 * ¿Esta persona lleva el control interno del levantamiento por parte del cliente?
 *
 * Se lee de la base y no del token de sesión a propósito: es un permiso que se otorga y
 * se quita en caliente, y si viviera en el JWT habría que pedirle a quien lo recibe que
 * cierre sesión y vuelva a entrar para que le tomara efecto.
 */
export const coordinaSeguimiento = cache(async (): Promise<boolean> => {
  const session = await getSession();
  if (!session?.user?.id) return false;
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { coordinaSeguimiento: true },
  });
  return u?.coordinaSeguimiento ?? false;
});

/**
 * ¿Esta persona revisa el levantamiento por parte del cliente?
 *
 * Se lee de la base por la misma razón que `coordinaSeguimiento`: es un permiso que se
 * otorga y se quita en caliente, y en el token obligaría a cerrar sesión para que tomara
 * efecto.
 */
export const revisaLevantamiento = cache(async (): Promise<boolean> => {
  const session = await getSession();
  if (!session?.user?.id) return false;
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { revisaLevantamiento: true },
  });
  return u?.revisaLevantamiento ?? false;
});

/**
 * ¿Puede revisar los dominios de este diagnóstico: validar, observar, cerrar y reabrir?
 *
 * Lo pueden el equipo consultor y la contraparte que revisa por parte del cliente, y en
 * los dos casos SOLO dentro de su empresa. El alcance por empresa no es un detalle: para
 * el staff de Procesos360 daba igual porque ve a todos sus clientes, pero desde que esto
 * lo puede tener alguien del cliente, es lo único que impide que revise el levantamiento
 * de otra empresa.
 */
export async function puedeRevisarDominios(
  empresaIdDiagnostico: string | null | undefined
): Promise<boolean> {
  const session = await getSession();
  if (!session?.user) return false;
  if (sinAccesoAEmpresa(session, empresaIdDiagnostico)) return false;
  if (esStaffP360(session.user.role)) return true;
  return revisaLevantamiento();
}

/**
 * ¿Puede ver el seguimiento de este diagnóstico (y por lo tanto recordarle a quien va
 * atrasado)? Lo pueden el equipo consultor y la contraparte que coordina en el cliente,
 * y en ambos casos solo dentro de la empresa que les corresponde.
 */
export async function puedeVerSeguimiento(
  empresaIdDiagnostico: string | null | undefined
): Promise<boolean> {
  const session = await getSession();
  if (!session?.user) return false;
  if (sinAccesoAEmpresa(session, empresaIdDiagnostico)) return false;
  if (esStaffP360(session.user.role)) return true;
  return coordinaSeguimiento();
}
