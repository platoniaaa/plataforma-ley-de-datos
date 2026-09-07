// Parametrización de Honda a partir de "Levantamiento por los 10 dominios de la LPDP - Honda.xlsx"
// Crea: empresa Honda + áreas (roles del levantamiento) + usuario admin + diagnóstico INICIAL
// con dominios asignados a áreas y evidencias requeridas como checklist PENDIENTE.
//
// Mapeo acordado:
// - Excel "Transferencias y comunicaciones de datos" → se fusiona en RAT (arquitectura/flujos)
//   y Gestión de Terceros (contratos de transferencia).
// - Excel "Gestión de riesgos y evaluaciones" → sus evidencias van a Gobierno y Accountability;
//   la gestión de riesgos la cubre el motor de riesgos de la plataforma.
// - Dominios del catálogo sin datos en el Excel (Tecnología y Ciberseguridad, Retención y
//   Eliminación) → incluido=false con justificación.
//
// Uso: npx tsx prisma/parametrizar-honda.ts   (usa DATABASE_URL de .env → producción)

import { readFileSync } from "fs";
import { join } from "path";

// Carga .env sin depender de dotenv (tsx no lo carga solo)
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const RUT_HONDA = "96.870.620-9";

type AreaDef = {
  nombre: string;
  trataDatos?: boolean;
  trataDatosSensibles?: boolean;
  usaSistemas?: boolean;
};

const AREAS: AreaDef[] = [
  { nombre: "Gerencia General" },
  { nombre: "Recursos Humanos", trataDatos: true, trataDatosSensibles: true, usaSistemas: true },
  { nombre: "TI", trataDatos: true, usaSistemas: true },
  { nombre: "Legal", trataDatos: true, trataDatosSensibles: true, usaSistemas: true },
  { nombre: "Cumplimiento" },
  { nombre: "Auditoría Interna" },
  { nombre: "Comercial", trataDatos: true, usaSistemas: true },
  { nombre: "Marketing", trataDatos: true, usaSistemas: true },
  { nombre: "Postventa", trataDatos: true, usaSistemas: true },
  { nombre: "Finanzas", trataDatos: true, usaSistemas: true },
  { nombre: "Atención de Clientes", trataDatos: true, trataDatosSensibles: true, usaSistemas: true },
  { nombre: "Ciberseguridad", usaSistemas: true },
  { nombre: "Infraestructura", usaSistemas: true },
  { nombre: "Riesgos", usaSistemas: true },
  { nombre: "Compras", trataDatos: true, usaSistemas: true },
  { nombre: "Comunicaciones Internas", usaSistemas: true },
];

// Por dominio del catálogo (orden): área principal + evidencias requeridas del levantamiento
type Evid = { nombre: string; tipo: string };
type DomCfg = {
  area?: string;
  incluido: boolean;
  justificacion?: string;
  evidencias: Evid[];
};

