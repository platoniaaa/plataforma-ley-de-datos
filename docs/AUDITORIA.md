# Auditoría de sistemas — Plataforma LPDP (Procesos360)

**Fecha:** 2026-07-19 · **Commit auditado:** `685ad45` · **Alcance:** seguridad, aislamiento
multi-tenant, modelo de datos, lógica de negocio y preparación operacional.

**Veredicto: NO desplegar sin cerrar los 6 bloqueantes de la sección 1.**

El código base está por encima del promedio: TypeScript `strict` sin supresiones, build limpio,
`npm audit` sin vulnerabilidades críticas ni altas, cero secretos hardcodeados, ningún `.env`
commiteado nunca, y un chatbot bien diseñado en privacidad (solo recibe agregados numéricos de la
propia empresa). Lo que falta no es calidad de código: es la capa de control —
autorización por rol, trazabilidad, migraciones, respaldos y observabilidad.

---

## 1. Bloqueantes para el despliegue

### B-1 · IDOR: escritura cross-tenant en la configuración de dominios
`src/app/(app)/diagnosticos/actions.ts:111-121` — **confirmado de forma independiente por los
cuatro auditores.**

Se valida el acceso a `data.diagnosticoId`, pero cada `diagnosticoDominioId` del array se usa
crudo en el `update`, sin atarlo al diagnóstico autorizado. El schema Zod solo valida formato
(`z.string().min(1)`), no propiedad.

Un `ADMIN_EMPRESA` de la empresa A envía su propio `diagnosticoId` (pasa el check) junto con
IDs de `DiagnosticoDominio` de la empresa B, y sobre el diagnóstico ajeno puede: excluir dominios
del alcance (`incluido: false`, lo que altera su puntaje de madurez y la generación de brechas),
reasignar `responsableId`/`areaId`, e inyectar texto en `justificacionNoAplica`. Es corrupción
silenciosa del expediente regulatorio de otro cliente.

```ts
for (const d of data.dominios) {
  const res = await prisma.diagnosticoDominio.updateMany({
    where: { id: d.diagnosticoDominioId, diagnosticoId: data.diagnosticoId }, // scope obligatorio
    data: { /* ... */ },
  });
  if (res.count === 0) return { ok: false, error: "Dominio no pertenece al diagnóstico." };
}
```

Validar además `responsableId`, `areaId` y `consultorId` (`actions.ts:48`) contra
`diag.empresaId` — hoy se aceptan usuarios y áreas de cualquier empresa.

### B-2 · Credenciales demo publicadas y sembradas en producción
`prisma/seed.ts:111-119`, `src/app/(auth)/login/page.tsx:26-32`, `README.md:30-38`,
`docs/DEPLOY.md:26-27,53-54`

El seed crea 5 usuarios con `bcrypt.hashSync("Demo1234", 10)` sin ningún guard de `NODE_ENV`,
incluido `admin@procesos360.cl` con rol `ADMIN_P360` — staff con visibilidad de **todas** las
empresas. La página de login **muestra el listado de correos y la contraseña a cualquier
visitante anónimo**, y el README la publica. `DEPLOY.md` instruye correr `npm run db:seed`
contra Supabase productivo.

Superadministrador con contraseña pública desde el día 1. Además el seed abre con `deleteMany()`
sobre todas las tablas: ejecutarlo contra producción borra la base.

Separar `seed:catalogo` (dominios y preguntas, idempotente, apto para producción) de `seed:demo`
(empresa y usuarios ficticios, solo local); bloquear el seed demo si `NODE_ENV === "production"`;
condicionar el panel de credenciales del login a desarrollo; crear el primer admin con contraseña
generada leída de env. Verificar post-deploy que `User.email LIKE '%demo%'` devuelve 0 filas.

### B-3 · Sin migraciones versionadas; `db:reset` puede borrar producción
`package.json:11-14`, `docs/DEPLOY.md:26,73` — `prisma/migrations/` **no existe**

`db:reset` es `prisma db push --force-reset && prisma db seed`: con `DATABASE_URL` de producción
en el shell, destruye todos los datos de clientes. `db push` además hace `DROP COLUMN` silencioso
cuando detecta drift, no permite rollback, y sin historial de migraciones no se puede auditar la
evolución del esquema — que es en sí mismo un requisito de *accountability*.

