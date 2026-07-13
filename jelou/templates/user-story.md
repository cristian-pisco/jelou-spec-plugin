---
id: us-1
title: {{story-title}}
actor: {{user-role}}
services: [{{service-id}}]
depends-on: []
service-order: []
covers: [FR-1]
---

# {{story-slug}}

## Story
As a {{user}}, I want {{action}}, so that {{benefit}}.

## Acceptance Criteria
- [success] {{valid, type-correct input produces the expected result}}
- [rejection @{{rule}} {{field}}] {{violating payload is refused with the documented 4xx and does not mutate state}}
- [realistic] {{production-representative payload populates every cross-field reference (collections non-empty, ids point at real rows)}}
- [boundary] {{empty collection AND its populated counterpart; missing optional; min/max}}

## Phase Mapping
- Phase {{number}}: {{phase-name}}
