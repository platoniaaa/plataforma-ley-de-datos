// Entorno de demostración aislado: una empresa ficticia con su propio diagnóstico,
// participantes y respuestas de ejemplo, para mostrar la plataforma sin exponer datos
// de un cliente real ni ensuciar su seguimiento.
//
// El aislamiento se apoya en dos cosas:
//   · Empresa.esDemo = true  → el staff que trabaja clientes reales no la ve.
//   · La cuenta demo tiene empresaId apuntando a ella → no ve ninguna otra.
//
// Idempotente: se puede correr las veces que sea.
//
// Uso: npx tsx prisma/crear-demo.ts

import { readFileSync } from "fs";
import { join } from "path";
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
process.env.DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const RUT_DEMO = "99.999.999-9";
const CUENTA_DEMO = "consultor@procesos360.cl";
const PASS_PARTICIPANTES = "Demo1234";

// Nombres inventados, sin parecido con clientes reales.
const PARTICIPANTES = [
  { nombre: "Andrea Rojas", cargo: "Gerente de Personas", email: "andrea.rojas@empresademo.cl", dominios: [1, 10] },
  { nombre: "Matias Vergara", cargo: "Jefe de TI", email: "matias.vergara@empresademo.cl", dominios: [5, 6, 8] },
  { nombre: "Camila Fuentes", cargo: "Fiscal / Legal", email: "camila.fuentes@empresademo.cl", dominios: [3, 7] },
  { nombre: "Rodrigo Pena", cargo: "Jefe de Servicio al Cliente", email: "rodrigo.pena@empresademo.cl", dominios: [2, 4] },
  { nombre: "Valentina Soto", cargo: "Encargada de Compras", email: "valentina.soto@empresademo.cl", dominios: [7, 9] },
];

// Respuestas de ejemplo por dominio: [nota, comentario]. Deliberadamente variadas para
// que el radar de madurez y el motor de brechas muestren algo con relieve.
const EJEMPLOS: Record<number, [string, string][]> = {
  1: [
    ["4", "Politica aprobada por el directorio en marzo, publicada en la intranet."],
    ["3", "Existe un encargado designado, formalizado por resolucion interna."],
    ["2", "El comite de privacidad se reune, pero sin acta formal."],
    ["1", "Los roles estan repartidos de hecho, no por escrito."],
    ["0", "No hay indicadores de cumplimiento definidos."],
  ],
  5: [
    ["4", "Politica de seguridad vigente y revisada anualmente."],
    ["3", "Matriz de accesos documentada, se revisa cada semestre."],
    ["3", "Respaldos diarios con verificacion de restauracion."],
    ["2", "El monitoreo cubre la red, no las aplicaciones."],
  ],
  10: [
    ["2", "Se hizo una capacitacion inicial, sin plan anual."],
    ["1", "Las comunicaciones internas son esporadicas."],
  ],
};

