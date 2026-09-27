# Forge: consumo de tokens y optimización sin recortar calidad

Auditoría local del **2026-09-12 (Argentina; 2026-09-13 UTC)**. Fuente revisada: zero-pi **0.1.78**, commit del monorepo `d1feb5a`; paquete instalado zero-pi **0.1.78** y pi-subagents **0.55.0**, según sus `package.json`. Las versiones del runtime importan: no extrapolar estas conclusiones a otra instalación sin verificarla.

**Resultado histórico (auditoría de 0.1.78, no el comportamiento Unreleased):** hay trabajo evitable en los traspasos y riesgos de crecimiento del contexto. Primero conviene reparar la medición y hacer explícito el aislamiento; después comparar alternativas. **No se midió un porcentaje de ahorro ni se demostró equivalencia de calidad.** La entrega inicial de auditoría solo cambió documentación/empaquetado. La implementación posterior se registra en §7: cambia prompts y contabilidad, no modelos, thinking ni configuración del usuario.

## 1. Qué estamos midiendo

No confundir:

- **Tokens nuevos:** `input + output`, en los contadores normalizados del runtime.
- **Caché:** `cacheRead` y `cacheWrite`, separados. Una lectura de caché no es salida generada ni implica el mismo precio que entrada nueva.
- **Contexto:** tamaño del material de una llamada, no la suma de todos los tokens de una sesión.
- **Costo USD reportado:** depende de la información de precios del proveedor/runtime. Un `cost: 0` no demuestra que no se consuman tokens, cuota de suscripción o capacidad.
- **Costo de Forge completo:** padre + hijos + reintentos + resúmenes/compacciones. No sumar dos veces uso de hijos si ya está incluido en un total de herramientas del padre.

Fuentes: `extensions/zero-cost.ts:20–27, 165–167, 184–202`; documentación instalada de Pi `docs/session-format.md`, tipos `Usage`, `ToolResultMessage` y `CompactionEntry`. El reporte actual de zero-cost suma metadatos de hijos `zero-*`, **no es un medidor del costo completo del padre**.

## 2. Medición local y sus límites

Se ejecutaron las funciones reales `readAllPhaseMetas({cwd: "/home/gon/zero/packages/zero-pi"})`, `aggregateRun`, `parseRunLine`, `readRunRecords` y `aggregate` del código revisado. Snapshot tomado el 2026-09-12; los archivos siguen creciendo.

| Dato observado | Resultado |
| --- | ---: |
| Metadatos normalizados recuperados por el lector de zero-cost | 193 |
| Metadatos sin slug reconocible | 159 |
| Metadatos con slug reconocible | 34 |
| Líneas no vacías en `~/.pi/zero-runs.jsonl` | 139 |
| Registros aceptados por `parseRunLine`, también únicos tras deduplicar | 5 |
| Registros válidos v2 | 5 |
| Pares fase/modelo en la agregación | 8 |
| Pares que alcanzan `MIN_V2_SAMPLES = 5` | 0 |

Distribución de los **193 metadatos recuperados**, no de un único Forge ni de una cohorte comparable:

| Fase | Invocaciones | Input | Output | Cache read |
| --- | ---: | ---: | ---: | ---: |
| clarify | 10 | 69.076 | 33.580 | 1.017.273 |
| explore | 25 | 3.124.450 | 434.904 | 43.003.372 |
| plan | 24 | 1.974.887 | 705.864 | 26.064.997 |
| analyze | 8 | 378.345 | 111.245 | 1.887.029 |
| build | 80 | 11.315.661 | 2.352.438 | 607.231.866 |
| veredicto | 46 | 5.819.102 | 861.611 | 82.697.705 |
| **Total** | **193** | **22.681.521** | **4.499.642** | **761.902.242** |

Cache write total: **4.696.843**. Build concentra aproximadamente **50,3 % de input + output** en esta muestra. Sirve para orientar investigación, **no** para atribuir desperdicio: tiene más invocaciones y tareas distintas. El rango de timestamps recuperados va del 2026-07-08 al 2026-09-13 UTC; mezcla versiones, modelos, proyectos y posibles reanudaciones. No demuestra el comportamiento de todos los runs de 0.1.78.

### Problemas concretos de medición

