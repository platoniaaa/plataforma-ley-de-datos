import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccesoSecciones, sinAccesoAEmpresa, esStaffP360 } from "@/lib/session";
import { ratDeEmpresa } from "@/lib/data/rat";
import { CAMPOS_RAT, faltantesDe } from "@/lib/rat";
import { ROLES } from "@/lib/constants";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { DiagnosticoNav } from "@/components/DiagnosticoNav";
import { RatEditor } from "./RatEditor";
import { PropuestaRat } from "./PropuestaRat";
import { FichasProceso } from "./FichasProceso";

export const metadata = { title: "RAT · Procesos360" };

// Leer varios PDF y consultar el modelo pasa de los quince segundos por defecto.
export const maxDuration = 120;

export default async function RatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAccesoSecciones(id);

  const diag = await prisma.diagnostico.findUnique({
    where: { id },
    select: { empresaId: true },
  });
  if (!diag) notFound();
  if (sinAccesoAEmpresa(session, diag.empresaId)) notFound();

  const [rat, areas, fichasRaw] = await Promise.all([
    ratDeEmpresa(diag.empresaId),
    prisma.area.findMany({
      where: { empresaId: diag.empresaId },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    }),
    prisma.fichaProceso.findMany({
      where: { empresaId: diag.empresaId },
      select: {
        id: true,
        nombre: true,
        descripcion: true,
        mimeType: true,
        tamano: true,
        subidoPorId: true,
        createdAt: true,
        area: { select: { nombre: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  if (!rat) notFound();

  const puedeEditar = session.user.role !== ROLES.RESPONSABLE_DOMINIO;
  const esConsultor = esStaffP360(session.user.role);

  // Quién subió cada ficha, en una consulta y no una por fila.
  const autores = new Map<string, string>();
  const idsAutores = [...new Set(fichasRaw.map((f) => f.subidoPorId).filter(Boolean))] as string[];
  if (idsAutores.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: idsAutores } },
      select: { id: true, nombre: true },
    });
    for (const u of users) autores.set(u.id, u.nombre);
  }
  const fichas = fichasRaw.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    descripcion: f.descripcion,
    areaNombre: f.area?.nombre ?? null,
    mimeType: f.mimeType,
    tamano: f.tamano,
    subidoPor: f.subidoPorId ? (autores.get(f.subidoPorId) ?? null) : null,
    createdAt: f.createdAt.toLocaleDateString("es-CL", { day: "numeric", month: "short" }),
  }));
  const obligatorios = CAMPOS_RAT.filter((c) => c.obligatorio);
  const faltantesTotales = rat.tratamientos.reduce((n, t) => n + faltantesDe(t).length, 0);

  return (
    <>
      <DiagnosticoNav id={id} active="rat" />
      <PageHeader
        title="Registro de Actividades de Tratamiento"
        subtitle={`${rat.empresa} · el registro que la Ley 21.719 obliga a mantener`}
      />

      {/* ── Estado del registro ── */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Kpi label="Actividades registradas" valor={rat.tratamientos.length} />
        <Kpi
          label="Completas"
          valor={`${rat.completos}/${rat.tratamientos.length}`}
          alerta={rat.completos < rat.tratamientos.length}
        />
        <Kpi label="Campos por llenar" valor={faltantesTotales} alerta={faltantesTotales > 0} />
        <Kpi label="Con datos sensibles" valor={rat.conSensibles} />
        <Kpi
          label="Datos en el inventario"
          valor={rat.datosInventariados}
          alerta={rat.datosInventariados === 0}
        />
        <Kpi
          label="Áreas sin actividad"
          valor={`${rat.areasSinTratamiento.length}/${rat.areasQueTratanDatos}`}
          alerta={rat.areasSinTratamiento.length > 0}
        />
      </div>

      {/* ── Requisitos: qué hay que reunir ── */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Qué exige el registro</CardTitle>
          <p className="mt-0.5 text-sm text-slate-500">
            Por <strong>cada</strong> actividad de tratamiento. Los marcados con{" "}
            <span className="text-red-600">*</span> son los que no pueden faltar: sin ellos la
            actividad no queda documentada. Bajo cada campo va{" "}
            <strong>qué documento lo acredita</strong>, que es lo que hay que pedirle al área
            cuando responda “sí, eso lo hacemos”.
          </p>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
            {CAMPOS_RAT.map((c) => (
              <li key={c.clave} className="text-sm">
                <span className="font-medium text-slate-800">{c.etiqueta}</span>
                {c.obligatorio && <span className="ml-1 text-red-600">*</span>}
                <p className="text-slate-600">{c.ayuda}</p>
                <p className="mt-0.5 text-xs italic text-slate-400">Ej: {c.ejemplo}</p>
                {c.evidencia && (
                  <p className="mt-1 text-xs text-slate-500">
                    <span className="font-medium">Lo acredita:</span> {c.evidencia}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            Son {obligatorios.length} campos obligatorios por actividad: los que la Ley 21.719
            exige por cada tratamiento. El resto ordena el trabajo —quién valida la fila, con qué
            datos del inventario se cruza, qué evidencia hay que pedir— y no cuenta como
            pendiente. Los países de destino y sus garantías aparecen solo cuando la actividad
            declara que los datos salen del país.
          </p>
        </CardContent>
      </Card>

      {/* ── Áreas que declararon tratar datos y aún no aparecen ── */}
      {rat.areasSinTratamiento.length > 0 && (
        <Card className="mb-6 border-orange-200">
          <CardHeader>
            <CardTitle>Áreas que tratan datos y no están en el registro</CardTitle>
            <p className="mt-0.5 text-sm text-slate-500">
              Lo declararon en el levantamiento. Mientras no tengan al menos una actividad, el
              registro está incompleto.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-1.5">
              {rat.areasSinTratamiento.map((a) => (
                <li
                  key={a.id}
                  className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700"
                >
                  {a.nombre}
                  {a.sensibles && " · sensibles"}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── El registro preliminar, editable ── */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-700">Registro preliminar</h2>
        <a
          href={`/diagnosticos/${id}/rat/descargar`}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-brand-600 hover:text-brand-600"
        >
          Descargar la matriz (Excel)
        </a>
      </div>

      {/* Las fichas van antes de la propuesta: son el insumo que la mejora, y verlas
          primero explica por qué el análisis encuentra más cuando hay trabajo de campo. */}
      {esConsultor && (
        <FichasProceso empresaId={diag.empresaId} fichas={fichas} areas={areas} />
      )}

      {puedeEditar && (
        <PropuestaRat
          diagnosticoId={id}
          empresaId={diag.empresaId}
          yaRegistradas={rat.tratamientos.map((t) => t.nombre)}
        />
      )}

      <RatEditor
        empresaId={diag.empresaId}
        tratamientos={rat.tratamientos}
        areas={areas}
        puedeEditar={puedeEditar}
      />

      <p className="mt-6 rounded-lg bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-500">
        Este registro se marca como <strong>preliminar</strong> mientras haya actividades en
        borrador o campos obligatorios sin llenar. Lo que el análisis propone sale del material
        que el propio cliente entregó y llega con la cita a la vista; lo que el material no dice
        queda vacío a propósito y se pregunta. Ningún campo se escribe por deducción, porque el
        registro sirve después como prueba y una deducción no se puede acreditar.
      </p>
    </>
  );
}

function Kpi({
  label,
  valor,
  alerta,
}: {
  label: string;
  valor: string | number;
  alerta?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold tabular-nums ${
          alerta ? "text-orange-600" : "text-slate-900"
        }`}
      >
        {valor}
      </p>
    </div>
  );
}