`npx prisma migrate dev --name init`, commitear `prisma/migrations/`, cambiar el build a
`prisma migrate deploy && next build`, eliminar `db:push`/`db:reset` o renombrarlos con un guard
que aborte si `DATABASE_URL` no apunta a `localhost`.

### B-4 · Cero estrategia de respaldo
Ninguna mención de `backup|PITR|restauración` en `docs/` ni `README.md`.

Supabase Free retiene backups diarios 7 días **sin PITR** y pausa proyectos inactivos. El bucket
`evidencias` es Storage aparte y **no** está cubierto por los backups de la base. Combinado con
B-3, un error de esquema es irreversible. Para datos de cumplimiento con valor probatorio no es
defendible ante la Agencia.

Plan Supabase Pro con PITR, procedimiento de restauración **probado** antes del go-live, y
política de retención documentada para el bucket de evidencias.

### B-5 · `GEMINI_API_KEY` no documentada; sin validación de entorno
`src/app/api/chat/route.ts:40,70`; no existe `.env.example`

La variable del chatbot — la funcionalidad del último commit — no aparece en `DEPLOY.md` ni en el
README. Se desplegaría con el asistente devolviendo 503 permanente sin que nadie sepa por qué.
En general la app falla en *runtime*, no en arranque: `AUTH_SECRET` ausente rompe el primer login,
y `storage.ts:17-22` lanza recién cuando alguien sube una evidencia.

Crear `.env.example` con las 6 variables, añadir `src/env.ts` con esquema Zod evaluado en import
desde `lib/db.ts` para que el build falle si falta algo, y documentar `GEMINI_API_KEY` en
`DEPLOY.md`. Nota: `src/auth.ts:16` ya fija `trustHost: true`, así que `AUTH_TRUST_HOST` es
innecesaria y `AUTH_URL` opcional en Vercel — `DEPLOY.md:47-48` sobre-especifica.

### B-6 · Fugas de mensajes de error crudos al navegador
`evidencia-actions.ts:145` y `:72` devuelven `(e as Error).message` directo a la UI. Los errores
del SDK de Supabase Storage incluyen rutas de bucket, nombres de objeto y detalles de la petición
firmada. `:63` devuelve el nombre de la variable de entorno al usuario
(`"falta SUPABASE_SERVICE_ROLE_KEY"`) — compárese con `/api/chat/route.ts:41`, que hace lo
correcto (`"Asistente no configurado"`).

Mensaje estático al usuario, error real a `console.error`/Sentry.

> **Observación de método:** B-2 y B-3 no son bugs de código sino de `docs/DEPLOY.md`. El runbook
> instruye paso a paso hacer exactamente lo peligroso. Corregir el código sin reescribir esas dos
> secciones deja el riesgo intacto.

---

## 2. Severidad alta — antes del primer cliente real

### A-1 · Ningún Server Action valida rol: escalada entre los 5 roles
Las 11 acciones de mutación llaman `requireSession()` y comprueban tenant, pero **ninguna
comprueba rol**. La restricción vive solo en `src/lib/nav.ts` (oculta enlaces) y en el
`requireRole` de algunas páginas — nada de eso protege la invocación directa.

`ALTA_DIRECCION`, excluido de `/diagnosticos` en la navegación y en `diagnosticos/page.tsx:12-17`,
puede navegar por URL e invocar por POST: responder el cuestionario en nombre de otros, regenerar
brechas y plan (ambos con `deleteMany`), cambiar el estado del diagnóstico y borrar evidencias.
Lo mismo `RESPONSABLE_DOMINIO`, cuyo alcance debería limitarse a sus dominios asignados —
`DiagnosticoDominio.responsableId` se modela y se configura, pero **nunca se usa como control**:
la asignación es decorativa.

`guardarRespuesta` tampoco valida el **estado del diagnóstico**: se pueden modificar respuestas de
uno `CERRADO` o `PREPARADO_CERT`, es decir, **alterar un expediente ya emitido**.

Patrón a replicar: `actualizarAccionAction:83` y `validarEvidenciaAction:103` **sí** restringen
correctamente a staff P360.