1. **Slug extraído de texto que el runtime redacta.** `extractSlug()` busca `.sdd/<slug>/` o `Slug:` dentro de `meta.task` (`extensions/zero-cost.ts:67–80, 112`). En pi-subagents 0.55.0, `src/runs/foreground/execution.ts:155–158` y `src/runs/background/subagent-runner.ts:1957` escriben `task: PROMPT_REDACTED`; `src/shared/utils.ts:20` define `[prompt redacted]`. En el subconjunto de 150 metadatos `zero-*` con usage encontrado bajo las rutas nativas de sesiones, los 150 tenían ese marcador y `cost: 0`. No desactivar la redacción para recuperar el slug: hace falta una asociación estructurada externa al texto del prompt.
2. **Selección por slug, no por identidad de ejecución.** `selectRunMetas()` filtra solo por slug; `readAllPhaseMetas()` recorre las carpetas de sesiones globales, además del cwd y padres (`extensions/zero-cost.ts:121–136`; `extensions/zero-cost-extension.ts:59–85`). Un slug reutilizado puede mezclar ejecuciones o proyectos. La deduplicación del lector no resuelve esa identidad.
3. **Presentación incompleta.** `aggregateRun()` suma cache write, pero `formatReport()` muestra solo cache read bajo `cache`; la agregación conserva solo el último modelo de cada fase aunque pueda haber varios, y la tabla no desglosa modelos. La duración es suma de duraciones de hijos, no necesariamente tiempo de pared (`extensions/zero-cost.ts:139–210, 230–251`).
4. **Autotune sin muestra suficiente.** El parser descarta registros fuera de contrato; no conviene flexibilizarlo hasta aceptar datos ambiguos (`extensions/autotune.ts:128–180`). Ningún par de la muestra llega al mínimo. Además, `decideAdjustments()` propone escaladas para build/plan según defectos, no descensos de modelo para ahorrar (`extensions/autotune.ts:595–639`). No es un optimizador general de tokens.
5. **Propiedad ambigua del registro.** El orquestador prescribe un único `RunRecord` terminal, mientras el prompt de veredicto menciona su persistencia por Cortex y `zero-runs.jsonl` (`prompts/orchestrator.md:456–525`; `prompts/phases/veredicto.md:7–14`). La contradicción permite confusión de responsabilidades; esta auditoría no atribuye cada línea inválida a un autor.

La afirmación «sin `*_meta.json` no hay costo recuperable» es demasiado fuerte: las sesiones de Pi pueden conservar `usage` en mensajes/resúmenes. El lector **actual** de zero-cost no reconstruye esos datos; recuperar historia requiere correlación y deduplicación, no adivinarla.

## 3. Controles existentes que hay que conservar

| Control | Evidencia y alcance |
| --- | --- |
| Exclusión de contexto global y catálogo de skills | `extensions/sdd-agents.ts:118–126` genera `inheritProjectContext: false`, `inheritSkills: false`, `systemPromptMode: replace`. pi-subagents `src/runs/shared/pi-args.ts:628–650` traduce esas opciones a flags de Pi. |
| Briefs por referencia | `prompts/orchestrator.md:164–171`: pasar rutas, no copiar requisitos/diseño/findings. |
| Build por lotes | `prompts/orchestrator.md:227–272`: hasta 4 tareas / 800 líneas estimadas por lote, con excepción para una tarea individual grande; revisión al final. Es una regla de prompt, no prueba de ejecución. |
| Exploración acotada al pedido | `prompts/phases/explore.md:19–34`: presupuestos orientativos de 20/40 llamadas y checkpoint intermedio. |
| Búsqueda dirigida | `prompts/phases/build.md:16–26` y `veredicto.md:16–35`: raíces y archivos concretos, evitar lecturas repetidas sin motivo. |
| TDD y revisión independiente | `prompts/phases/build.md:30–52` y `veredicto.md:41–63`: módulos cargados cuando aplican, evidencia y tests verificados por el reviewer. |

Ocultar tarjetas, acortar el render de resultados o cambiar el HUD **no demuestra ahorro de tokens**: pi-subagents distingue controles visuales del contenido enviado al modelo (`docs/configuration.md:50` del runtime instalado).

## 4. Optimización propuesta, en orden

