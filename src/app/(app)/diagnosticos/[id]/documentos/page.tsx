import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccesoSecciones, esStaffP360, sinAccesoAEmpresa } from "@/lib/session";
import { coberturaDelDiagnostico, type CoberturaDominio } from "@/lib/data/cobertura";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui";
import { DiagnosticoNav } from "@/components/DiagnosticoNav";
import { CoberturaDocumental } from "@/components/CoberturaDocumental";
import { ClasificarEvidencia } from "./ClasificarEvidencia";

export const metadata = { title: "Documentos · Procesos360" };

function peso(bytes: number | null): string {
  if (!bytes) return "";
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/** El tipo de archivo importa: hoy solo PDF e imágenes son legibles de punta a punta. */
function formato(mime: string | null): string {
  if (!mime) return "archivo";
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return mime.replace("image/", "").toUpperCase();
  if (mime.includes("presentationml")) return "PPTX";
  if (mime.includes("wordprocessingml")) return "DOCX";
  if (mime.includes("spreadsheetml")) return "XLSX";
  return "archivo";
}

const COLOR_ESTADO: Record<string, "slate" | "green" | "orange" | "red" | "blue"> = {
  PENDIENTE: "slate",
  EN_REVISION: "blue",
  VALIDADA: "green",
  OBSERVADA: "orange",
  RECHAZADA: "red",
  VENCIDA: "orange",
};

export default async function DocumentosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAccesoSecciones(id);

  const diag = await prisma.diagnostico.findUnique({
    where: { id },
    select: { id: true, nombre: true, empresaId: true, empresa: { select: { razonSocial: true } } },
  });
  if (!diag) notFound();
  if (sinAccesoAEmpresa(session, diag.empresaId)) notFound();

  const cob = await coberturaDelDiagnostico(id);
  if (!cob) notFound();
  const puedeClasificar = esStaffP360(session.user.role);

  return (
    <>
      <DiagnosticoNav id={id} active="documentos" />
      <PageHeader
        title="Cobertura documental"
        subtitle={`${diag.empresa.razonSocial} · qué documentación llegó, qué falta y a quién pedírsela`}
      />

      <div className="mb-6">
        <CoberturaDocumental datos={cob} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi label="Documentos cargados" valor={cob.totalDocumentos} />
        <Kpi
          label="Bloquean el cierre"
          valor={cob.totalObligatoriasFaltantes}
          alerta={cob.totalObligatoriasFaltantes > 0}
        />
        <Kpi
          label="Sin clasificar"
          valor={cob.totalSinClasificar}
          alerta={cob.totalSinClasificar > 0}
        />
        <Kpi label="Repetidos" valor={cob.totalRepetidos} />
        <Kpi
          label="Dominios sin nada"
          valor={cob.dominiosSinDocumentos}
          alerta={cob.dominiosSinDocumentos > 0}
        />
      </div>

      {/* Las tres listas miden cosas distintas y confundirlas lleva a discutir números
          que no son comparables. Se dice de entrada cuál es cuál. */}
      <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <p className="mb-1 font-medium text-slate-700">Cómo leer esta página</p>
        <p>
          <strong>Bloquean el cierre</strong> es la exigencia dura: alguien afirmó que un
          control existe (3, 4 o 5) en una pregunta que pide respaldo, y el documento no está.
          Hasta que llegue, ese dominio no se puede enviar a validación.
        </p>
        <p className="mt-1">
          <strong>Evidencias mínimas</strong> es la vara del estándar para cada dominio —{" "}
          {cob.totalEsperadas} documentos en total. Un documento cuenta como cobertura recién
          cuando alguien declara cuál de ellas cubre; por eso hay {cob.totalSinClasificar} sin
          clasificar.
        </p>
        <p className="mt-1">
          <strong>Solicitado en el levantamiento</strong> son los {cob.checklistTotal} documentos
          que se le pidieron por nombre al cliente al parametrizar el diagnóstico. Es una lista de
          referencia para saber qué reclamar: subir un archivo no tacha uno de esos ítems, porque
          cada carga se registra contra la pregunta que respalda.
        </p>
      </div>

      {cob.dominios.map((d) => (
        <DominioCard key={d.orden} d={d} diagId={id} puedeClasificar={puedeClasificar} />
      ))}
    </>
  );
}