```ts
// src/lib/session.ts
export const ROLES_ESCRITURA_DIAG: Role[] = [
  ROLES.ADMIN_P360, ROLES.CONSULTOR, ROLES.ADMIN_EMPRESA, ROLES.RESPONSABLE_DOMINIO,
];
export async function assertRole(roles: Role[]) {
  const session = await requireSession();
  if (!roles.includes(session.user.role)) throw new Error("FORBIDDEN");
  return session;
}
```

Y en `guardarRespuesta`, además: estado editable, `dd.incluido === true`, y que un
`RESPONSABLE_DOMINIO` solo responda su dominio (`dd.responsableId === session.user.id`).

### A-2 · No existe bitácora de auditoría — requisito normativo incumplido
No hay ningún modelo `Auditoria`/`AuditLog` en `prisma/schema.prisma`. La única atribución es
`respondidoPorId` (solo el **último** que respondió) y `updatedAt` (se sobrescribe). No queda
registro del valor anterior, de quién validó una evidencia, de quién cambió el estado del
diagnóstico ni de quién regeneró brechas/riesgos/plan.

La Ley 21.719 exige *accountability* demostrable. Un fiscalizador no puede reconstruir quién
declaró qué ni cuándo, y una respuesta puede bajarse de "5" a "0" tras una fiscalización sin
dejar rastro. **La plataforma no puede sustentar el expediente que promete.**

Modelo `AuditEvento` append-only (`empresaId` denormalizado, `actorEmail` como snapshot inmutable,
`valorAnterior`/`valorNuevo` en JSON, IP y user-agent), escrito dentro de la misma transacción que
la mutación, con `UPDATE`/`DELETE` revocados a nivel de rol Postgres.

### A-3 · Regenerar brechas destruye riesgos, plan y trazabilidad de forma irreversible
`brechas/actions.ts:50-63`, `plan/actions.ts:37`, `riesgos/actions.ts:45`

El patrón es `deleteMany` + `createMany`. Como `Riesgo.brechaId`, `AccionTratamiento.brechaId` y
`Evidencia.brechaId` son `onDelete: SetNull`, al borrar las brechas esos registros quedan
huérfanos, y las brechas se recrean con **cuid nuevos**: la reconexión es imposible.

Consecuencias: la matriz de trazabilidad — el corazón del expediente de certificación — queda
vacía; `generarPlanAction` borra **todo el seguimiento manual del cliente** (avances, validaciones
del consultor, responsables) sin confirmación ni advertencia; y las acciones huérfanas siguen
contando en `planTotal`, distorsionando el índice de preparación.

Reconciliar por clave natural en vez de borrar: `Brecha.respuestaId` ya es `@unique`. Cerrar
(`estado: "CERRADA"`, `cerradaMotivo: "RESUELTA_POR_REEVALUACION"`) las que ya no aplican y hacer
`upsert` de las vigentes, sin tocar `estado` ni `responsableSugerido` (son dato de gestión humana).

### A-4 · JWT de 30 días sin revalidación: privilegios revocados persisten
`src/auth.ts:14,41-47` — `session: { strategy: "jwt" }` sin `maxAge`, y el callback `jwt` solo
graba `role`/`empresaId` en el login inicial, sin refrescar nunca contra la BD.

Como toda la autorización se resuelve contra el token: desactivar un usuario (`activo: false`) **no
cierra su sesión** — un empleado despedido conserva acceso hasta 30 días; degradar un rol no surte
efecto hasta el re-login; y `Empresa.activa` **no se consulta en ningún punto** de autenticación ni
autorización (verificado en `authorize`, `requireSession`, `requireRole` y `empresaScope`), así que
desactivar un cliente moroso no le quita el acceso.

`maxAge: 8h`, `updateAge: 15min`, y revalidación contra la BD cada ~5 minutos en el callback `jwt`
(retornando `null` si el usuario o su empresa dejaron de estar activos). Añadir la comprobación de
empresa activa también en `authorize`.

### A-5 · Login sin rate limiting ni bloqueo; `compareSync` bloquea el event loop
`src/auth.ts:20-28`, `login/actions.ts:8-21`

Sin contador de intentos, sin bloqueo temporal, sin backoff, sin CAPTCHA, sin registro de fallos —
contra cuentas cuyos correos están publicados en la propia página de login (B-2). Contraste
llamativo: `/api/chat` **sí** tiene rate limiting; el login no.

`bcrypt.compareSync` (cost 10, ~100 ms) es **bloqueante**: peticiones concurrentes de login congelan
el event loop de toda la instancia → DoS trivial.

