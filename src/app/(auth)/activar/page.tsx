import Link from "next/link";
import { prisma } from "@/lib/db";
import { Logo } from "@/components/Logo";
import { ActivarForm } from "./ActivarForm";

export const metadata = { title: "Activar cuenta · Procesos360" };

export default async function ActivarPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  const user = token
    ? await prisma.user.findUnique({
        where: { tokenActivacion: token },
        select: { nombre: true, email: true, tokenExpira: true, activo: true },
      })
    : null;

  const valido = Boolean(user && user.activo && (!user.tokenExpira || user.tokenExpira > new Date()));

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 to-blue-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Logo className="mx-auto mb-3 h-11" />
          <p className="text-sm font-semibold text-slate-500">LPDP · Ley N° 21.719</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          {valido && user ? (
            <>
              <h1 className="text-lg font-semibold text-slate-900">Hola {user.nombre.split(" ")[0]}</h1>
              <p className="mt-1 text-sm text-slate-500">
                Define la contraseña con la que entrarás a la plataforma. Tu usuario es{" "}
                <span className="font-medium text-slate-700">{user.email}</span>.
              </p>
              <div className="mt-6">
                <ActivarForm token={token!} />
              </div>
            </>
          ) : (
            <div className="text-center">
              <h1 className="text-lg font-semibold text-slate-900">Este enlace no sirve</h1>
              <p className="mt-2 text-sm text-slate-500">
                {token
                  ? "Puede que ya lo hayas usado o que haya expirado. Los enlaces de activación duran 7 días y se pueden usar una sola vez."
                  : "El enlace está incompleto. Ábrelo directamente desde el correo que recibiste."}
              </p>
              <p className="mt-4 text-sm text-slate-500">
                Escribe a{" "}
                <a
                  href="mailto:francisco.guajardo@procesos360.cl"
                  className="font-medium text-brand-600 hover:underline"
                >
                  francisco.guajardo@procesos360.cl
                </a>{" "}
                y te enviamos uno nuevo.
              </p>
              <Link href="/login" className="mt-5 inline-flex text-sm text-brand-600 hover:underline">
                Ya tengo mi contraseña, quiero ingresar
              </Link>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">Procesos360 © 2026</p>
      </div>
    </div>
  );
}
