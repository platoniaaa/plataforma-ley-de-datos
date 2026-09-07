import type { Role } from "@/lib/constants";
import { ROLES } from "@/lib/constants";

export type NavItem = {
  href: string;
  label: string;
  icon: string; // clave de icono (ver components/Icon)
  roles: Role[];
  tour: string; // ancla del tutorial inicial (data-tour)
};

const ALL: Role[] = [
  ROLES.ADMIN_P360,
  ROLES.CONSULTOR,
  ROLES.ADMIN_EMPRESA,
  ROLES.RESPONSABLE_DOMINIO,
  ROLES.ALTA_DIRECCION,
];

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "grid", roles: ALL, tour: "nav-dashboard" },
  {
    href: "/diagnosticos",
    label: "Diagnósticos",
    icon: "clipboard",
    roles: [ROLES.ADMIN_P360, ROLES.CONSULTOR, ROLES.ADMIN_EMPRESA, ROLES.RESPONSABLE_DOMINIO],
    tour: "nav-diagnosticos",
  },
  {
    href: "/empresa",
    label: "Mi Empresa",
    icon: "building",
    roles: [ROLES.ADMIN_EMPRESA],
    tour: "nav-empresa",
  },
  {
    href: "/admin/empresas",
    label: "Empresas",
    icon: "building",
    roles: [ROLES.ADMIN_P360],
    tour: "nav-empresas",
  },
  {
    href: "/admin/accesos",
    label: "Accesos",
    icon: "users",
    roles: [ROLES.ADMIN_P360],
    tour: "nav-accesos",
  },
  {
    href: "/admin/catalogo",
    label: "Catálogo LPDP",
    icon: "book",
    roles: [ROLES.ADMIN_P360],
    tour: "nav-catalogo",
  },
];

/**
 * Menú de una sesión. `empresaId` importa porque "Empresas" y "Catálogo LPDP" no son de
 * un cliente sino de la plataforma entera: una cuenta de Procesos360 acotada a una
 * empresa —la de demostración, por ejemplo— no debe ver ni tocar lo que es de todos.
 */
export function navForRole(role: Role, empresaId?: string | null): NavItem[] {
  return NAV_ITEMS.filter((i) => {
    if (!i.roles.includes(role)) return false;
    if (i.href.startsWith("/admin/") && empresaId) return false;
    return true;
  });
}