Lista **histórica** de propuestas de la auditoría inicial. §7 distingue la primera tanda implementada de lo que sigue diferido.

### P0 — Medición confiable antes de ajustar modelos

- Asociar `project/cwd + forgeRunId + phase + round + batch + childRunId` mediante un registro del orquestador y receipts del runtime; conservar la redacción de prompts.
- Registrar modelo/proveedor/thinking realmente resueltos, no solo los configurados; separar costo desconocido de cero reportado.
- Mostrar input, output, cache read/write, intentos fallidos y cobertura parcial de metadatos. Separar duración sumada de tiempo de pared.
- Incluir costo propio del padre y compacciones sin duplicar usage anidado.
- Un único escritor determinista para el `RunRecord` terminal. Veredicto devuelve evidencia y decisión; no escribe el log de autotune.

**Verificar:** fixtures con tasks redactados, slugs iguales en proyectos/runs distintos, varias rondas, resumes, retries, metadata duplicada, costo desconocido y reportes parciales. Las sumas deben reconciliarse con el runtime antes de usar el reporte como benchmark.

### P1 — Contexto fresco explícito y handoff completo

Hoy **fresh es el fallback, no una garantía impuesta por zero**. `buildAgentFile()` no declara `defaultContext` y los prompts no imponen el argumento de lanzamiento. pi-subagents resuelve contexto explícito → configuración global → default del agente → fresh (`src/shared/fork-context.ts:72–80`). Desactivar AGENTS/skills no elimina una conversación padre heredada por fork.

- Pasar **`context: "fresh"` explícito** en cada fase/lote y verificar el contexto resuelto en el receipt. `defaultContext: fresh` solo no basta: la configuración global tiene precedencia.
- Antes de depender de fresh, persistir `request.md` verbatim y asignar un dueño al handoff de `findings.md`. Explore se declara read-only, pero sus instrucciones hablan de escribir findings; plan permite redescubrir si faltan (`prompts/phases/explore.md:13–14, 27–34`; `prompts/phases/plan.md:11–12`). Usar persistencia de output del runtime sin darle permiso de escritura de producto al explorador.
- Pasar rutas absolutas, alcance, tareas del lote, restricciones y bloqueantes. Comprobar existencia/completitud antes de avanzar.

**Verificar:** con configuración global fork y un padre cargado de conversación irrelevante, el hijo resuelve fresh, recibe el pedido y convenciones del proyecto, y llega al mismo alcance/criterios de aceptación. No se demostró que los runs históricos auditados hayan usado fork.

### P1 — Sacar duplicación, no evidencia

Build pide la tabla TDD **en disco y en el envelope** (`prompts/phases/build.md:45–49`). Mantener evidencia acumulativa por tarea en disco y devolver estado, rutas y excepciones, sin repetir la tabla completa al padre. Usar `outputMode: "file-only"` para entregables largos cuando corresponda; el padre debe leer la decisión y controlar los artefactos. Veredicto sigue leyendo la evidencia completa y ejecutando tests por su cuenta.

**Verificar:** varios lotes conservan las filas anteriores; faltantes/fallos llegan al padre; el reviewer detecta los mismos defectos. El formato compacto nunca debe ocultar un bloqueo.

### P1 — Sincronización de métricas fuera del contexto del LLM

El orquestador pide traer hasta **200 registros** de Cortex y reanexarlos por cada Forge (`prompts/orchestrator.md:431–449`). Mover transporte/validación/deduplicación a código o a una operación MCP por lotes que devuelva solo conteos y errores. Conservar recall de decisiones relevantes: no confundir memoria útil del proyecto con transportar JSON de métricas.

**Verificar:** mismos registros válidos y mismas decisiones de autotune, tolerancia a desconexión, cero registros completos repetidos en contexto. El ahorro real depende del tráfico observado; no se midió en esta auditoría.

### P2 — Acotar replan sin saltarse analyze

`analyze → replan` está expresamente fuera del cap build/veredicto y no tiene un cap propio en `prompts/orchestrator.md:37–39, 214–218`. El retry de entrega fallida es distinto de un analyzer que devuelve válidamente `replan` una y otra vez.

