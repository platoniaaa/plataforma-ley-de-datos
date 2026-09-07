import { redirect } from "next/navigation";
import { requireSession, getCurrentUser } from "@/lib/session";
import { CONSENTIMIENTO_VERSION } from "@/lib/consentimiento";
import { ROLE_LABELS } from "@/lib/constants";
import { navForRole } from "@/lib/nav";
import { Sidebar } from "@/components/Sidebar";
import { ChatWidget } from "@/components/ChatWidget";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { Tour } from "@/components/Tour";
import { BotonTour } from "@/components/BotonTour";
import { pasosParaRol } from "@/lib/tour";
import { signOutAction } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const user = await getCurrentUser();

  // Gate bloqueante: sin consentimiento vigente no se accede a la plataforma.
  if (user && user.consentimientoVersion !== CONSENTIMIENTO_VERSION) {
    redirect("/consentimiento");
  }

  // El rol sale de la base, no del token: si a alguien se le amplía el acceso mientras
  // tiene la sesión abierta, el menú se lo tiene que mostrar sin obligarlo a volver a entrar.
  const rol = (user?.role as typeof session.user.role) ?? session.user.role;
  const items = navForRole(rol, session.user.empresaId);
  const iniciales = (user?.nombre ?? "U")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <Logo className="h-7" />
          <p className="mt-1 text-xs text-slate-400">LPDP · Ley 21.719</p>
        </div>

        <Sidebar items={items} />

        <div className="border-t border-slate-100 p-3">
          <div data-tour="usuario" className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand">
              {iniciales}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{user?.nombre}</p>
              <p className="truncate text-xs text-slate-400">{ROLE_LABELS[rol]}</p>
            </div>
          </div>
          <BotonTour />
          <form action={signOutAction}>
            <button
              type="submit"
              className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <Icon name="logout" className="h-5 w-5" />
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      {/* Contenido */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
      </main>

      <ChatWidget />
      <Tour pasos={pasosParaRol(rol)} activo={!user?.tourVisto} />
    </div>
  );
}
