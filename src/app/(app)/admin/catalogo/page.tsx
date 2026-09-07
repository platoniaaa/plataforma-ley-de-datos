import { requireAdminGlobal } from "@/lib/session";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { CatalogoAdmin } from "./CatalogoAdmin";

export default async function CatalogoPage() {
  await requireAdminGlobal();
  const dominios = await prisma.dominio.findMany({
    include: { preguntas: { orderBy: { orden: "asc" } } },
    orderBy: { orden: "asc" },
  });
  const totalPreguntas = dominios.reduce((a, d) => a + d.preguntas.length, 0);

  return (
    <>
      <PageHeader
        title="Catálogo LPDP"
        subtitle={`${dominios.length} dominios · ${totalPreguntas} preguntas · Ley N° 21.719`}
      />
      <CatalogoAdmin
        dominios={dominios.map((d) => ({
          id: d.id,
          orden: d.orden,
          nombre: d.nombre,
          objetivo: d.objetivo,
          preguntas: d.preguntas.map((p) => ({
            id: p.id,
            orden: p.orden,
            texto: p.texto,
            descripcion: p.descripcion,
            evidenciaObligatoria: p.evidenciaObligatoria,
          })),
        }))}
      />
    </>
  );
}