Migrar a `bcrypt.compare` asíncrono, rate limit por IP+email (5 intentos / 15 min) en almacenamiento
compartido, y campos `intentosFallidos`/`bloqueadoHasta` en `User`.

### A-6 · Uploads sin whitelist de tipo; Content-Type controlado por el cliente
`evidencia-actions.ts:59-73`, `src/lib/storage.ts:32-40`

Solo se valida tamaño. `file.type` — enviado por el navegador y trivialmente falsificable — se pasa
tal cual a Supabase como `contentType` y queda persistido. Subir un archivo con
`type: "text/html"` o `image/svg+xml` y abrir su URL firmada **ejecuta HTML/JS en el dominio de
Supabase Storage**: XSS almacenado y phishing con dominio de confianza. Toda evidencia es visible
para el staff P360, así que el objetivo natural es el consultor.

Whitelist de MIME **y** extensión (pdf, png, jpg, docx, xlsx), derivar el `contentType` de la
extensión ya validada en vez de confiar en el cliente, e idealmente validar magic bytes.

*Path traversal: no explotable.* `sanitizar()` elimina todo lo que no sea `[a-zA-Z0-9._-]`, y el
resto del path viene de la BD y de `randomUUID()`.

### A-7 · Cero índices en toda la base de datos
`grep "@@index" prisma/schema.prisma` → **0 resultados**. Prisma no indexa FKs automáticamente.

Sin índice quedan, entre otras: `Diagnostico.empresaId` (usada por `empresaScope` en **toda**
consulta de tenant), `Brecha.diagnosticoId`, `Riesgo.diagnosticoId`, `AccionTratamiento.diagnosticoId`,
`Evidencia.respuestaId`, `User.empresaId`. Peor: `prisma.respuesta.count({ where: { valor: null } })`
en el dashboard P360 es un **seq scan sobre la tabla más grande del sistema en cada render**.

A 500 empresas × 3 diagnósticos ≈ 150.000 filas de `Respuesta`. En Supabase con pgbouncer esto
agota el pool. Añadir índices compuestos por los patrones de acceso reales, y desplegarlos con
`CREATE INDEX CONCURRENTLY` sobre tablas con datos.

### A-8 · Ninguna operación multi-paso usa transacciones
`grep "\$transaction" src/` → **0 resultados**

`crearDiagnosticoAction` hace 21 roundtrips secuenciales: si falla en el dominio 7, queda un
diagnóstico con 6 dominios que se renderiza como válido y cuya madurez se calcula sobre un alcance
incompleto, sin señal de error. En los generadores, entre el `deleteMany` y el `createMany` hay una
ventana en la que cualquier lectura ve **cero brechas** → `calcularPreparacion` devuelve
momentáneamente **"LISTO para certificación"**. Y si el `createMany` falla, las brechas quedan
borradas.

Envolver cada secuencia en `prisma.$transaction`, con `timeout`/`maxWait` explícitos por pgbouncer.

### A-9 · Cero tests, cero CI, y el lint falla hoy
No hay archivos de test, ni `.github/`, ni vitest/jest/playwright. Y `npx eslint .` falla:

```
src/components/ChatWidget.tsx:50:21  error  react-hooks/set-state-in-effect
```

Next 16 ya no corre ESLint durante `next build`, por eso el build pasa. Sin CI nadie lo ve y Vercel
lo desplegaría.

Lo más grave: los motores de negocio (`lib/engines/`: madurez, brechas, riesgos, plan, roadmap,
certificación) no tienen **ni una sola prueba**, y calculan los puntajes que el cliente presentará
ante un regulador. Un error de cálculo silencioso es un riesgo legal, no un bug.

GitHub Action con `tsc --noEmit` + `eslint` + `next build` como gate de merge; Vercel configurado
para desplegar solo si CI pasa; tests de `lib/engines/*` con Vitest (son funciones puras, es barato).

### A-10 · La madurez global es engañosa cuando el diagnóstico está incompleto
`src/lib/engines/madurez.ts:64-68` — el global promedia solo las respuestas **contestadas**,
ignorando el avance. (`promedio` retorna `null` con lista vacía: no hay división por cero, ese caso
borde está bien resuelto.)

