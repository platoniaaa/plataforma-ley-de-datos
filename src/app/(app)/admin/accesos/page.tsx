import { requireAdminGlobal } from "@/lib/session";
import { correoConfigurado } from "@/lib/email";
import { accesosPorEmpresa } from "@/lib/data/accesos";
import { PageHeader } from "@/components/PageHeader";
import { AccesosAdmin } from "./AccesosAdmin";

export const metadata = { title: "Accesos · Procesos360" };

export default async function AccesosPage() {
  await requireAdminGlobal();
  const empresas = await accesosPorEmpresa();
  const sinEntrar = empresas.reduce(
    (n, e) => n + e.usuarios.filter((u) => u.activo && u.estado !== "ACTIVO").length,
    0
  );

  return (
    <>
      <PageHeader
        title="Accesos a la plataforma"
        subtitle={
          sinEntrar === 0
            ? "Todas las cuentas activas ya entraron al menos una vez."
            : `${sinEntrar} ${sinEntrar === 1 ? "persona todavía no logra entrar" : "personas todavía no logran entrar"}`
        }
      />

      {!correoConfigurado() && (
        <div className="mb-5 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          El envío de correo no está configurado en el servidor: los botones de esta página
          no funcionarán hasta que se definan <code>RESEND_API_KEY</code> y <code>EMAIL_FROM</code>.
        </div>
      )}

      {/* La contraseña original no se puede reenviar: en la base solo vive su hash. Decirlo
          aquí evita que alguien busque un botón de "reenviar credenciales" que no existe. */}
      <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <p className="mb-1 font-medium text-slate-700">Dos formas de entregar el acceso</p>
        <p>
          <strong>Enlace de activación</strong> — la persona define su propia contraseña. Es el
          camino recomendado: la clave no viaja por correo ni queda archivada en una bandeja de
          entrada, y los filtros corporativos no lo leen como phishing. El enlace sirve una sola
          vez y vence en 7 días.
        </p>
        <p className="mt-1">
          <strong>Contraseña nueva</strong> — se genera una y se manda escrita. Úsalo cuando la
          persona no logre usar el enlace. Ojo: es un reemplazo, no un reenvío. La contraseña que
          tuviera deja de servir, porque la original no se puede recuperar.
        </p>
      </div>

      <AccesosAdmin empresas={empresas} />
    </>
  );
}
