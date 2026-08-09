# Architecture Language

> Vocabulary contract for the architecture review. Both `jlu-architecture-explorer` and `jlu-architecture-grill` are required to use these terms exactly. Adapted from Matt Pocock's `LANGUAGE.md`.

## Plugin adaptation

In this plugin, "service" refers to a deployment unit (a repo/codebase managed by `services.yaml`). Inside service code, **never use "service" as a module name** — say Module, Adapter, or name the concept from `UBIQUITOUS_LANGUAGE.md`.

## Terms

**Module**
Anything with an interface and an implementation. Deliberately scale-agnostic — applies equally to a function, class, package, or tier-spanning slice.
*Avoid: unit, component, service.*

**Interface**
Everything a caller must know to use the module correctly. Includes the type signature, but also invariants, ordering constraints, error modes, required configuration, and performance characteristics.
*Avoid: API, signature.*

**Implementation**
What's inside a module — its body of code. Distinct from **Adapter**: a thing can be a small adapter with a large implementation (a Postgres repo) or a large adapter with a small implementation (an in-memory fake).

**Depth**
Leverage at the interface — the amount of behaviour a caller (or test) can exercise per unit of interface they have to learn. A module is **deep** when a large amount of behaviour sits behind a small interface. A module is **shallow** when the interface is nearly as complex as the implementation.

**Seam** *(from Michael Feathers)*
A place where you can alter behaviour without editing in that place. The *location* at which a module's interface lives.
*Avoid: boundary (overloaded with DDD's bounded context).*

**Adapter**
A concrete thing that satisfies an interface at a seam. Describes *role* (what slot it fills), not substance (what's inside).

**Leverage**
What callers get from depth. More capability per unit of interface they have to learn.

**Locality**
What maintainers get from depth. Change, bugs, knowledge, and verification concentrate at one place.

## Principles

- **The deletion test.** Imagine deleting the module. If complexity vanishes, the module wasn't hiding anything. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. If you want to test *past* the interface, the module is probably the wrong shape.
- **One adapter = hypothetical seam. Two adapters = real seam.** Don't introduce a port unless something actually varies across it.
- **Depth is a property of the interface, not the implementation.** A deep module can be internally composed of small, mockable parts — they just aren't part of the interface.

## Dependency categories (from Pocock's DEEPENING.md)

When proposing a deepening, classify dependencies. The category determines how the deepened module is tested across its seam.

1. **In-process** — pure computation, in-memory state, no I/O. Always deepenable. Test through the new interface directly.
2. **Local-substitutable** — dependencies with local test stand-ins (PGLite for Postgres, in-memory FS). Deepenable; the seam is internal.
3. **Remote but owned (Ports & Adapters)** — your own services across a network boundary. Define a port at the seam; production uses an HTTP/gRPC/queue adapter, tests use an in-memory adapter.
4. **True external (Mock)** — third-party services (Stripe, Twilio). The deepened module takes the external dependency as an injected port; tests provide a mock.

## Rejected framings (do not adopt)

- Depth as a ratio of implementation-lines to interface-lines (rewards padding the implementation).
- "Interface" as the TypeScript `interface` keyword or a class's public methods (too narrow — interface here includes every fact a caller must know).
- "Boundary" (overloaded with DDD's bounded context).