Caso reproducible: 10 dominios × 10 preguntas, se responde **una sola** con "5" →
`global = 5.0`, `nivelGlobal = "AVANZADO"` ("Cumplimiento optimizado"), con 1 % del diagnóstico
completado. El dashboard de Alta Dirección lo muestra tal cual, y `certificacion.ts:34` lo propaga
como `madurez = 100` con peso 0.30 del índice de preparación.

Un informe que declara "Avanzado" sobre una muestra de 1 pregunta es riesgo reputacional y legal
directo para Procesos360 si el cliente actúa sobre él. Exponer `cobertura` y `confiable` en
`ResultadoMadurez`, no clasificar nivel bajo un umbral (~80 %), y mostrar "Preliminar — N %".

**Decisión de negocio pendiente:** el global pondera **por número de preguntas**, así que un dominio
de 20 preguntas pesa 6,7× uno de 3. Si los 10 dominios de la Ley 21.719 deben pesar igual, hay que
promediar los promedios de dominio. No hay documento en `docs/` que especifique la intención —
debe definirse y documentarse, porque cambia el número que va al informe firmado.

### A-11 · `Evidencia` sin ruta garantizada al tenant; FKs de autoría fantasma
Las cuatro FKs de `Evidencia` (`respuestaId`, `diagnosticoDominioId`, `brechaId`, `accionId`) son
nullable y no hay constraint que exija al menos una: una fila que no pertenece a ninguna empresa es
**legal** — y ocurre en la práctica por A-3. `descargarEvidenciaAction:130-141` deriva el tenant
solo vía `respuesta`; cuando es `null`, la comparación `undefined !== empresaId` deniega **por
accidente de tipos, no por diseño**. Esto además hace inviable RLS en Supabase.

`respondidoPorId` (`schema.prisma:154`) y `subidoPorId` (`:182`) se declaran **sin `@relation`**:
no hay FK en Postgres. Y `User.empresaId` es `onDelete: Cascade`, así que borrar una empresa borra
sus usuarios y deja toda la autoría apuntando a IDs inexistentes. Es imposible responder
"¿quién declaró este control?" — la pregunta central de una fiscalización.

Denormalizar `empresaId` (NOT NULL) en `Evidencia`, `Respuesta`, `Brecha`, `Riesgo` y
`AccionTratamiento`; declarar las relaciones de autoría con `onDelete: Restrict`; cambiar
`User.empresaId` a `Restrict` y usar el borrado lógico ya existente (`User.activo`).

### A-12 · Sin error boundaries: errores Prisma normales rompen la pantalla
No existe **ningún** `error.tsx`, `global-error.tsx` ni `not-found.tsx` en `src/app`, y ninguna
acción envuelve Prisma en try/catch. Disparadores confirmados y de uso **normal**, no ataques:
`empresa/actions.ts:148` (cambio de email duplicado → P2002), `empresa/actions.ts:47` y
`admin/empresas/actions.ts:33` (RUT duplicado, con TOCTOU entre el chequeo y el insert),
`admin/catalogo/actions.ts:72` (delete con id arbitrario, sin Zod → P2025).

### A-13 · Cero observabilidad
Sin Sentry, sin logging estructurado, sin health check. Los únicos `console.*` están en scripts CLI
(*buena noticia colateral: no hay logging de datos sensibles porque no hay logging en absoluto*).
Los bloqueantes B-1 y A-12 ocurrirían de forma completamente invisible.

`@sentry/nextjs` (wizard para App Router, ~15 min) y `src/app/api/health/route.ts` con `SELECT 1`.

### A-14 · Sin paginación en ningún listado
`grep "take:|skip:|cursor:" src/` → **0 resultados**. Para staff P360, `empresaScope` devuelve `{}`,
así que `listarDiagnosticos` trae **todos los diagnósticos de todas las empresas** y los renderiza
completos. `dashboard/page.tsx:43` trae el conjunto entero para luego hacer `.slice(0, 8)` — el
trabajo de BD y la transferencia ya se pagaron.

---

## 3. Severidad media

