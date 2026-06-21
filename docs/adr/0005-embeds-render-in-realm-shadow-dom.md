# Embeds render in-realm (Shadow DOM); untrusted documents are sandboxed at the editor, not per-embed

> **Status: superseded by [ADR-0007](./0007-iframe-html-embeds-use-workspace-hubble-deps.md).** HTML Apps are now the source of truth for local, agent-authored apps; embeds are inline placements of those apps. The in-realm Embed Bundle strategy is design history only and has been removed from the active implementation.

[[Embed]]s are interactive UI placed inline in documents, so they need editor-integrated UX: popovers/dropdowns that overflow their box, nested children, and low cost. A per-embed sandboxed iframe (ADR-0004) cannot provide this — iframe content is clipped to the frame rectangle, composition forces nested iframes, and every embed pays iframe + height-sync cost. Mainstream block editors (Gutenberg) render blocks **same-realm** as trusted code, use at most a *single* canvas iframe, and portal popovers out to the parent.

Decision: every Embed renders **in-realm** as a Web Component with a Shadow DOM — CSS isolation without overflow clipping; `<slot>` + ProseMirror content-holes for children. Embed styles compile into the bundle as a **built CSS artifact**, injected scoped into the shadow root (no runtime CSS-in-JS requirement). Untrusted content is isolated at the **document** level instead: once a sharing/ownership model exists, a shared/foreign document runs its **entire editor canvas in a sandboxed iframe** (no `allow-same-origin`) that reaches the host only through the existing async broker. The trust boundary is the document/author, not the widget.

All Embed data access continues to go through the **capability-scoped async broker** (see ADR/Q6 data-access design). The broker is independent of rendering: in a trusted doc it resolves in-realm; in a sandboxed doc it resolves over postMessage. So the document-sandbox option stays open without changing any Embed code.

## Considered Options

- **Per-embed sandboxed iframe** (ADR-0004). Rejected: overflow clipping, nested-iframe composition, per-embed cost — fatal for inline editor UI.
- **Host renders from a UI description** (Figma-plugin style: untrusted logic in a Worker, host draws the DOM). Rejected: kills "arbitrary UI / vite-level control."

## Consequences

- **Trust is per-document, not per-embed.** Within a sandboxed document, embeds are not isolated from each other or from document content; the sandbox only bounds the blast radius away from the host (fs bridge, Convex client, app origin). Acceptable.
- **Requires a trust signal** (foreign/shared doc) that does not exist today. Until then all docs are trusted and the editor renders in-app. **Tracked debt:** the editor-sandbox path must exist before cross-person sharing ships, or opening a shared doc with a foreign embed is RCE.
- **Verify on desktop** that a nested sandboxed iframe does not inherit the Electron preload bridge.
- **Shadow DOM + built CSS is the *initial* isolation mechanism — explicitly provisional (~50% likely to change).** The firm parts are in-realm rendering and a document-level sandbox for untrusted content. The specific CSS-encapsulation mechanism (Shadow DOM + built CSS vs an alternative scoping approach) is what we are doing *first* and may be revisited after the first build.
- **Spike #35 decision:** keep Shadow DOM for the next embed slices. The desktop `<embed-kanban>` spike validates same-realm Web Component mounting, React rendering, scoped style injection, and non-clipped popovers well enough to proceed to the build and broker spikes. Nested children via `<slot>` / ProseMirror content-holes are deferred; they add document-composition semantics beyond the render-spine proof.
