---
version: 2.0
name: Dashboard-Executivo-Fintech
description: Sistema visual del dashboard ejecutivo (libro Excel en OneDrive) y de la documentación técnica del prototipo. Tesis IS25237 — Fintech Colombia. Tono editorial y sobrio: la cifra manda, la decoración no.
colors:
  canvas: "#FFFFFF"
  canvas-subtle: "#F6F9FC"
  canvas-elevated: "#FFFFFF"
  ink: "#0A2540"
  ink-secondary: "#425466"
  ink-muted: "#6B7785"
  primary: "#0A2540"
  primary-hover: "#081C31"
  primary-on: "#FFFFFF"
  border: "#D1D5DB"
  border-strong: "#9AA5B1"
  success: "#0E7C66"
  warning: "#B45309"
  error: "#B42318"
typography:
  display-font: "Calibri, Segoe UI, system-ui, sans-serif"
  body-font: "Calibri, Segoe UI, system-ui, sans-serif"
  mono-font: "Consolas, SFMono-Regular, monospace"
  scale:
    display: "16"
    section: "11"
    body: "10"
    caption: "9"
layout:
  grid-columns: "8"
  reading-width: "65ch"
  radius:
    none: "0"
  spacing:
    row-title: "26"
    row-section: "20"
    row-header: "18"
    row-data: "15"
number-formats:
  integer: "#,##0"
  decimal: "#,##0.00"
  percentage: '0.00"%"'
  variation: '+0.00"%";-0.00"%"'
  currency-cop: '#,##0" COP"'
  milliseconds: '#,##0" ms"'
  datetime: "dd/mm/yyyy hh:mm"
---

# Sistema visual — Dashboard Ejecutivo (Excel) y documentación

> Este documento es la fuente de verdad del sistema visual del proyecto. Se aplica a **dos superficies**: el libro Excel del dashboard ejecutivo (§4.4 de la tesis) y la documentación técnica del repositorio.
>
> **Origen del diseño.** La composición reproduce el mockup «Dashboard Ejecutivo — Asesor Fintech» que acompaña al §4.4 de la tesis (imagen del documento original), **combinado** con la descripción textual de la misma sección. El documento original presenta ambas fuentes con diferencias entre sí (ver `docs/decisions.md`, ADR-012); este sistema resuelve la diferencia por composición, sin inventar indicadores.
>
> **Alcance.** La Figura 5 de la tesis es el **Modelo Entidad-Relación**, no el dashboard: el MER se valida en `docs/decisions.md` (ADR-011) y en `infrastructure/config/postgres/init.sql`.

---

## 1. Idea

> En este tablero, **la cifra del piloto y su trazabilidad** se convierten en **un libro de Excel que se lee de arriba abajo como un informe, no como una rejilla de datos**.

El error habitual de un dashboard generado automáticamente es el contrario: todo tiene el mismo peso, las cifras se pierden en una tabla y el lector no sabe qué mirar primero. Aquí la jerarquía hace el trabajo:

1. **Una sola idea arriba**: qué es este tablero, de dónde salen los datos y en qué periodo.
2. **Los KPI en banda horizontal**: la respuesta a «¿cómo va?» en una línea.
3. **Bloques con tablas cortas**: cada bloque es un título + una tabla corta.
4. **Nada más**: sin gráficos decorativos, sin iconos, sin colores de marca, sin sombras, sin degradados.

---

## 2. Fundamento (canvas, tinta, bordes)

### 2.1 Paleta

| Rol | Valor | Uso |
|---|---|---|
| `canvas` | `#FFFFFF` | Fondo del libro. Es el color por defecto de Excel: no se toca. |
| `canvas-subtle` | `#F6F9FC` | Relleno de los encabezados de sección y de columna. Un solo paso de tono sobre el blanco. |
| `ink` | `#0A2540` | Títulos de nivel 1 y encabezados de sección. Azul tinta, no negro puro. |
| `ink-secondary` | `#425466` | Etiquetas de columna y celdas de dato. |
| `ink-muted` | `#6B7785` | Notas al pie. Nunca se usa para cifras. |
| `border` | `#D1D5DB` | Línea divisoria de una sola fila bajo cada encabezado. |
| `success` | `#0E7C66` | Sello «DATOS REALES» y estado «Correcto» del monitoreo. |
| `warning` | `#B45309` | Sello «DATOS SINTÉTICOS». |

**Por qué esta paleta.** Es la de un producto financiero sobrio: fondo frío muy claro, tinta azul profunda en vez de negro, grises con un punto de azul para que no se vean «sucios» sobre el blanco. No hay color de marca, no hay acento decorativo, no hay azul-violeta de plantilla.

**El único color con significado es el del sello de origen y el del estado de sincronización.** El verde y el ámbar no decoran: **distinguen datos empíricos de datos de demostración** y **sincronización correcta de sincronización con fallos**. Es una decisión de integridad de datos, no de estilo, y por eso es la única excepción cromática del tablero.

### 2.2 Reglas de color