| # | Hallazgo | Ubicación |
|---|---|---|
| M-1 | Sin headers de seguridad: no hay CSP, HSTS, X-Frame-Options, nosniff ni Referrer-Policy, y no existe `middleware.ts` | `next.config.ts` |
| M-2 | Umbrales de madurez con huecos: la tabla declara `CRITICO ≤1.4` / `BAJO ≥1.5`, pero `clasificarMadurez` usa `≤1.4` / `≤2.4`. Los valores 1.45, 2.45, 3.45, 4.45 **son alcanzables** (redondeo a 2 decimales) y caen en el hueco: el informe diría "Bajo (1.5–2.4)" sobre un 1.45 | `constants.ts:65-84` |
| M-3 | `preguntaId` se puebla con el id de la **respuesta**. Hoy inocuo (el motor solo lee `valor`), pero `check-engines.ts:29` — la única verificación de los motores que existe — **replica el bug en vez de detectarlo** | `data/diagnosticos.ts:234` |
| M-4 | Fechas date-only parseadas como UTC: `new Date("2026-07-19")` es 18-jul en Chile (UTC-4). Desplaza acciones críticas de horizonte en el roadmap y marca como vencidas acciones que vencen hoy | `evidencia-actions.ts:85`, `diagnosticos/actions.ts:46-47,104-105` |
| M-5 | Rate limit del chatbot en `Map` de memoria: en serverless el límite real es 4N por usuario con N instancias, y un cold start lo resetea. El `Map` nunca purga | `api/chat/route.ts:16-28` |
| M-6 | Enum-like como `String` sin CHECK, justificado por un comentario obsoleto ("SQLite en desarrollo") cuando el provider ya es `postgresql`. `avance: 500` es escribible desde Studio o el seed | `schema.prisma` (16 campos) |
| M-7 | Sin optimistic locking: dos responsables sobre la misma pregunta → last-write-wins silencioso. `updatedAt` existe pero nunca se usa como token de versión | `dominios/[orden]/actions.ts:45-54` |
| M-8 | Helpers de datos sin scope de tenant (`getRiesgos`, `getAcciones`, `getEvidenciasDiagnostico`, `getRespuestasPorDominio`, `getTrazabilidad`, `getPreparacionInput`). **Hoy no explotable** — las 6 páginas consumidoras llaman `getDiagnosticoFull` antes — pero la garantía es un comentario, no el sistema de tipos. Es el mismo patrón que ya falló en B-1 | `data/diagnosticos.ts:88,97,106,121,141,160` |
| M-9 | N+1 y recálculo completo de madurez en cada render (dashboard, madurez, reporte, reporte-técnico, certificación, roadmap). Nada materializado | `data/diagnosticos.ts:73-85,224` |
| M-10 | Política de contraseñas de 6 caracteres sin complejidad; bcrypt cost 10; `hashSync` bloqueante | `empresa/actions.ts:133,156,171` |
| M-11 | Enumeración de usuarios por canal temporal: usuario inexistente responde en ~1 ms, existente en ~100 ms | `auth.ts:24-28` |
| M-12 | Cascada de catálogo en conflicto con `Restrict`: borrar un dominio con respuestas falla con error crudo de Postgres. El catálogo no es versionable | `schema.prisma:91` vs `:148` |
| M-13 | Fechas sin validar (`z.string()`) llegan a `new Date()` → `Invalid Date` y excepción Prisma sin capturar | `diagnosticos/actions.ts:104-105` |
| M-14 | `next-auth@5.0.0-beta.31` en producción. Riesgo acotado (uso mínimo: credentials + JWT, sin adapter) pero conviene fijar la versión exacta y usar `npm ci` | `package.json:24` |

## 4. Severidad baja

- **`orderBy` alfabético sobre `prioridad`** (`data/diagnosticos.ts:101`): el orden real es ALTA,
  BAJA, MEDIA. `plan/page.tsx:18` lo corrige en memoria, pero otros consumidores no.
- **RUT sin normalizar** pese a ser `@unique`: `"76.123.456-7"` y `"761234567"` conviven como
  empresas distintas. Falta validación de dígito verificador.
- **Accesibilidad mínima**: 1 sola ocurrencia de `aria-*` en todo `src/`. `RadarChart.tsx` —
  el gráfico central del reporte — es un SVG sin `role="img"` ni descripción textual.
- **Reporte PDF**: funciona, pero `globals.css` no define `@page` ni `break-inside`, y las listas
  se truncan (`criticas.slice(0, 12)`) **sin indicar que hay más elementos** — un reporte de
  cumplimiento que omite brechas silenciosamente es engañoso.