const DOMINIOS: Record<number, DomCfg> = {
  1: {
    area: "Gerencia General",
    incluido: true,
    evidencias: [
      { nombre: "Organigrama", tipo: "Registro" },
      { nombre: "Descripciones de cargo", tipo: "Registro" },
      { nombre: "Políticas corporativas", tipo: "Política" },
      { nombre: "Actas de comités", tipo: "Acta" },
      { nombre: "Manual de gobierno", tipo: "Política" },
      { nombre: "Procedimientos internos", tipo: "Procedimiento" },
      // Fusión: "Gestión de riesgos y evaluaciones" (Excel dominio 9)
      { nombre: "Matriz de riesgos", tipo: "Matriz" },
      { nombre: "Informes de auditoría", tipo: "Informe" },
      { nombre: "Informes de evaluación", tipo: "Informe" },
      { nombre: "Planes de mitigación", tipo: "Informe" },
    ],
  },
  2: {
    area: "Comercial",
    incluido: true,
    evidencias: [
      { nombre: "Formularios de captura de datos", tipo: "Registro" },
      { nombre: "Inventario de bases de datos", tipo: "Inventario" },
      { nombre: "Registros del CRM", tipo: "Registro" },
      { nombre: "Registros del ERP", tipo: "Registro" },
      { nombre: "Formularios del sitio web", tipo: "Registro" },
      { nombre: "Inventario de aplicaciones", tipo: "Inventario" },
      { nombre: "Flujos de procesos", tipo: "Informe" },
      // Fusión: "Transferencias y comunicaciones de datos" (Excel dominio 8)
      { nombre: "Diagramas de arquitectura e interfaces", tipo: "Informe" },
      { nombre: "Inventario de integraciones entre sistemas", tipo: "Inventario" },
      { nombre: "Flujos de datos (transferencias nacionales e internacionales)", tipo: "Informe" },
    ],
  },
  3: {
    area: "Legal",
    incluido: true,
    evidencias: [
      { nombre: "Formularios web de consentimiento", tipo: "Registro" },
      { nombre: "Contratos", tipo: "Contrato" },
      { nombre: "Cláusulas de privacidad", tipo: "Cláusula" },
      { nombre: "Consentimientos firmados", tipo: "Registro" },
      { nombre: "Términos y condiciones", tipo: "Cláusula" },
    ],
  },
  4: {
    area: "Atención de Clientes",
    incluido: true,
    evidencias: [
      { nombre: "Procedimiento de atención de solicitudes", tipo: "Procedimiento" },
      { nombre: "Correos de solicitudes", tipo: "Registro" },
      { nombre: "Tickets de solicitudes", tipo: "Registro" },
      { nombre: "Casos atendidos", tipo: "Registro" },
      { nombre: "Formularios de solicitud", tipo: "Registro" },
    ],
  },
  5: {
    area: "TI",
    incluido: true,
    evidencias: [
      { nombre: "Políticas de seguridad", tipo: "Política" },
      { nombre: "Inventario de activos", tipo: "Inventario" },
      { nombre: "Matriz de accesos", tipo: "Matriz" },
      { nombre: "Reportes de respaldo", tipo: "Informe" },
      { nombre: "Configuración de seguridad", tipo: "Registro" },
    ],
  },
  6: {
    incluido: false,
    justificacion:
      "No contemplado en el levantamiento inicial de Honda (Levantamiento por los 10 dominios de la LPDP).",
    evidencias: [],
  },
  7: {
    area: "Compras",
    incluido: true,
    evidencias: [
      { nombre: "Contratos con proveedores", tipo: "Contrato" },
      { nombre: "Acuerdos de confidencialidad (NDA)", tipo: "Contrato" },
      { nombre: "Acuerdos de tratamiento de datos", tipo: "Contrato" },
      { nombre: "Matriz de proveedores", tipo: "Matriz" },
      // Fusión: "Transferencias y comunicaciones de datos" (Excel dominio 8)
      { nombre: "Contratos de transferencia de datos", tipo: "Contrato" },
    ],
  },
  8: {
    area: "TI",
    incluido: true,
    evidencias: [
      { nombre: "Procedimiento de gestión de incidentes", tipo: "Procedimiento" },
      { nombre: "Registro de incidentes", tipo: "Registro" },
      { nombre: "Informes de investigación", tipo: "Informe" },
      { nombre: "Planes de contingencia", tipo: "Procedimiento" },
    ],
  },
  9: {
    incluido: false,
    justificacion:
      "No contemplado en el levantamiento inicial de Honda (Levantamiento por los 10 dominios de la LPDP).",
    evidencias: [],
  },
  10: {
    area: "Recursos Humanos",
    incluido: true,
    evidencias: [
      { nombre: "Plan anual de capacitación", tipo: "Otro" },
      { nombre: "Registros de asistencia", tipo: "Registro" },
      { nombre: "Material de capacitación", tipo: "Otro" },
      { nombre: "Comunicaciones internas", tipo: "Registro" },
      { nombre: "Indicadores de cumplimiento", tipo: "Informe" },
    ],
  },
};