| Regla | Motivo |
|---|---|
| Un solo relleno en todo el libro (`canvas-subtle`) | La superficie marca la jerarquía sin borde decorativo |
| Las cifras nunca usan `ink-muted` | Un número atenuado se lee como «no importa» |
| Sin degradados | No hay superficies que degradar; el blanco es el fondo real |
| Sin sombras | Excel no las renderiza de forma fiable en la API de Graph y añadirían ruido visual |
| El acento no se propaga | No hay un «color de la fintech»: la identidad vive en la tipografía y el orden |

---

## 3. Tipografía

Una sola familia: **Calibri** (la de Office por defecto, disponible en OneDrive sin instalar nada).

| Nivel | Tamaño | Peso | Color | Dónde |
|---|---|---|---|---|
| Antetítulo | 10 | Negrita | `ink-muted` | «EXCEL / ONEDRIVE» |
| Título | 16 | Negrita | `ink` | «DASHBOARD EJECUTIVO — ASESOR FINTECH» |
| Subtítulo | 10 | Normal | `ink-secondary` | Periodo, fecha de actualización, pestañas |
| Encabezado de sección | 11 | Negrita | `ink` | Cada bloque |
| Encabezado de columna | 10 | Negrita | `ink-secondary` | Cada tabla |
| Dato | 10 | Normal | `ink-secondary` | Celdas |
| KPI (valor) | 10 | Negrita | `ink` | Banda de indicadores |
| Dato destacado | 10 | **Negrita** | `ink` | Fila `TOTAL` |
| Nota | 10 | *Cursiva* | `ink-muted` | Notas al pie |

**Tres tamaños hacen el trabajo visible** (16 / 11 / 10). No hay tamaños intermedios: cada nivel de jerarquía se distingue por peso y color, no por un punto de tamaño más.

**Convención de secciones en mayúsculas.** Los encabezados de bloque van en mayúsculas (`BLOQUE A — SEGUIMIENTO COMERCIAL`). Es una convención de informe impreso, no una «etiqueta pequeña en mayúsculas con tracking»: miden 11 pt, llevan negrita y un borde inferior, y son el segundo nivel de la jerarquía.

---

## 4. Retícula y espaciado

- **Una retícula de 8 columnas (A–H)** para toda la hoja. Es lo que permite la banda horizontal de cuatro KPIs (etiqueta + valor, dos columnas por indicador) sin celdas combinadas.
- **Anchos de columna fijos**: A = 200, B = 160, C = 120, D = 120, E = 140, F = 120, G = 140, H = 120. El texto largo vive en A y B; las cifras en C–H.
- **Alturas de fila**: 26 (título), 20 (sección), 18 (encabezado de columna), 15 (dato).
- **Una fila en blanco entre bloques**. El espacio hace la separación: no hay líneas de caja ni marcos alrededor de cada tabla.
- **Un único borde**: una línea continua de 1 px bajo cada encabezado de sección y de columna. Nada más.

---

## 5. Cifras

Las cifras son el contenido. Su presentación es uniforme:

| Magnitud | Formato | Ejemplo |
|---|---|---|
| Entero | `#,##0` | `12.000` |
| Decimal | `#,##0.00` | `43.90` |
| Porcentaje | `0.00"%"` | `34.50%` |
| Variación | `+0.00"%";-0.00"%"` | `-25.50%` |
| Monto COP | `#,##0" COP"` | `12.000.000 COP` |
| Latencia | `#,##0" ms"` | `145 ms` |
| Fecha y hora | `dd/mm/yyyy hh:mm` | `05/11/2026 10:00` |

**Todas las cifras se alinean a la derecha.** Excel no tiene cifras tabulares por defecto, pero la alineación a la derecha más el separador de miles cumple la función equivalente.

**Las fechas se escriben como número serial de Excel** en hora `America/Bogota` (no como texto ISO). Es la única forma de que el formato `dd/mm/aaaa hh:mm` se aplique y de que la columna pueda ordenarse.

**Un dato ausente se escribe `n/d`** («no disponible»), nunca `0`. Un cero afirma una medición que no se hizo; `n/d` afirma su ausencia. El único bloque donde puede aparecer `n/d` es el bloque B, porque las métricas de reporte de Mailchimp (`enviadas`, `tasa de apertura`, `clics`) no están almacenadas en el MER.

---

## 6. Composición del libro