- **Comentarios de esquema obsoletos** (`schema.prisma:2`, `constants.ts:3`) que sostienen la
  decisión de M-6.

---

## 5. Verificado como correcto

Para calibrar el informe, esto se revisó y está bien resuelto:

- **Secretos:** cero credenciales hardcodeadas en `src`, `scripts`, `prisma`, `docs`, `public`.
  `git log --all --full-history -- .env* prisma/*.db` no devuelve nada: ningún `.env` ni SQLite fue
  commiteado jamás. `.gitignore` cubre `.env*`, `/prisma/*.db` y `/uploads`.
- **Chatbot:** autenticado (401 sin sesión), historial acotado, `thinkingBudget: 0`, y `contexto.ts`
  inyecta **solo agregados numéricos** anclados en `session.user.empresaId` — nunca comentarios,
  evidencias ni nombres. Un prompt injection no puede extraer datos ajenos porque nunca están en el
  contexto. La API key nunca llega al navegador; `storage.ts` y `contexto.ts` llevan `import "server-only"`.
- **Sin XSS reflejado:** no hay `dangerouslySetInnerHTML` en ningún punto del repo.
- **Aislamiento de tenant (base):** `assertAccesoDiagnostico` y `getDiagnosticoFull` validan
  correctamente y usan `notFound()` en vez de 403 (no filtran existencia). `empresaScope` usa el
  centinela `"__none__"` para fallar cerrado cuando `empresaId` es `null`. Las 18 páginas de `(app)`
  invocan `requireSession`/`requireRole` — hoy no hay ninguna ruta descubierta.
- **Sin escalada horizontal en gestión de usuarios:** `guardarUsuarioAction:143` impide que un
  `ADMIN_EMPRESA` cree roles P360 y `:147` valida pertenencia.
- **Storage:** bucket privado, URLs firmadas de 1 h, `randomUUID()` en el path, service_role no
  expuesta al cliente.
- **Calidad de build:** `tsconfig.json` con `strict: true`, sin `ignoreBuildErrors` ni
  `ignoreDuringBuilds`. `npx tsc --noEmit` sale 0. Build limpio en 3 s, 23 rutas.
- **Dependencias:** `npm audit` → **0 críticas, 0 altas**. Las 2 moderadas son `postcss <8.5.10`
  (GHSA-qx2v-qp2m-jg93) anidado dentro de `next`: bug de build-time CSS, no explotable aquí. El
  "fix" que propone npm es bajar a Next 9.3.3 — **no aplicarlo**.
- **CSRF** cubierto por next-auth y por la protección nativa de Server Actions de Next 16.
- **Mensaje de login genérico** (`login/actions.ts:18`), sin enumeración por respuesta.

---

## 6. Plan de remediación

**Semana 1 — bloqueantes (obligatorio antes del deploy)**
B-1 IDOR · B-2 seed y panel demo · B-3 migraciones · B-4 backups · B-5 `.env.example` +
`GEMINI_API_KEY` · B-6 fugas de error. Reescribir las secciones 3 y 7 de `DEPLOY.md`.

**Semana 2 — control y visibilidad**
A-1 roles en Server Actions (11 archivos, el trabajo más extenso) · A-4 sesión · A-5 rate limiting ·
A-6 whitelist de uploads · A-9 CI + arreglar el lint · A-12 error boundaries · A-13 Sentry + health ·
M-1 headers de seguridad.

**Antes del primer cliente real**
A-2 bitácora de auditoría · A-3 upsert en vez de borrado destructivo · A-7 índices · A-8
transacciones · A-10 cobertura de madurez (+ decidir la ponderación) · A-11 tenant en `Evidencia`
y FKs de autoría.

**Deuda planificable**
A-14 paginación · M-2 a M-14 · sección 4.

---

## 7. Conclusión

El riesgo de mayor consecuencia no es ninguno de los bloqueantes por separado, sino el conjunto
**A-2 + A-3 + A-11**: hoy es posible modificar un expediente de certificación ya emitido, destruir
la trazabilidad brecha→riesgo→acción→evidencia y perder la atribución de autoría — sin que quede
registro de nada de ello.

Para una plataforma cuyo producto **es** la trazabilidad del cumplimiento, eso no compromete la
implementación: compromete la propuesta de valor.
