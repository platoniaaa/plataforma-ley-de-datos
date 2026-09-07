import { requireAccesoSecciones } from "@/lib/session";
import { ROLES_P360 } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { getDiagnosticoFull } from "@/lib/data/diagnosticos";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui";
import { DiagnosticoNav } from "@/components/DiagnosticoNav";
import { ConfigurarForm } from "./ConfigurarForm";
import { EquipoConsultor } from "./EquipoConsultor";

export default async function ConfigurarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAccesoSecciones(id);
  const diag = await getDiagnosticoFull(id, session); // valida acceso

  const [usuarios, areas, consultores, equipo] = await Promise.all([
    prisma.user.findMany({
      where: { empresaId: diag.empresaId, activo: true },
      select: { id: true, nombre: true, cargo: true },
      orderBy: { nombre: "asc" },
    }),
    prisma.area.findMany({
      where: { empresaId: diag.empresaId },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    }),
    // Solo staff sin empresa asignada: una cuenta acotada al entorno de demostración no
    // puede figurar como responsable del trabajo de un cliente real.
    prisma.user.findMany({
      where: { role: { in: ROLES_P360 }, empresaId: null, activo: true },
      select: { id: true, nombre: true, cargo: true },
      orderBy: { nombre: "asc" },
    }),
    prisma.consultorDiagnostico.findMany({
      where: { diagnosticoId: id },
      select: { userId: true },
    }),
  ]);

  const dominios = diag.dominios.map((d) => ({
    ddId: d.id,
    orden: d.dominio.orden,
    nombre: d.dominio.nombre,
    incluido: d.incluido,
    participantesIds: d.participantes.map((p) => p.userId),
    responsablesEvidenciaIds: d.participantes.filter((p) => p.responsableEvidencia).map((p) => p.userId),
    areaId: d.area?.id ?? "",
    justificacionNoAplica: d.justificacionNoAplica ?? "",
  }));

  return (
    <>
      <DiagnosticoNav id={id} active="configurar" />
      <PageHeader
        title="Configurar diagnóstico"
        subtitle={`${diag.nombre} · selecciona dominios, participantes y áreas`}
      />
      <EquipoConsultor
        diagnosticoId={id}
        consultores={consultores}
        liderInicial={diag.consultor?.id ?? ""}
        equipoInicial={equipo.map((e) => e.userId)}
      />
      <ConfigurarForm
        diagnosticoId={id}
        dominios={dominios}
        usuarios={usuarios}
        areas={areas}
      />
      {usuarios.length === 0 && (
        <Card className="mt-4">
          <CardContent className="py-4 text-sm text-slate-500">
            Aún no hay usuarios en esta empresa. Créalos en “Mi Empresa”.
          </CardContent>
        </Card>
      )}
    </>
  );
}
