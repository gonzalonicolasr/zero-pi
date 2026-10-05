# Contrato `.sdd/<slug>/` compartido entre zero-pi y el mod forge

zero-pi (`/forge` en pi) y el mod **forge** de Claude Code
(`github.com/gonzalonicolasr/claude-code-forge`, `~/projects/forge`) son dos
orquestadores del mismo SDD. Cada uno tiene sus propios prompts y su propio
código, pero los dos leen y escriben el mismo directorio `.sdd/<slug>/`. Este
archivo fija lo que tiene que ser igual en los dos lados. Si cambiás algo de
acá, cambialo en los dos repos en la misma tanda de trabajo.

## Tareas paralelas: `[P]`

- Una tarea es candidata a correr en paralelo si su línea de cabecera
  (`### T002 — Título`, `- [ ] **T002. Título**` o `## [ ] T002 — Título`)
  contiene el token literal `[P]`. Va **después** del título
  (`### T002 — Agregar parser [P]`), nunca entre el id y el guion, porque el
  parser de `/zero-validate` espera `T### —` pegados.
- `[P]` es una propuesta del plan, no una orden. El código la confirma: dos
  tareas sólo comparten tanda si ningún path de sus `files:` coincide (después
  de normalizar los paths contra el code root y sacar el sufijo `(new)`).

## Tandas (`waves`)

Algoritmo determinístico. Las dos implementaciones dan el mismo resultado para
el mismo `tasks.md`:

1. Se recorren las tareas sin marcar (`[ ]`) en el orden del archivo.
2. Una tarea es *elegible* si cada id de su `depends:` ya está marcado `[x]` o
   pertenece a una tanda anterior.
3. La tanda actual arranca con la primera tarea elegible. Se le suman, en orden,
   las siguientes tareas elegibles con `[P]` cuyos `files:` no se pisan con los
   de ninguna tarea ya incluida, hasta **3 tareas** (`PARALLEL_MAX`). Para entrar
   con otras, la primera tarea también tiene que tener `[P]`. Si no, la tanda
   es de una sola tarea.
4. Las tareas sin `[P]` y las de una sola tarea siguen el loteo secuencial de
   siempre (hasta 4 tareas u 800 líneas por lote), con una excepción: un lote
   secuencial **se corta antes** de una tarea `[P]` que, junto con las
   siguientes, podría abrir una tanda de 2 o más. Si no, un lote secuencial se
   comería las tareas `[P]` y nunca correrían en paralelo.
5. Una tanda paralela es parte de la **misma ronda** de build. No suma rondas.

## Cómo se marca una tarea hecha

El código acepta las tres formas de cabecera al leer y, al marcar, conserva la
que ya tenía la tarea:

- `- [ ] **T001. Título**` → `- [x] **T001. Título**`
- `## [ ] T001 — Título` → `## [x] T001 — Título`
- `### T001 — Título` → `### T001 — [x] Título`. Esta es la forma que usa hoy
  la fase build en los `tasks.md` reales.

## Lo que escribe cada hijo de una tanda paralela

- **No** edita `tasks.md` ni `tdd-evidence.md`: son compartidos y escribir de a
  varios los rompe.
- Escribe su evidencia TDD en `.sdd/<slug>/tdd-evidence/<T###>.md`.
- Corre sólo los tests de su tarea (su `evidence:`), no la suite completa:
  mientras un hermano está a medio editar, la suite da rojos que no son reales.

Al cerrar la tanda, el **orquestador por código**, no el modelo:

1. Marca `[x]` las tareas cuyo hijo terminó bien.
2. Agrega cada `tdd-evidence/<T###>.md` al final de `tdd-evidence.md`, en orden
   de id, bajo `## T### (parallel wave <n>)`.
3. Corre la suite completa una vez, en el siguiente lote de build o en el
   veredicto (que ya la corre).

Un hijo que falla deja su tarea en `[ ]`. Se reintenta una vez, sola, como lote
secuencial.

## Tamaño del pedido (`clarifications.md`)

clarify agrega a `clarifications.md` una línea propia, exacta:

    Size: small

o `Size: normal`. Es `small` sólo cuando el pedido entero es un cambio de un
paso que no amerita una spec: un typo, un renombre, un estilo, un fix de una
línea o un ajuste de config, en uno o dos archivos y sin comportamiento nuevo.
Ante la duda, `normal`. Si falta la línea, se toma `normal`. Al leerla se
tolera la decoración markdown (`**Size:** \`small\``); cualquier otro valor
(`smallish`, `small or normal`) cuenta como `normal`, y si hay varias líneas
gana la última. Si clarify vuelve `blocked` en modo interactivo, el aviso va en
el mismo diálogo de las preguntas bloqueantes.

Con `small`, el orquestador avisa **una sola vez**, en castellano, que para
cambios de ese tamaño NODD alcanza (lo hace directo, con los tests corridos de
verdad). El aviso **nunca bloquea ni cambia la ruta**. En modo interactivo va
en la pausa que sigue a clarify, así el usuario puede parar ahí. En automático
se anota y el run sigue. El resumen final lo repite en una línea.

## Archivos por ronda

| Archivo | Quién lo escribe | Contenido |
|---|---|---|
| `build-r<N>.md` | orquestador | El sobre de cada lote o tanda de la ronda N, bajo `## Batch i/n: T001, T002` (o `## Wave i/n: …`) |
| `veredicto-r<N>.md` | orquestador | La respuesta completa del veredicto de la ronda N, que termina en `VEREDICTO: pasa\|corregir\|replantear` |
| `rounds.json` | orquestador | El registro de rondas |

`veredicto-r<N>.md` es la prueba en disco del veredicto: para saber si un run ya
pasó, alcanza con leer el de la última ronda. Los subagentes no escriben estos
archivos; los arma el orquestador con lo que devuelven.
