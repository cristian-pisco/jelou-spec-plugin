# Story Points — Estimación (Jelou Tech)

Story Points miden **complejidad relativa**, no horas. Escala Fibonacci: 1, 2,
3, 5, 8, 13, 21.

## Framework CUE (Scrum.org)

| Factor          | Evalúa                                                         | Ejemplo                                              |
|-----------------|----------------------------------------------------------------|------------------------------------------------------|
| **C**omplejidad | Capas, servicios, sistemas que toca                            | 1 endpoint vs. full-stack con API externa            |
| **U**ncertidumbre | Claridad del scope, unknowns                                 | Fix conocido vs. investigación de causa raíz        |
| **E**sfuerzo    | Trabajo que la IA NO puede hacer sola                          | Coordinar con otro equipo vs. ejecutar solo          |

## Ajuste AI-first (regla obligatoria)

Todos los equipos tech de Jelou usan Claude Code como herramienta principal de
desarrollo. **N archivos / N PRs / N repos no infla SP** — eso lo hace la IA en
minutos. Lo que SÍ suma puntos:

- Incertidumbre técnica (investigación, causa raíz desconocida)
- Coordinación cross-equipo o dependencias externas
- Decisiones de arquitectura o producto no triviales
- Validación manual compleja (QA de seguridad, pruebas de carga)
- Deploys coordinados entre servicios
- Discovery + planning (donde va el tiempo humano real)

**Sesgo a corregir:** Si la tarea es "hacer X en N archivos/repos" y el scope
está claro, N **no** debe inflar los SP. Pregunta: "¿Un dev con Claude Code
puede terminar esto en menos de medio día?" → Sí ⇒ XS (1 SP).

## Escala de referencia

| SP  | Talla | C (Complejidad)              | U (Uncertidumbre) | E (Esfuerzo humano)      | Dependencias               |
|-----|-------|------------------------------|-------------------|--------------------------|----------------------------|
| 1   | XS    | 1 capa, scope obvio          | Ninguna           | 0–1 PR, sin QA           | Ninguna                    |
| 2   | S     | 1 capa, con validación       | Mínima            | 1 PR, validación staging | Ninguna                    |
| 3   | M     | 1–2 capas                    | Baja              | 1 PR, ciclo investigar-impl | Ninguna o mínima        |
| 5   | L     | 2+ capas o API externa       | Media             | 2+ PRs, coordinación     | Cross-equipo               |
| 8   | XL    | Full-stack + integración     | Media-alta        | Múltiples PRs, feature flag | Externa, cross-team     |
| 13  | —     | Múltiples servicios          | Alta              | DIVIDIR                  | Múltiples equipos          |
| 21  | —     | No claro                     | Muy alta          | DIVIDIR OBLIGATORIAMENTE | No claro                   |

## Resumen rápido

```
1 SP (XS)  — "Ya sé exactamente qué hacer y dónde"
              1 capa, 0–1 PR, sin QA, sin investigación

2 SP (S)   — "Sé qué hacer pero necesito validar en ambientes"
              1 capa, 1 PR, validación staging/prod

3 SP (M)   — "Necesito investigar un poco antes de implementar"
              1–2 capas, 1 PR, ciclo investigar-implementar-validar

5 SP (L)   — "Hay una API externa o necesito coordinar con otro equipo"
              2+ capas o dependencia externa, 2+ PRs

8 SP (XL)  — "Feature completa con integraciones y dependencias"
              Full-stack, dependencia externa, feature flag
              >>> Máximo recomendado por tarea en un sprint <<<

13 SP      — DIVIDIR antes de empezar
21 SP      — DIVIDIR obligatoriamente
```

## QA es parte del Story Point

"Done" = testeado y entregado, no solo PR mergeado.

| Tipo de QA              | Impacto en SP |
|-------------------------|---------------|
| Sin QA                  | +0            |
| QA interno (dev valida) | +0            |
| QA por producto         | +0–1          |
| QA de seguridad         | +1            |
| QA cross-equipo         | +1–2          |

## Anclas (tareas de referencia)

- **1 SP** — Fix en 1 endpoint con scope obvio; deprecar feature flag; cambio de
  config; refactor mecánico en N archivos.
- **2 SP** — Bug con causa conocida + validación en staging/prod; migración
  simple de datos; endpoint nuevo con lógica básica.
- **3 SP** — Bug que requiere diagnosticar causa raíz; feature nueva con lógica
  de negocio en 1–2 capas; integración con servicio interno.
- **5 SP** — Integración con API externa (Meta, Stripe); feature con
  coordinación cross-equipo; migración con downtime planning.
- **8 SP** — Feature full-stack con integración externa + coordinación de
  deploys; cambio de arquitectura que afecta múltiples servicios.

## Sprint Points

**Sprint-Points = Story-Points** (always equal — both fields take the same
value). Story Points miden tamaño relativo, no horas de trabajo: este flujo no
asigna horas de trabajo a las tareas de ClickUp.
