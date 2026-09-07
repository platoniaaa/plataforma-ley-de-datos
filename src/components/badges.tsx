import { Badge } from "@/components/ui";
import {
  ESTADO_DIAGNOSTICO,
  NIVEL_MADUREZ,
  ESTADO_ACCION,
  ESTADO_EVIDENCIA,
  ESTADO_PREPARACION,
  type NivelMadurez,
  type EstadoPreparacion,
} from "@/lib/constants";

export function NivelBadge({ nivel }: { nivel: NivelMadurez | null }) {
  if (!nivel) return <Badge color="slate">Sin datos</Badge>;
  const map: Record<NivelMadurez, "red" | "orange" | "yellow" | "green" | "blue"> = {
    CRITICO: "red",
    BAJO: "orange",
    MEDIO: "yellow",
    ALTO: "green",
    AVANZADO: "green",
  };
  return <Badge color={map[nivel]}>{NIVEL_MADUREZ[nivel].label}</Badge>;
}

export function EstadoDiagnosticoBadge({ estado }: { estado: string }) {
  const label = ESTADO_DIAGNOSTICO[estado as keyof typeof ESTADO_DIAGNOSTICO] ?? estado;
  const color =
    estado === "CERRADO" || estado === "PREPARADO_CERT"
      ? "green"
      : estado === "BORRADOR"
        ? "slate"
        : "blue";
  return <Badge color={color}>{label}</Badge>;
}

export function CriticidadBadge({ criticidad }: { criticidad: string }) {
  const map: Record<string, "red" | "orange" | "yellow" | "slate"> = {
    CRITICA: "red",
    ALTA: "orange",
    MEDIA: "yellow",
    BAJA: "slate",
  };
  const label = criticidad.charAt(0) + criticidad.slice(1).toLowerCase();
  return <Badge color={map[criticidad] ?? "slate"}>{label}</Badge>;
}

// Nivel de riesgo (CRITICO/ALTO/MEDIO/BAJO) y de impacto.
export function NivelRiesgoBadge({ nivel }: { nivel: string }) {
  const map: Record<string, "red" | "orange" | "yellow" | "slate"> = {
    CRITICO: "red",
    ALTO: "orange",
    MEDIO: "yellow",
    BAJO: "slate",
  };
  const label = nivel.charAt(0) + nivel.slice(1).toLowerCase();
  return <Badge color={map[nivel] ?? "slate"}>{label}</Badge>;
}

export function PrioridadBadge({ prioridad }: { prioridad: string }) {
  const map: Record<string, "red" | "yellow" | "slate"> = { ALTA: "red", MEDIA: "yellow", BAJA: "slate" };
  const label = prioridad.charAt(0) + prioridad.slice(1).toLowerCase();
  return <Badge color={map[prioridad] ?? "slate"}>{label}</Badge>;
}

export function EstadoAccionBadge({ estado }: { estado: string }) {
  const color = estado === "CERRADA" ? "green" : estado === "EN_CURSO" ? "blue" : "slate";
  return <Badge color={color}>{ESTADO_ACCION[estado as keyof typeof ESTADO_ACCION] ?? estado}</Badge>;
}

export function EstadoEvidenciaBadge({ estado }: { estado: string }) {
  const map: Record<string, "green" | "blue" | "orange" | "red" | "slate"> = {
    VALIDADA: "green",
    EN_REVISION: "blue",
    OBSERVADA: "orange",
    RECHAZADA: "red",
    VENCIDA: "red",
    PENDIENTE: "slate",
  };
  return <Badge color={map[estado] ?? "slate"}>{ESTADO_EVIDENCIA[estado as keyof typeof ESTADO_EVIDENCIA] ?? estado}</Badge>;
}

export function PreparacionBadge({ estado }: { estado: EstadoPreparacion }) {
  const map: Record<EstadoPreparacion, "red" | "orange" | "yellow" | "green" | "slate"> = {
    DATOS_INSUFICIENTES: "slate",
    NO_PREPARADO: "red",
    INICIAL: "orange",
    EN_PROCESO: "yellow",
    CASI: "green",
    LISTO: "green",
  };
  return <Badge color={map[estado]}>{ESTADO_PREPARACION[estado].label}</Badge>;
}
