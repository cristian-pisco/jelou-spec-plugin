# OKR Mapping — Jelou Tech 2026

Every ClickUp task created by `/jlu-task-clickup` MUST be tied to exactly one Key
Result. The mapping is embedded into the task's `markdown_description` (no
custom field is set — the list does not have an OKR field). Use the table
below to pick the KR; if more than one fits, pick the one closest to the
task's primary intent.

## Objetivo 1 — Escalar Brain OS para soportar el crecimiento PLG

| KR  | Descripción                                                              | Meta 2026 |
|-----|--------------------------------------------------------------------------|-----------|
| 1.1 | Reducir tiempo de onboarding de nuevos usuarios (self-service)           | ≤5 min    |
| 1.2 | Alcanzar alta disponibilidad en producción                               | 99.99%    |
| 1.3 | Optimizar tiempo de respuesta de APIs críticas / Plataforma              | <500 ms   |
| 1.4 | Soportar 10k+ crecimiento de usuarios concurrentes                       | 10,000+   |

## Objetivo 2 — Acelerar la velocidad de entrega sin sacrificar calidad

| KR  | Descripción                                                              | Meta 2026   |
|-----|--------------------------------------------------------------------------|-------------|
| 2.1 | Incrementar frecuencia de releases de features a producción              | 20+/sprint  |
| 2.2 | Mantener cobertura de tests automatizados en código crítico              | ≥80%        |
| 2.3 | Reducir cycle time (commit to production)                                | ≤2 días     |
| 2.4 | Minimizar errores y rollbacks en releases                                | <5%         |
| 2.5 | Optimizar proceso de desarrollo mediante AI                              | 80%         |

## Objetivo 3 — Fortalecer seguridad y compliance para Enterprise

| KR  | Descripción                                                              | Meta 2026 |
|-----|--------------------------------------------------------------------------|-----------|
| 3.1 | Obtener certificación SOC 2 Type II o similar                            | 100%      |
| 3.2 | Mantener vulnerabilidades críticas/altas resueltas rápidamente           | 0         |
| 3.3 | Implementar soporte a diferentes niveles de seguridad en AI              | 5         |
| 3.4 | Reducir tiempos de penetration testing + remediación                     | <15 días  |
| 3.5 | Segregar ambientes self-service y enterprise en infraestructura          | 30%       |

## Objetivo 4 — Optimizar infraestructura para eficiencia y escalabilidad

| KR  | Descripción                                                              | Meta 2026 |
|-----|--------------------------------------------------------------------------|-----------|
| 4.1 | Reducir costos de cloud manteniendo performance                          | -20%      |
| 4.2 | Implementar auto-scaling en servicios críticos                           | 100%      |
| 4.3 | Optimizar utilización de recursos                                        | >60%      |
| 4.4 | Migrar workloads a arquitectura containerizada / escalable               | 100%      |

## Objetivo 5 — Infraestructura de billing robusta y escalable ($18M)

| KR  | Descripción                                                              | Meta 2026 |
|-----|--------------------------------------------------------------------------|-----------|
| 5.1 | Reducir tiempo y carga operativa de Billing (automatización multi-plan)  | 0         |
| 5.2 | Implementar self-service para upgrade/downgrade de planes                | 90%       |
| 5.3 | Habilitar facturación por consumo (usage-based billing)                  | 100%      |
| 5.4 | Incluir Enterprise dentro del sistema de Billing                         | 25%       |
| 5.5 | Reducir tiempo de provisioning de nuevos clientes                        | <5 min    |

## Selección rápida por tipo de tarea

| Tipo de tarea                         | KR probable                          |
|---------------------------------------|--------------------------------------|
| Bug fix / Incident response           | 1.2 (Availability) or 1.3 (Perf)     |
| Onboarding / Self-service UX          | 1.1                                  |
| Scalability / Load                    | 1.4                                  |
| New feature / Enhancement             | 2.1                                  |
| Test automation / QA                  | 2.2 or 2.4                           |
| CI/CD / Pipeline                      | 2.3                                  |
| AI tooling / Dev productivity         | 2.5                                  |
| Security fix / Vulnerability          | 3.2                                  |
| Compliance / Audit                    | 3.1                                  |
| AI security levels                    | 3.3                                  |
| Pentest / Remediation                 | 3.4                                  |
| Environment segregation               | 3.5                                  |
| Cost optimization / Cloud             | 4.1                                  |
| Auto-scaling                          | 4.2                                  |
| Resource optimization                 | 4.3                                  |
| Container migration                   | 4.4                                  |
| Billing features                      | 5.1–5.5 (match specific KR)          |

## Embedding format (markdown_description)

Append the following block at the end of every macro task's description:

```markdown
## OKR

**KR <number>** — <KR description>
```

Example:

```markdown
## OKR

**KR 2.1** — Incrementar frecuencia de releases de features a producción
```

For subtasks: do **not** repeat the OKR block — subtasks inherit the parent
context. The macro task is the canonical place.
