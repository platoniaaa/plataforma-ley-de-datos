"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select } from "@/components/ui";
import { EstadoEvidenciaBadge } from "@/components/badges";
import { TIPO_DOCUMENTAL, ESTADO_EVIDENCIA } from "@/lib/constants";
import {
  prepararSubidaEvidenciaAction,
  registrarEvidenciaAction,
  validarEvidenciaAction,
  eliminarEvidenciaAction,
  descargarEvidenciaAction,
} from "./evidencia-actions";
import { MAX_EVIDENCIA_MB, MAX_EVIDENCIA_BYTES } from "@/lib/constants";

function formatearMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type EvidenciaVM = {
  id: string;
  nombre: string;
  tipoDocumental: string | null;
  estado: string;
  archivoPath: string | null;
  observaciones: string | null;
};

export function EvidenciasPregunta({
  respuestaId,
  evidencias,
  puedeValidar,
}: {
  respuestaId: string;
  evidencias: EvidenciaVM[];
  puedeValidar: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [abrir, setAbrir] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    const nombre = String(fd.get("nombre") ?? "").trim();
    const tipoDocumental = String(fd.get("tipoDocumental") ?? "").trim() || null;
    const vigencia = String(fd.get("vigencia") ?? "").trim() || null;
    const archivo = fd.get("file");
    const tieneArchivo = archivo instanceof File && archivo.size > 0;

    if (!nombre) {
      setMsg("El nombre del documento es obligatorio.");
      return;
    }
    if (tieneArchivo && archivo.size > MAX_EVIDENCIA_BYTES) {
      setMsg(
        `El archivo pesa ${formatearMB(archivo.size)} y el máximo son ${MAX_EVIDENCIA_MB} MB.`
      );
      return;
    }

    startTransition(async () => {
      let archivoPath: string | null = null;
      let mimeType: string | null = null;
      let tamano: number | null = null;

      // El archivo va del navegador directo a Storage con una URL firmada: así no
      // pasa por el servidor, que rechaza los envíos grandes.
      if (tieneArchivo) {
        setMsg(`Subiendo ${formatearMB(archivo.size)}…`);
        const prep = await prepararSubidaEvidenciaAction(respuestaId, archivo.name, archivo.size);
        if (!prep.ok || !prep.signedUrl) {
          setMsg(prep.error ?? "No se pudo preparar la subida.");
          return;
        }
        try {
          const r = await fetch(prep.signedUrl, {
            method: "PUT",
            body: archivo,
            headers: { "content-type": archivo.type || "application/octet-stream" },
          });
          if (!r.ok) throw new Error(`el servidor de archivos respondió ${r.status}`);
        } catch (err) {
          setMsg(`No se pudo subir el archivo: ${(err as Error).message}`);
          return;
        }
        archivoPath = prep.path ?? null;
        mimeType = archivo.type || null;
        tamano = archivo.size;
      }

      const res = await registrarEvidenciaAction({
        respuestaId,
        nombre,
        tipoDocumental,
        vigencia,
        archivoPath,
        mimeType,
        tamano,
      });
      if (res.ok) {
        setMsg(null);
        formRef.current?.reset();
        setAbrir(false);
        router.refresh();
      } else setMsg(res.error ?? "Error");
    });
  }

  function validar(id: string, estado: keyof typeof ESTADO_EVIDENCIA) {
    startTransition(async () => {
      const res = await validarEvidenciaAction(id, estado);
      if (res.ok) router.refresh();
      else setMsg(res.error ?? "Error");
    });
  }

  function eliminar(id: string) {
    startTransition(async () => {
      const res = await eliminarEvidenciaAction(id);
      if (res.ok) router.refresh();
      else setMsg(res.error ?? "Error");
    });
  }

  async function descargar(id: string) {
    const res = await descargarEvidenciaAction(id);
    if (res.ok && res.url) window.open(res.url, "_blank");
    else setMsg(res.error ?? "Sin archivo");
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Evidencias ({evidencias.length})
        </span>
        <Button size="sm" variant="ghost" onClick={() => setAbrir((v) => !v)}>
          {abrir ? "Cerrar" : "+ Adjuntar"}
        </Button>
      </div>

      {evidencias.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-200">
          {evidencias.map((ev) => (
            <li key={ev.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-800">{ev.nombre}</p>
                <p className="text-xs text-slate-400">
                  {ev.tipoDocumental ?? "Documento"}
                  {ev.observaciones ? ` · ${ev.observaciones}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <EstadoEvidenciaBadge estado={ev.estado} />
                {ev.archivoPath && (
                  <Button size="sm" variant="secondary" onClick={() => descargar(ev.id)}>
                    Ver
                  </Button>
                )}
                {puedeValidar && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => validar(ev.id, "VALIDADA")} disabled={pending}>
                      Validar
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => validar(ev.id, "OBSERVADA")} disabled={pending}>
                      Observar
                    </Button>
                  </>
                )}
                <Button size="sm" variant="danger" onClick={() => eliminar(ev.id)} disabled={pending}>
                  ×
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {abrir && (
        <form ref={formRef} onSubmit={onSubmit} className="mt-3 grid gap-2 md:grid-cols-2">
          <Input name="nombre" placeholder="Nombre del documento *" required />
          <Select name="tipoDocumental" defaultValue="">
            <option value="">Tipo documental…</option>
            {TIPO_DOCUMENTAL.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
          <label className="text-xs text-slate-500">
            Vigencia (opcional)
            <Input name="vigencia" type="date" />
          </label>
          <label className="text-xs text-slate-500">
            Archivo (máx {MAX_EVIDENCIA_MB} MB)
            <Input name="file" type="file" />
          </label>
          <div className="flex items-center gap-3 md:col-span-2">
            <Button size="sm" type="submit" disabled={pending}>
              {pending ? "Subiendo…" : "Subir evidencia"}
            </Button>
            {msg && <span className="text-xs text-red-600">{msg}</span>}
          </div>
        </form>
      )}
      {!abrir && msg && <p className="mt-2 text-xs text-red-600">{msg}</p>}
    </div>
  );
}
