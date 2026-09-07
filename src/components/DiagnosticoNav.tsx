import Link from "next/link";
import { cn } from "@/lib/utils";
import { ROLES } from "@/lib/constants";
import { getSession, esStaffP360, coordinaSeguimiento } from "@/lib/session";

// Sub-navegación horizontal para las secciones de un diagnóstico.
// El viaje del Documento Funcional Base: resumen → config → cuestionario → motores → reportes.
//
// El rol se lee de la sesión y no se recibe por props: son once páginas las que montan
// esta barra, y basta que una olvide pasarlo para que aparezca una pestaña que quien
// mira no debería ver.

const TABS: { key: string; suffix: string; label: string; control?: boolean }[] = [
  { key: "resumen", suffix: "", label: "Resumen" },
  { key: "configurar", suffix: "/configurar", label: "Configurar" },
  // Seguimiento expone el detalle de quién va atrasado y permite escribirles: la ven el
  // equipo consultor y la contraparte que coordina el levantamiento dentro del cliente.
  { key: "seguimiento", suffix: "/seguimiento", label: "Seguimiento", control: true },
  { key: "documentos", suffix: "/documentos", label: "Documentos" },
  // El RAT es de la empresa y sobrevive al diagnóstico, pero se trabaja desde aquí: es
  // donde el levantamiento descubre qué áreas tratan datos.
  { key: "rat", suffix: "/rat", label: "RAT" },
  { key: "madurez", suffix: "/madurez", label: "Madurez" },
  { key: "brechas", suffix: "/brechas", label: "Brechas" },
  { key: "riesgos", suffix: "/riesgos", label: "Riesgos" },
  { key: "plan", suffix: "/plan", label: "Plan" },
  { key: "roadmap", suffix: "/roadmap", label: "Roadmap" },
  { key: "certificacion", suffix: "/certificacion", label: "Certificación" },
  { key: "reporte", suffix: "/reporte", label: "Reporte" },
  { key: "reporte-tecnico", suffix: "/reporte-tecnico", label: "Técnico" },
  { key: "expediente", suffix: "/expediente", label: "Expediente" },
];

export async function DiagnosticoNav({ id, active }: { id: string; active: string }) {
  const session = await getSession();
  const role = session?.user?.role;
  if (!role) return null;

  const staff = esStaffP360(role);
  const coordina = !staff && (await coordinaSeguimiento());
  // El Responsable de Dominio solo responde su cuestionario: no ve las pestañas de gestión.
  if (role === ROLES.RESPONSABLE_DOMINIO && !coordina) return null;

  const tabs = TABS.filter((t) => {
    if (t.control) return staff || coordina;
    // Coordinar el levantamiento no es gestionarlo: quien lleva el control desde el
    // cliente suma la pestaña de seguimiento a lo que ya veía, y nada más.
    if (role === ROLES.RESPONSABLE_DOMINIO) return t.key === "resumen";
    return true;
  });

  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 pb-px print:hidden">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`/diagnosticos/${id}${t.suffix}`}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