Proponer un límite separado y durable de replans de readiness, con valor a decidir antes de implementar. Al agotarlo, detenerse como **bloqueado/no verificado**, exponer defectos pendientes; jamás convertirlo en `continue` para ahorrar.

**Verificar:** rechazo repetido, reanudación y fallos de entrega; ninguno compra rondas nuevas ni permite build con blockers.

### Después: experimentos de perfil y tamaño de lote

Mantener inicialmente modelos y thinking actuales. Una vez que se puede medir:

- Comparar esfuerzo/modelo de clarify/explore sobre tareas equivalentes.
- Evaluar lotes por superficie compartida de archivos: lotes demasiado pequeños repiten setup, demasiado grandes acumulan contexto. No cambiar el límite a ciegas.
- Probar un padre menos costoso solo si cumple el mismo contrato de routing, gates y recuperación. La orquestación también exige calidad.

No reducir TDD, cobertura, pruebas independientes ni fuerza de veredicto como primera palanca de ahorro. No imponer presupuestos duros que dejen un writer cortado a mitad de una modificación.

## 5. Cómo demostrar ahorro sin perder calidad

1. Fijar revisión de código, versiones del harness, modelos, thinking, comandos, criterios de aceptación y estado inicial. Usar checkouts desechables equivalentes; no comparar dos features distintas ni mezclar identidades/cuentas de proyectos.
2. Armar casos: fix localizado, cambio multiarchivo, integración con contrato, regresión sembrada y docs-only. Incluir casos donde el resultado correcto es `corregir` o `replantear`.
3. Correr baseline/candidato varias veces por caso; declarar número de repeticiones antes de comenzar. Separar caché fría/caliente y controlar el orden. Cambiar una palanca por experimento.
4. Medir padre e hijos: tokens separados por clase, costo con su fuente, tiempo de pared, tools, relecturas, errores de proveedor, rondas y replans.
5. Evaluar con los mismos tests y revisión independiente: aceptación cubierta, defectos detectados/escapados, evidencia TDD y recuperación tras interrupción. Un `pasa` autodeclarado no prueba equivalencia.
6. Aceptar solo cuando la evaluación no muestra pérdida de calidad y la métrica elegida mejora; reportar dispersión y limitaciones. Una muestra finita no demuestra equivalencia universal.

## 6. Validación histórica de la entrega documental

- Auditoría del código de zero-pi y del runtime instalado; segunda revisión read-only con contexto fresh sobre prompts/aislamiento.
- `npm test` desde `packages/zero-pi`: **573 tests, 573 pasan, 0 fallan** en la corrida local del 2026-09-12. Es baseline del paquete, **no** un A/B de ahorro o calidad.
- `npm run pack-check`: **71 archivos** en el tarball previsto; incluye `TOKEN-EFFICIENCY.md` gracias a la entrada añadida en `package.json#files`. No se publicó el paquete.
- `git diff --check -- packages/zero-pi`: sin errores. Repro mínimo con `parseMeta({agent: "zero-build", task: "[prompt redacted]", usage: {input: 1, output: 1}})` devuelve `slug: null`.
- Se preservan los cambios ajenos ya presentes en el monorepo. No se publica npm, no se cambia la instalación activa y no se ejecuta Forge sobre un producto para generar una cifra artificial de ahorro.

### Fuentes locales del runtime

Las referencias `src/...` y `docs/...` de pi-subagents se resolvieron bajo `/home/gon/.pi/agent/npm/node_modules/pi-subagents/`. La documentación de Pi se leyó bajo `/home/gon/.local/share/mise/installs/node/26.2.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/`. Los metadatos se inspeccionaron localmente y no se copian a esta documentación: pueden contener datos de otros proyectos. Las rutas/líneas citadas describen la revisión auditada, no una API estable futura.


## 7. Primera tanda implementada (Unreleased)

Esta sección reemplaza las afirmaciones de comportamiento actual de §1–4;
los números y referencias anteriores se conservan como evidencia histórica,
no como medición de este candidato. **Sin porcentaje de ahorro ni A/B de calidad.**

### Identidad, cobertura y costos

- `zero_execution` es una tool Pi registrada por `zero-execution-extension.ts`.
  Forge la invoca con `start` (request completo verbatim), `resume`, `attempt`,
  `attach`, `status`, `findings` y `analyze`; los prompts conectan todos los seams.
  No lanza agentes ni parsea/re-escribe workflowScript.
