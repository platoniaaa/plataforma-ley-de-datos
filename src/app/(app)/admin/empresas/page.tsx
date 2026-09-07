import { requireAdminGlobal } from "@/lib/session";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { EmpresasAdmin } from "./EmpresasAdmin";

export default async function AdminEmpresasPage() {
  await requireAdminGlobal();
  const empresas = await prisma.empresa.findMany({
    include: { _count: { select: { diagnosticos: true, usuarios: true } } },
    orderBy: { razonSocial: "asc" },
  });

  return (
    <>
      <PageHeader title="Empresas" subtitle="Clientes registrados en la plataforma" />
      <EmpresasAdmin
        empresas={empresas.map((e) => ({
          id: e.id,
          razonSocial: e.razonSocial,
          rut: e.rut,
          industria: e.industria,
          activa: e.activa,
          diagnosticos: e._count.diagnosticos,
          usuarios: e._count.usuarios,
        }))}
      />
    </>
  );
}