async function main() {
  // ── Empresa ──
  const empresa = await prisma.empresa.upsert({
    where: { rut: RUT_DEMO },
    update: { esDemo: true },
    create: {
      razonSocial: "Empresa Demo SpA",
      rut: RUT_DEMO,
      nombreComercial: "Empresa Demo",
      industria: "Retail",
      tamano: "MEDIANA",
      pais: "Chile",
      region: "Metropolitana",
      numColaboradores: 180,
      responsablePrincipal: "Andrea Rojas",
      correoResponsable: "andrea.rojas@empresademo.cl",
      esDemo: true,
    },
  });
  console.log(`Empresa: ${empresa.razonSocial} (${empresa.rut}) · esDemo=${empresa.esDemo}`);

  // ── La cuenta demo queda acotada a esta empresa ──
  const cuenta = await prisma.user.findUnique({ where: { email: CUENTA_DEMO } });
  if (!cuenta) {
    console.error(`No existe la cuenta ${CUENTA_DEMO}. Crearla antes de correr esto.`);
    process.exit(1);
  }
  await prisma.user.update({ where: { id: cuenta.id }, data: { empresaId: empresa.id } });
  console.log(`Cuenta ${CUENTA_DEMO} acotada al entorno demo (rol ${cuenta.role}).`);

  // ── Participantes ficticios ──
  const hash = bcrypt.hashSync(PASS_PARTICIPANTES, 10);
  const idPorEmail = new Map<string, string>();
  for (const p of PARTICIPANTES) {
    const u = await prisma.user.upsert({
      where: { email: p.email },
      update: { nombre: p.nombre, cargo: p.cargo, empresaId: empresa.id },
      create: {
        nombre: p.nombre,
        email: p.email,
        cargo: p.cargo,
        passwordHash: hash,
        role: "RESPONSABLE_DOMINIO",
        empresaId: empresa.id,
        // Ya aceptaron: en una demo no interesa mostrar el consentimiento de ellos.
        consentimientoVersion: "1.0",
        consentimientoFecha: new Date(),
        tourVisto: true,
      },
    });
    idPorEmail.set(p.email, u.id);
  }
  console.log(`Participantes: ${PARTICIPANTES.length}`);

  // ── Diagnóstico ──
  let diag = await prisma.diagnostico.findFirst({ where: { empresaId: empresa.id } });
  if (!diag) {
    diag = await prisma.diagnostico.create({
      data: {
        empresaId: empresa.id,
        nombre: "Diagnostico de demostracion 2026",
        tipo: "INICIAL",
        estado: "EN_EJECUCION",
        fechaInicio: new Date(),
        consultorId: cuenta.id,
      },
    });
  }
  console.log(`Diagnostico: ${diag.nombre}`);

  // ── Dominios, preguntas, participantes y respuestas de ejemplo ──
  const dominios = await prisma.dominio.findMany({
    orderBy: { orden: "asc" },
    include: { preguntas: { orderBy: { orden: "asc" } } },
  });

  for (const dom of dominios) {
    const dd = await prisma.diagnosticoDominio.upsert({
      where: { diagnosticoId_dominioId: { diagnosticoId: diag.id, dominioId: dom.id } },
      update: {},
      create: { diagnosticoId: diag.id, dominioId: dom.id, incluido: true, estado: "PENDIENTE" },
    });

    for (const preg of dom.preguntas) {
      await prisma.respuesta.upsert({
        where: {
          diagnosticoDominioId_preguntaId: { diagnosticoDominioId: dd.id, preguntaId: preg.id },
        },
        update: {},
        create: { diagnosticoDominioId: dd.id, preguntaId: preg.id },
      });
    }

    for (const p of PARTICIPANTES.filter((x) => x.dominios.includes(dom.orden))) {
      await prisma.participanteDominio.upsert({
        where: {
          diagnosticoDominioId_userId: {
            diagnosticoDominioId: dd.id,
            userId: idPorEmail.get(p.email)!,
          },
        },
        update: {},
        create: { diagnosticoDominioId: dd.id, userId: idPorEmail.get(p.email)! },
      });
    }

    const ejemplos = EJEMPLOS[dom.orden];
    const autor = PARTICIPANTES.find((x) => x.dominios.includes(dom.orden));
    if (!ejemplos || !autor) continue;
    const autorId = idPorEmail.get(autor.email)!;

    const respuestas = await prisma.respuesta.findMany({
      where: { diagnosticoDominioId: dd.id },
      orderBy: { pregunta: { orden: "asc" } },
      select: { id: true, valor: true },
    });
    for (let i = 0; i < ejemplos.length && i < respuestas.length; i++) {
      if (respuestas[i].valor != null) continue; // ya respondida: no se pisa
      const [valor, comentario] = ejemplos[i];
      await prisma.aporteRespuesta.upsert({
        where: { respuestaId_userId: { respuestaId: respuestas[i].id, userId: autorId } },
        update: { valor, comentario },
        create: { respuestaId: respuestas[i].id, userId: autorId, valor, comentario },
      });
      await prisma.respuesta.update({
        where: { id: respuestas[i].id },
        data: { valor, comentario, estado: "RESPONDIDA", respondidoPorId: autorId },
      });
    }
    await prisma.diagnosticoDominio.update({
      where: { id: dd.id },
      data: { estado: "EN_EJECUCION" },
    });
  }

  const total = await prisma.respuesta.count({
    where: { diagnosticoDominio: { diagnosticoId: diag.id } },
  });
  const conNota = await prisma.respuesta.count({
    where: { diagnosticoDominio: { diagnosticoId: diag.id }, valor: { not: null } },
  });
  console.log(`\nListo. ${conNota} de ${total} preguntas con respuesta de ejemplo.`);
  console.log(`Entra con ${CUENTA_DEMO} / Demo1234 — solo vera este entorno.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