```
Fila 1   EXCEL / ONEDRIVE                                          [antetítulo]
Fila 2   DASHBOARD EJECUTIVO — ASESOR FINTECH                      [título]
Fila 3   Inicio · Leads · Citas · Inversiones · Reportes            [pestañas]
Fila 4   (vacía)
Fila 5   PERIODO DE CONSULTA                                       [sección]
Fila 6   Periodo | 2026-11-02 — 2026-11-08 | Todos los estados | … | Actualizar datos
Fila 7   (vacía)
Fila 8   INDICADORES CLAVE DE GESTIÓN (KPIs)                        [sección]
Fila 9   Leads registradas | 125 | Citas agendadas | 48 | Inversiones registradas | 18 | Conversión | 14,4%
Fila 10  (vacía)
Fila 11  BLOQUE A — SEGUIMIENTO COMERCIAL (LEADS POR ETAPA)          [sección]
Fila 12  Estado del lead | Etapa comercial | Cantidad | Participación
  …      nuevo | Nuevo | 35 | 28,00 %
         prospecto | En seguimiento | 42 | 33,60 %
         cita_pendiente | Cita agendada | 16 | 12,80 %
         cita_confirmada | Cita agendada | 14 | 11,20 %
         cliente | Convertido | 18 | 14,40 %
         inactivo | — (fuera del embudo) | 2 | 0,00 %
Fila …   (vacía)
         BLOQUE B — CAMPAÑAS MAILCHIMP                                [sección]
         Campaña | Estado | Suscriptores | Enviadas | Tasa apertura | Clics
  …      una fila por campaña
         (vacía)
         BLOQUE C — CITAS DEL PERIODO                                [sección]
         Lead | Inicio | Fin | Enlace
  …      una fila por cita
         (vacía)
         BLOQUE D — RESUMEN FINANCIERO                               [sección]
         Tipo de información | Valor
  …      Monto acumulado (saldo de inversiones activas) | 12.000.000 COP
         Total de operaciones | 18
         Operaciones pendientes | 4
         Operaciones completadas | 14
         Operaciones canceladas | 0
         Operaciones del mes actual | 6
         Variación % frente al mes anterior | -25,50 %
         (vacía)
         MONITOREO DE INTEGRACIONES                                  [sección]
         Plataforma | Última sincronización | Estado
  …      HubSpot CRM | 08/11/2026 05:00 | Correcto
         Mailchimp | 08/11/2026 05:00 | Correcto
         Calendly | 08/11/2026 05:00 | Correcto
         Excel / OneDrive | 08/11/2026 05:00 | Correcto
         (vacía)
         CONTROL DE ACTUALIZACIÓN                                   [sección]
         Última actualización | 08/11/2026 05:00 | Estado general | Sincronización correcta
         Origen de los datos | REALES (PostgreSQL · MER)             [sello]
         (vacía)
         NOTAS                                                      [sección]
         …una nota por advertencia del informe
```

**Las cuatro secciones de §4.4 se conservan tal cual** (A, B, C y D) y el mockup aporta las secciones que no estaban en la prosa (KPIs, Monitoreo de integraciones y Control de actualización), cada una rotulada con su propio encabezado.

---

## 7. Anti-patrones (lo que este tablero no hace)

| No | Por qué |
|---|---|
| No hay gráficos de barras ni de torta | La API de Graph no los renderiza de forma fiable y una imagen no es auditable. El bloque A es una tabla con participación; el «gráfico de barras» del §4.4 se resuelve en el informe escrito y en los KPI |
| No hay celdas combinadas | Rompen la lectura por filtro y el rango de escritura de la API |
| No hay imágenes ni logotipos | Añaden peso al libro y no aportan información |
| No hay color de marca ni degradados | Compiten con las cifras |
| No hay sombras ni marcos | Excel no los renderiza de forma fiable vía Graph API |
| No hay valores `0` donde el dato no existe | Un cero es una afirmación; `n/d` es la ausencia |
| No se altera el significado de un indicador para «mejorar» la lectura | La presentación se adapta; la definición del dato no |
| No se añade un indicador que no esté en la tesis | El conjunto de KPI y de bloques es la unión de la prosa de §4.4 y del mockup, sin extensiones |

---

## 8. Aplicación a la documentación técnica

La misma lógica gobierna la documentación del repositorio:

- **Un título por documento**, con el sujeto y el estado en la primera línea.
- **Jerarquía de tres niveles** (`#`, `##`, `###`) y tablas para los datos estructurados.
- **Los bloques de código son la única excepción** a la regla tipográfica: usan monoespaciada (regla admitida: código real).
- **Las tablas llevan encabezado separador** y alineación numérica a la derecha cuando la columna es numérica.
- **Ninguna cifra sin su fuente**: cada dato del README enlaza al archivo o al script que lo produce.

---

## 9. Verificación

| Qué | Cómo | Dónde |
|---|---|---|
| Jerarquía y formatos | Pruebas unitarias sobre `construirMatrizDashboard` y `escribirDashboardEnExcel` | `services/dashboard/src/__tests__/excelWriter.test.js` |
| Paleta y formatos centralizados | Los tokens viven en un único objeto `TOKENS`; ningún color ni formato se escribe literal fuera de él | `services/dashboard/src/excelWriter.js` |
| Sincronía entre código y documento | Este documento y los tokens se editan juntos | Revisión manual |

> El «inspector» de navegador del skill de diseño no aplica a un libro de Excel: no existe superficie web. La verificación se hace sobre el **rango escrito** (direcciones y formatos de cada llamada a `updateRange`), que es la evidencia equivalente.
