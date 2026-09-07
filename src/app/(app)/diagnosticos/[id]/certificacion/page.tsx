import { requireAccesoSecciones } from "@/lib/session";
import { getDiagnosticoFull, madurezDeDiagnostico, getPreparacionInput } from "@/lib/data/diagnosticos";
import { calcularPreparacion } from "@/lib/engines/certificacion";
import { ESTADO_PREPARACION } from "@/lib/constants";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { DiagnosticoNav } from "@/components/DiagnosticoNav";
import { PreparacionBadge } from "@/components/badges";

export default async function CertificacionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAccesoSecciones(id);
  const diag = await getDiagnosticoFull(id, session); // valida acceso
  const madurez = madurezDeDiagnostico(diag);
  const input = await getPreparacionInput(id, diag, madurez.global);
  const prep = calcularPreparacion(input);
  const meta = ESTADO_PREPARACION[prep.estado];

  return (
    <>
      <DiagnosticoNav id={id} active="certificacion" />
      <PageHeader
        title="Preparación para Certificación"
        subtitle={`${diag.nombre} · readiness frente a auditoría o fiscalización`}
      />

      {prep.estado === "DATOS_INSUFICIENTES" && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>Índice preliminar.</strong> Solo se ha respondido el {prep.cobertura}% del
          levantamiento (se necesita ≥ 80% para una lectura representativa). Las brechas, riesgos y
          plan de tratamiento aún no se han evaluado, así que este índice todavía no refleja la
          preparación real.
        </div>
      )}

      <div className="mb-6 grid gap-6 md:grid-cols-[280px_1fr]">
        {/* Índice */}
        <Card>
          <CardContent className="flex flex-col items-center py-8">
            <div
              className="flex h-40 w-40 items-center justify-center rounded-full border-8"
              style={{ borderColor: meta.color }}
            >
              <span className="text-4xl font-bold" style={{ color: meta.color }}>
                {prep.indice}
              </span>
            </div>
            <p className="mt-4 text-xs uppercase tracking-wide text-slate-400">Índice de preparación</p>
            <div className="mt-2">
              <PreparacionBadge estado={prep.estado} />
            </div>
            <p className="mt-2 text-center text-xs text-slate-500">{meta.descripcion}</p>
          </CardContent>
        </Card>

        {/* Factores */}
        <Card>
          <CardHeader>
            <CardTitle>Factores del índice (doc §14.2)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {prep.factores.map((f) => (
              <div key={f.label}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-slate-600">
                    {f.label} <span className="text-xs text-slate-400">(peso {Math.round(f.peso * 100)}%)</span>
                  </span>
                  <span className="font-semibold text-slate-800">{f.valor}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-brand-600" style={{ width: `${f.valor}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Detalle de insumos */}
      <Card>
        <CardHeader>
          <CardTitle>Insumos considerados</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
            <Dato k="Cobertura del levantamiento" v={`${prep.cobertura}%`} alerta={!prep.confiable} />
            <Dato k="Madurez global" v={input.madurezGlobal != null ? input.madurezGlobal.toFixed(2) : "—"} />
            <Dato k="Brechas críticas abiertas" v={input.brechasCriticasAbiertas} alerta={input.brechasCriticasAbiertas > 0} />
            <Dato k="Riesgos críticos" v={input.riesgosCriticosAbiertos} alerta={input.riesgosCriticosAbiertos > 0} />
            <Dato k="Evidencias validadas" v={`${input.evidenciasValidadas}/${input.evidenciasRequeridas}`} />
            <Dato k="Plan ejecutado" v={`${input.planCerradas}/${input.planTotal}`} />
          </dl>
          {input.brechasCriticasAbiertas > 0 && (
            <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              Con brechas críticas abiertas, el estado es <strong>No preparado</strong> (doc §14.3), sin importar el índice.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Dato({ k, v, alerta }: { k: string; v: string | number; alerta?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{k}</dt>
      <dd className={`text-lg font-semibold ${alerta ? "text-red-600" : "text-slate-800"}`}>{v}</dd>
    </div>
  );
}
