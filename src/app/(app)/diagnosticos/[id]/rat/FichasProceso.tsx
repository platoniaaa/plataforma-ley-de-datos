"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { MAX_EVIDENCIA_MB, MAX_EVIDENCIA_BYTES, MAX_FICHAS_LOTE } from "@/lib/constants";
import { analisisLoLee, motivoNoLegible } from "@/lib/documentos";
import { claveNombre } from "@/lib/rat";
import { prepararSubidaFichas, registrarFichas, eliminarFicha } from "./fichas-actions";

export type FichaVM = {
  id: string;
  nombre: string;
  descripcion: string | null;
  areaNombre: string | null;
  mimeType: string | null;
  tamano: number | null;
  subidoPor: string | null;
  createdAt: string;
};

type Area = { id: string; nombre: string };

/** Cuántos archivos viajan a Storage a la vez. */
const EN_PARALELO = 3;

function peso(bytes: number | null): string {
  if (!bytes) return "";
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * Un nombre presentable a partir del archivo.
 *
 * Las fichas llegan como "Ficha_de_Levantamiento_S_2.1_Recepción_de_Materiales.xlsx".
 * Se le quita la extensión, se cambian los guiones bajos por espacios y se le devuelve la
 * forma al código del proceso —"S_2.1" vuelve a ser "S-2.1", que es como se llama en el
 * mapa de procesos—. El prefijo "Ficha de Levantamiento" sobra dentro de una sección que
 * se llama Fichas de proceso, así que se saca cuando queda algo después.
 */
function nombreDesde(archivo: string): string {
  const base = archivo
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\b([A-Za-z])\s(\d+(?:\.\d+)*)\b/g, "$1-$2")
    .replace(/\s+/g, " ")
    .trim();
  const sinPrefijo = base.replace(/^ficha\s+de\s+levantamiento\s*/i, "").trim();
  return (sinPrefijo.length >= 3 ? sinPrefijo : base).slice(0, 200);
}

type Estado = "pendiente" | "subiendo" | "lista" | "error";

type EnCola = {
  archivo: File;
  nombre: string;
  estado: Estado;
  motivo?: string;
  /** Ruta en Storage una vez que el archivo llegó. */
  path?: string;
};

/**
 * Corre `fn` sobre la lista con un tope de tareas simultáneas.
 *
 * Veinte subidas a la vez saturan la conexión y hacen que todas vayan lentas; de a una,
 * la ventana se pasa esperando. Tres es lo que aprovecha el ancho de banda sin que el
 * navegador empiece a encolar por su cuenta.
 */
async function enTandas<T>(items: T[], tope: number, fn: (item: T, i: number) => Promise<void>) {
  let siguiente = 0;
  await Promise.all(
    Array.from({ length: Math.min(tope, items.length) }, async () => {
      while (siguiente < items.length) {
        const i = siguiente++;
        await fn(items[i], i);
      }
    })
  );
}