async function main() {
  const existente = await prisma.empresa.findUnique({ where: { rut: RUT_HONDA } });
  if (existente) {
    console.error(`Ya existe una empresa con RUT ${RUT_HONDA} (${existente.razonSocial}). Abortando para no duplicar.`);
    process.exit(1);
  }

  console.log("Creando empresa Honda...");
  const empresa = await prisma.empresa.create({
    data: {
      razonSocial: "Honda",
      rut: RUT_HONDA,
      nombreComercial: "Honda",
      industria: "Automotriz",
      tamano: "GRANDE",
      pais: "Chile",
    },
  });

  console.log(`Creando ${AREAS.length} áreas...`);
  const areasPorNombre = new Map<string, string>();
  for (const a of AREAS) {
    const area = await prisma.area.create({
      data: {
        empresaId: empresa.id,
        nombre: a.nombre,
        participaDiagnostico: true,
        trataDatos: a.trataDatos ?? false,
        trataDatosSensibles: a.trataDatosSensibles ?? false,
        usaSistemas: a.usaSistemas ?? false,
      },
    });
    areasPorNombre.set(a.nombre, area.id);
  }

  console.log("Creando usuario admin@honda.cl...");
  await prisma.user.create({
    data: {
      nombre: "Admin Honda",
      email: "admin@honda.cl",
      passwordHash: bcrypt.hashSync("Demo1234", 10),
      role: "ADMIN_EMPRESA",
      empresaId: empresa.id,
      cargo: "Administrador",
    },
  });

  console.log("Creando diagnóstico INICIAL...");
  const diagnostico = await prisma.diagnostico.create({
    data: {
      empresaId: empresa.id,
      nombre: "Levantamiento LPDP Honda 2026",
      tipo: "INICIAL",
      estado: "CONFIGURADO",
      fechaInicio: new Date(),
    },
  });

  const dominios = await prisma.dominio.findMany({
    orderBy: { orden: "asc" },
    include: { preguntas: { select: { id: true } } },
  });
  let totalEvidencias = 0;
  let totalRespuestas = 0;
  for (const dom of dominios) {
    const cfg = DOMINIOS[dom.orden];
    if (!cfg) continue;
    const dd = await prisma.diagnosticoDominio.create({
      data: {
        diagnosticoId: diagnostico.id,
        dominioId: dom.id,
        incluido: cfg.incluido,
        justificacionNoAplica: cfg.justificacion ?? null,
        areaId: cfg.area ? areasPorNombre.get(cfg.area) ?? null : null,
      },
    });
    // Una Respuesta PENDIENTE por pregunta del catálogo (igual que la UI al crear
    // un diagnóstico). Sin esto, el cuestionario del dominio aparece vacío.
    if (cfg.incluido && dom.preguntas.length > 0) {
      await prisma.respuesta.createMany({
        data: dom.preguntas.map((p) => ({
          diagnosticoDominioId: dd.id,
          preguntaId: p.id,
          estado: "PENDIENTE",
        })),
      });
      totalRespuestas += dom.preguntas.length;
    }
    for (const ev of cfg.evidencias) {
      await prisma.evidencia.create({
        data: {
          diagnosticoDominioId: dd.id,
          nombre: ev.nombre,
          tipoDocumental: ev.tipo,
          estado: "PENDIENTE",
          observaciones: "Evidencia requerida según levantamiento Honda (Excel 10 dominios LPDP).",
        },
      });
      totalEvidencias++;
    }
    console.log(`  ${dom.orden}. ${dom.nombre} — ${cfg.incluido ? `área: ${cfg.area ?? "—"}, ${cfg.evidencias.length} evidencias` : "EXCLUIDO"}`);
  }

  console.log(`\nListo: empresa Honda, ${AREAS.length} áreas, 1 usuario, 1 diagnóstico, ${totalEvidencias} evidencias requeridas, ${totalRespuestas} respuestas pendientes.`);
  console.log("Login Honda: admin@honda.cl / Demo1234");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