- Estado: `.sdd/<slug>/execution.json` apunta a
  `.sdd/.executions/<runId>.json`, con cwd canónico, UUID, intentos con fase/
  ronda/lote, identidad workflow y receipt/child. Las escrituras de ledger son
  atómicas, con lock local que falla cerrado; lock huérfano requiere intervención
  humana tras comprobar ausencia de writer. No hay reset del cap.
- Async se conserva: un workflow por fase/lote, `async: true`, `context: fresh`
  explícito arriba y en el hijo. `attach` recibe el runId/asyncDir real del
  receipt de lanzamiento. `status` lee solo workflow-receipt.json/status.json
  de ese path, valida cwd/workflow/key/agente/contexto y childRunId, y busca
  nombres exactos `_0_meta.json` en el directorio de sesión identificado y en
  `.pi/subagents/artifacts` del cwd. No recorre sesiones globales, padres ni
  texto de tasks. Workflow multi-hijo o lineage de child-resume no es compatible
  con este contrato estrecho y queda parcial.
- Los snapshots preservan usage tras limpieza de artifacts. Un UUID explícito
  elige un run; slug/default elige una sola ejecución reciente del cwd, no su
  suma histórica. Fresh con mismo slug requiere confirmación de los artifacts
  existentes y genera UUID nuevo; resume conserva UUID/costos/replans y lanza
  **hijos nuevos fresh**, no revive sesiones con usage acumulativo ambiguo.
- Metadatos ausentes/legacy/invalidos quedan parciales o sin atribución, no cero.
  Intentos fallidos con metadata se incluyen. Caché read/write separada, todos
  los modelos reportados por fase y USD `unknown` si falta; costo reportado cero
  no prueba consumo gratis. Duración sumada no es pared.
- Límite explícito: **solo hijos registrados**, no padre/compacciones. Un hijo
  omitido por el orquestador no es detectable por este ledger. Modelo/proveedor/
  thinking no se verifican independientemente del string de modelo reportado.
  Artifacts temp/custom, metadata deshabilitada, interrupción antes de attach y
  receipts limpios antes de capturarlos pueden impedir atribución. No reconstruye
  historia desde sesiones y no debe usarse como benchmark completo.

### Contexto fresco y handoff sin quitar capacidades

`defaultContext: fresh` se agrega a las seis definiciones, pero la garantía de
lanzamiento depende del argumento explícito exigido por el prompt y de revisar
el receipt resuelto. No hay enforcement de scripts arbitrarios. Se conservan
rules/requirements/steering/constitución, briefs por paths absolutos, gates de
artefactos completos, límites de lotes y revisión independiente.

Se verificó un gotcha del runtime real: `read,bash` cuenta como mutation-capable
para su output injector, aunque explore prohíba escribir por prompt. No se quitó
bash (conserva git/diagnóstico) ni se afirmó sandbox. Explore usa `output: false`
arriba y en el hijo, `outputMode: inline`, `artifacts: true`: no recibe una
instrucción de escritura contradictoria. Retorna findings completos; el runtime
los guarda en el debug `_output.md`. Tras completion, la operación **parent-owned
`findings`** copia ese output identificado a `findings.md`, sin transportar la
tabla/reporte en el brief. El padre revisa completitud antes de plan. El workflow
retorna solo ok/runId; no retransmite el reporte entero como su valor final.
Si debug output está deshabilitado o perdido, se bloquea el handoff.

Build y support/strict-tdd mantienen filas acumulativas por tarea/attempt en
`tdd-evidence.md`; envelope devuelve solo paths/estado/excepciones. Veredicto
lee disco y corre tests por su cuenta. No escribe `zero-runs.jsonl` ni la traza
terminal Cortex; dueño único del outcome terminal: orquestador (sin transporte
Cortex nuevo ni afirmación de escritor terminal mecánico).

### Cap separado de readiness