export function FichasProceso({
  empresaId,
  fichas,
  areas,
}: {
  empresaId: string;
  fichas: FichaVM[];
  areas: Area[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [abrir, setAbrir] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [cola, setCola] = useState<EnCola[]>([]);
  const [comun, setComun] = useState({ descripcion: "", areaId: "" });
  const archivoRef = useRef<HTMLInputElement>(null);

  function elegir(files: FileList | null) {
    setMsg(null);
    const elegidos = Array.from(files ?? []);
    if (elegidos.length > MAX_FICHAS_LOTE) {
      setMsg({
        ok: false,
        texto: `Elegiste ${elegidos.length} archivos y el máximo por tanda es ${MAX_FICHAS_LOTE}. Sube los primeros y repite.`,
      });
    }
    setCola(
      elegidos.slice(0, MAX_FICHAS_LOTE).map((archivo) => ({
        archivo,
        nombre: nombreDesde(archivo.name),
        estado: archivo.size > MAX_EVIDENCIA_BYTES ? "error" : "pendiente",
        motivo: archivo.size > MAX_EVIDENCIA_BYTES ? `supera ${MAX_EVIDENCIA_MB} MB` : undefined,
      }))
    );
  }

  function renombrar(i: number, nombre: string) {
    setCola((prev) => prev.map((f, k) => (k === i ? { ...f, nombre } : f)));
  }

  function marcar(i: number, cambio: Partial<EnCola>) {
    setCola((prev) => prev.map((f, k) => (k === i ? { ...f, ...cambio } : f)));
  }

  function limpiar() {
    setCola([]);
    setComun({ descripcion: "", areaId: "" });
    if (archivoRef.current) archivoRef.current.value = "";
  }

  async function subir() {
    const porSubir = cola.filter((f) => f.estado === "pendiente" || f.estado === "error");
    setMsg(null);
    if (porSubir.length === 0) return setMsg({ ok: false, texto: "Elige al menos un archivo." });
    const sinNombre = porSubir.find((f) => f.nombre.trim().length < 3);
    if (sinNombre) {
      return setMsg({ ok: false, texto: `"${sinNombre.archivo.name}" necesita un nombre.` });
    }

    setSubiendo(true);
    try {
      // Los índices son sobre la cola completa: lo que ya subió en un intento anterior no
      // se vuelve a subir, y los avisos siguen apuntando a la fila correcta.
      const indices = cola
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => f.estado === "pendiente" || f.estado === "error")
        .map(({ i }) => i);

      const prep = await prepararSubidaFichas(
        empresaId,
        indices.map((i) => ({ nombre: cola[i].archivo.name, tamano: cola[i].archivo.size }))
      );
      if (!prep.ok || !prep.destinos) {
        setMsg({ ok: false, texto: prep.error ?? "No se pudo preparar la subida." });
        return;
      }

      for (const i of indices) marcar(i, { estado: "subiendo", motivo: undefined });

      const listas: { i: number; path: string }[] = [];
      await enTandas(indices, EN_PARALELO, async (i, pos) => {
        const destino = prep.destinos![pos];
        if (!destino?.signedUrl || !destino.path) {
          marcar(i, { estado: "error", motivo: destino?.error ?? "sin destino" });
          return;
        }
        const archivo = cola[i].archivo;
        try {
          // El archivo va del navegador directo a Storage: el servidor rechaza cuerpos
          // grandes, así que pasar por él limitaría las fichas a unos pocos megas.
          const res = await fetch(destino.signedUrl, {
            method: "PUT",
            headers: { "Content-Type": archivo.type || "application/octet-stream" },
            body: archivo,
          });
          if (!res.ok) {
            marcar(i, { estado: "error", motivo: `no se pudo subir (${res.status})` });
            return;
          }
          marcar(i, { estado: "lista", path: destino.path, motivo: undefined });
          listas.push({ i, path: destino.path });
        } catch (e) {
          marcar(i, { estado: "error", motivo: (e as Error).message.slice(0, 60) });
        }
      });

      if (listas.length === 0) {
        setMsg({ ok: false, texto: "No se pudo subir ningún archivo." });
        return;
      }

      const reg = await registrarFichas({
        empresaId,
        areaId: comun.areaId || undefined,
        descripcion: comun.descripcion,
        fichas: listas.map(({ i, path }) => ({
          nombre: cola[i].nombre,
          archivoPath: path,
          mimeType: cola[i].archivo.type || undefined,
          tamano: cola[i].archivo.size,
        })),
      });
      if (!reg.ok) {
        setMsg({ ok: false, texto: reg.error ?? "Los archivos subieron, pero no se registraron." });
        return;
      }

      const fallidas = cola.length - listas.length;
      setMsg({
        ok: true,
        texto:
          `${reg.creadas} ${reg.creadas === 1 ? "ficha cargada" : "fichas cargadas"}.` +
          (fallidas > 0 ? ` ${fallidas} quedaron sin subir: revisa el detalle.` : ""),
      });
      if (fallidas === 0) {
        limpiar();
        setAbrir(false);
      } else {
        // Solo se sacan las que sí entraron: las que fallaron quedan listas para reintentar
        // sin tener que volver a elegir los archivos uno por uno.
        setCola((prev) => prev.filter((f) => f.estado !== "lista"));
      }
      router.refresh();
    } finally {
      setSubiendo(false);
    }
  }

  function borrar(id: string) {
    setMsg(null);
    startTransition(async () => {
      const res = await eliminarFicha(id);
      if (res.ok) router.refresh();
      else setMsg({ ok: false, texto: res.error ?? "No se pudo eliminar." });
    });
  }

  const porSubir = cola.filter((f) => f.estado !== "lista").length;
  const sinLeer = cola.filter((f) => !analisisLoLee(f.archivo.type)).length;
  // Subir dos veces la misma ficha no se bloquea —a veces es la versión corregida— pero
  // sí se avisa: el análisis lee las dos y propone la misma actividad dos veces.
  const cargadas = new Set(fichas.map((f) => claveNombre(f.nombre)));

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-800">Fichas de proceso</p>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            El levantamiento de campo del equipo consultor: entrevistas por área, flujos de
            datos, inventarios de sistemas. <strong>No son evidencias del cliente</strong> —
            estas las levantamos nosotros— y el análisis del RAT las prefiere por sobre los
            comentarios del cuestionario, porque describen el proceso en vez de opinar sobre él.
          </p>
        </div>
        <Button onClick={() => setAbrir(!abrir)} disabled={subiendo}>
          {abrir ? "Cancelar" : "Subir fichas"}
        </Button>
      </div>

      {msg && (
        <p className={`mt-3 text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.texto}</p>
      )}

      {abrir && (
        <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div>
            <Label htmlFor="ficha-archivo">Archivos</Label>
            <input
              id="ficha-archivo"
              ref={archivoRef}
              type="file"
              multiple
              onChange={(e) => elegir(e.target.files)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700"
            />
            <p className="mt-1 text-xs text-slate-500">
              Puedes elegir <strong>varios de una vez</strong> —hasta {MAX_FICHAS_LOTE} por
              tanda, {MAX_EVIDENCIA_MB} MB cada uno—. El nombre sale del archivo y lo puedes
              corregir abajo. El análisis lee <strong>PDF, imágenes, Word (.docx) y Excel
              (.xlsx)</strong>.
            </p>
          </div>

          {cola.length > 0 && (
            <>
              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                  <p className="text-xs font-medium text-slate-600">
                    {cola.length} {cola.length === 1 ? "archivo" : "archivos"}
                    {sinLeer > 0 && (
                      <span className="text-orange-700">
                        {" "}
                        · {sinLeer} que el análisis no podrá leer
                      </span>
                    )}
                  </p>
                  {!subiendo && (
                    <button
                      type="button"
                      onClick={limpiar}
                      className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800"
                    >
                      Vaciar
                    </button>
                  )}
                </div>
                <ul className="divide-y divide-slate-100">
                  {cola.map((f, i) => {
                    const motivoFormato = motivoNoLegible(f.archivo.type);
                    return (
                      <li key={`${f.archivo.name}-${i}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <span className="w-5 shrink-0 text-center text-sm" aria-hidden>
                          {f.estado === "lista" && "✓"}
                          {f.estado === "error" && "✕"}
                          {f.estado === "subiendo" && "…"}
                        </span>
                        <Input
                          value={f.nombre}
                          disabled={subiendo || f.estado === "lista"}
                          aria-label={`Nombre de ${f.archivo.name}`}
                          onChange={(e) => renombrar(i, e.target.value)}
                          className="min-w-[220px] flex-1"
                        />
                        <span className="shrink-0 text-xs text-slate-400">
                          {peso(f.archivo.size)}
                        </span>
                        {f.motivo && (
                          <span className="w-full text-xs text-red-600">{f.motivo}</span>
                        )}
                        {!f.motivo && motivoFormato && (
                          <span className="w-full text-xs text-orange-700">
                            El análisis no va a poder leerlo: {motivoFormato}. Se guarda igual
                            en el expediente.
                          </span>
                        )}
                        {!f.motivo && !motivoFormato && cargadas.has(claveNombre(f.nombre)) && (
                          <span className="w-full text-xs text-slate-500">
                            Ya hay una ficha con este nombre. Si es la versión corregida,
                            conviene borrar la anterior: el análisis leería las dos.
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label htmlFor="ficha-area">Área levantada</Label>
                  <Select
                    id="ficha-area"
                    value={comun.areaId}
                    disabled={subiendo}
                    onChange={(e) => setComun((c) => ({ ...c, areaId: e.target.value }))}
                  >
                    <option value="">Sin área específica</option>
                    {areas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.nombre}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="ficha-desc">Contexto (opcional)</Label>
                  <Textarea
                    id="ficha-desc"
                    rows={2}
                    value={comun.descripcion}
                    disabled={subiendo}
                    onChange={(e) => setComun((c) => ({ ...c, descripcion: e.target.value }))}
                    placeholder="De qué sesión salieron, con quién se levantaron, qué alcance tienen."
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                El área y el contexto se aplican a <strong>toda la tanda</strong>. Si vienen de
                áreas distintas, súbelas en tandas separadas o corrígelo después.
              </p>
            </>
          )}

          <Button onClick={subir} disabled={subiendo || porSubir === 0}>
            {subiendo
              ? "Subiendo…"
              : porSubir === 0
                ? "Elige archivos"
                : `Cargar ${porSubir} ${porSubir === 1 ? "ficha" : "fichas"}`}
          </Button>
        </div>
      )}

      {fichas.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
          {fichas.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">{f.nombre}</span>
                  {!analisisLoLee(f.mimeType) && (
                    <span
                      className="rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-700"
                      title="El archivo queda guardado en el expediente, pero no aporta al RAT."
                    >
                      el análisis no lo lee: {motivoNoLegible(f.mimeType)}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-400">
                  {f.areaNombre ?? "Sin área"} · {peso(f.tamano)}
                  {f.subidoPor && ` · subió ${f.subidoPor}`} · {f.createdAt}
                </p>
                {f.descripcion && (
                  <p className="mt-0.5 text-xs text-slate-500">{f.descripcion}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => borrar(f.id)}
                disabled={pending || subiendo}
                className="shrink-0 text-xs text-slate-500 underline underline-offset-2 hover:text-red-600 disabled:opacity-50"
              >
                Eliminar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
