# Template: REST API Endpoint

## Description
New REST API endpoint with request/response schema, validation, and auth.

## Pre-filled Sections

### Problem Statement
<!-- FILL: What user need does this endpoint serve? -->

### Functional Requirements
- FR-1: Endpoint definition (HTTP method, URL path, API version)
- FR-2: Request schema — required and optional fields with types
- FR-3: Response schema — success response body structure
- FR-4: Error response schema — error codes and response format
- FR-5: Authentication requirement (JWT, API key, public, or session)
- FR-6: Authorization rules — who can call this endpoint
- FR-7: Input validation rules per field

### Non-Functional Requirements
- NFR-1: Response time target (e.g., < 200ms p95)
- NFR-2: Rate limiting strategy (per-user, per-IP, global)
- NFR-3: Caching strategy (Cache-Control headers, ETag support)
- NFR-4: API versioning approach (URL path, header, or query param)

### Constraints
- Must follow existing API conventions from CONVENTIONS.md
- Must be backwards-compatible with existing clients
- Must use existing error response format

### Out of Scope
<!-- FILL: What this endpoint intentionally does NOT do -->

### Success Criteria
- SC-1: All input validation rules covered by tests
- SC-2: Error responses match existing error schema
- SC-3: Authentication and authorization enforced and tested
- SC-4: Response time meets target under expected load

## Interview Hints
- What HTTP method and URL path pattern? Does it follow existing route conventions?
- What authentication is required? (JWT, API key, public)
- What are the validation rules for each input field? Min/max, format, required?
- Is this a list endpoint? If so: cursor vs offset pagination? Default page size?
- What are the authorization rules? Role-based, resource-ownership, or both?
- Are there rate limits specific to this endpoint beyond global limits?
- What happens on partial failure? (e.g., created resource but notification failed)