Contrato aprobado: máximo **2 decisiones analyze/replan por ejecución**; la
segunda detiene inmediatamente **bloqueado/no verificado**. El contador deriva
de outcomes por attemptId: repetir la misma decisión no cobra dos veces,
cambiarla da error. Resume conserva todo; legacy/corrupción falla cerrado.
Fallas de entrega no son replans ni rondas build/veredicto. Nunca saltear analyze
ni convertir replan en continue. Los gates y el orden de llamadas son política
de prompt; la tool impone identidad/contabilidad/cap a las operaciones invocadas.
No genera un RunRecord `cap-reached` falso cuando solo agotó readiness.

### Spec-fidelity y validación

Fixture `extensions/fixtures/forge-runtime.json`: captura real local de
pi-subagents 0.55.0 (workflow receipt v1, status con cwd/sessionId, meta con task
redactado). IDs/paths se anonimizan, se conservan nombres/campos/tipos y usage.
La captura original tenía dos hijos; tests derivan explícitamente un workflow
single-child y verifican rechazo de shapes incompatibles. No se inventa
metadataPath en receipts: se deriva el filename exacto del child identificado,
según `src/shared/artifacts.ts#getArtifactPaths`.

Tests opcionales contra runtime instalado usan su lector real de receipts,
resolver de fresh sobre global fork, output injector/outputPath(false) y
persistencia de artifacts; también el validador real de tool schema de Pi.
Se ejecutan sin lanzar subagentes ni modificar configuración/instalación.
Fixtures portables cubren redacción, identidades/cwd, resumes, duplicados,
reintentos, costo desconocido, cobertura parcial, corrupción y cap idempotente.
Tests de prompts verifican las invocaciones y handoffs; **no son prueba de que
un LLM siempre obedezca ni de equivalencia de calidad end-to-end**.

Diferido: padre/compacciones, captura automática de eventos async y recuperación
histórica/temp/custom, transporte mecánico de métricas Cortex, pricing/provider/
thinking verificado y experimentos de modelos/effort/batching. No se publicó,
commiteó ni pusheó. La aplicación local posterior fue autorizada por el usuario;
no se cambiaron modelos, thinking, credenciales ni settings.

### Resultado de checks de esta implementación

- RED inicial: nueva suite de ejecución falla por módulo inexistente; las
  regresiones de prompts/zero-cost fallan contra el comportamiento viejo.
- TRIANGULATE RED: metadata tardía no se recuperaba, workflow podía adjuntarse
  a otra ejecución, y `.executions` aparecía como feature; fixes quirúrgicos y
  regresiones correspondientes pasan. Prueba real del output injector detectó
  el conflicto de bash; se mantuvieron capacidades con output:false + copia padre.
- GREEN del implementador: tests focalizados **60/60**, suite **588/588**.
- Revisión independiente detectó workflow completo con hijo failed/stopped: se
  agregó verificación de `status.steps` por key/agent/runId y resultado terminal.
  Se preserva el costo del hijo fallido, pero no se permite findings/analyze.
- Padre reprodujo en RED ese defecto y el manejo incorrecto de errores de tools
  (`execute` debe lanzar, no retornar `isError`). Ambos corregidos. Suite final:
  **591/591**, incluidos checks contra runtime instalado, sin skips locales.
- `npm run pack-check`: **73 archivos**, incluye ambos módulos nuevos y esta
  documentación; no publica. `git diff --check` sin errores; index vacío.
- No se ejecutó Forge end-to-end ni se lanzaron subagentes para medir ahorro.

### Aplicación local autorizada — 2026-09-12

Se copió el tarball local (73 archivos verificados byte a byte) a
`/home/gon/.pi/agent/npm/node_modules/@gonrocca/zero-pi/`, sin publicar npm ni
cambiar el número de versión 0.1.78. Es un parche local Unreleased: una
reinstalación/update puede sobrescribirlo.

Backup del paquete anterior y agentes:
`/home/gon/.pi/backups/zero-pi-before-token-efficiency-20260912-225938/`.

Se regeneraron los seis agentes con Jiti; explore conserva `read, bash` y
`defaultContext: fresh`. El loader real de Pi cargó `zero-execution-extension.ts`
y `zero-cost-extension.ts`: 2 extensiones, 0 errores. Importar TS directamente
bajo node_modules con Node strip-types fue rechazado; Jiti es el loader usado
para la verificación posterior. Reiniciar Pi para tomar el parche en sesiones
abiertas. No se reinició ni se interrumpió ninguna sesión activa.