function DominioCard({
  d,
  diagId,
  puedeClasificar,
}: {
  d: CoberturaDominio;
  diagId: string;
  puedeClasificar: boolean;
}) {
  const responsables = d.participantes.filter((p) => p.responsableEvidencia);
  const aQuienPedir = (responsables.length > 0 ? responsables : d.participantes)
    .map((p) => p.nombre)
    .join(", ");
  const cobertura = d.esperadas.length
    ? Math.round((d.cubiertas.length / d.esperadas.length) * 100)
    : 0;

  return (
    <Card className="mb-5">
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>
              {d.orden}. {d.nombre}
            </CardTitle>
            {d.cerrado && <Badge color="green">Cerrado</Badge>}
            {d.faltantesObligatorias.length > 0 && (
              <Badge color="red">
                {d.faltantesObligatorias.length}{" "}
                {d.faltantesObligatorias.length === 1 ? "bloqueante" : "bloqueantes"}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            {d.documentos.length} {d.documentos.length === 1 ? "documento" : "documentos"} ·{" "}
            {d.cubiertas.length} de {d.esperadas.length} evidencias mínimas cubiertas ({cobertura}%)
            {aQuienPedir && ` · a cargo: ${aQuienPedir}`}
          </p>
        </div>
        <Link
          href={`/diagnosticos/${diagId}/dominios/${d.orden}`}
          className="shrink-0 text-sm font-medium text-brand-600 hover:underline"
        >
          Ir al dominio →
        </Link>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ── Lo que bloquea ── */}
        {d.faltantesObligatorias.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-red-700">
              Falta el respaldo obligatorio
            </p>
            <ul className="space-y-1">
              {d.faltantesObligatorias.map((f) => (
                <li key={f.preguntaOrden} className="text-sm text-red-800">
                  <span className="font-medium">P{f.preguntaOrden}</span>{" "}
                  <span className="text-red-600">(respondida {f.valor})</span> —{" "}
                  {f.preguntaTexto.slice(0, 110)}
                  {f.preguntaTexto.length > 110 ? "…" : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Lo que llegó ── */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Documentos cargados
          </p>
          {d.documentos.length === 0 ? (
            <p className="text-sm text-slate-400">
              Todavía no se ha cargado ningún documento en este dominio.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {d.documentos.map((doc) => (
                <li key={doc.id} className="px-3 py-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-800">{doc.nombre}</span>
                        <Badge color={COLOR_ESTADO[doc.estado] ?? "slate"}>{doc.estado}</Badge>
                        {doc.repetido && <Badge color="yellow">Repetido</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {formato(doc.mimeType)} · {peso(doc.tamano)}
                        {doc.preguntaOrden != null && ` · pregunta ${doc.preguntaOrden}`}
                        {doc.subidoPor && ` · subió ${doc.subidoPor}`}
                      </p>
                      {puedeClasificar ? (
                        <ClasificarEvidencia
                          evidenciaId={doc.id}
                          actual={doc.cubreEvidencia}
                          opciones={d.esperadas}
                          yaUsadas={d.cubiertas}
                        />
                      ) : (
                        <p className="mt-1 text-xs text-slate-500">
                          {doc.cubreEvidencia
                            ? `Cubre: ${doc.cubreEvidencia}`
                            : "Sin clasificar todavía."}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Lo que el estándar espera ── */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Evidencias mínimas del dominio
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {d.esperadas.map((e) => {
              const cubierta = d.cubiertas.includes(e);
              return (
                <li
                  key={e}
                  className={`rounded-full px-2.5 py-1 text-xs ${
                    cubierta
                      ? "bg-green-50 font-medium text-green-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {cubierta && "✓ "}
                  {e}
                </li>
              );
            })}
          </ul>
        </div>

        {/* ── Lo que se pidió al cliente ── */}
        {d.checklist.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              Solicitado en el levantamiento
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {d.checklist.map((c) => (
                <li
                  key={c.id}
                  className={`rounded-full px-2.5 py-1 text-xs ${
                    c.tieneArchivo
                      ? "bg-green-50 font-medium text-green-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {c.tieneArchivo && "✓ "}
                  {c.nombre}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, valor, alerta }: { label: string; valor: number; alerta?: boolean }) {
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
