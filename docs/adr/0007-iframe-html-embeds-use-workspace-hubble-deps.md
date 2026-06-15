# Iframe HTML embeds use workspace-scoped .hubble dependencies

> **Status: accepted.** This ADR is the source of truth for the current [[Embed]] strategy. It supersedes [ADR-0005](./0005-embeds-render-in-realm-shadow-dom.md)'s in-realm Embed Bundle direction for local, agent-authored mini apps.

Hubble supports a lightweight [[Embed]] form for agent-authored mini apps:

```html
<iframe src="./file-index.html"></iframe>
```

The iframe `src` must be a workspace-local relative `.html` path. Desktop resolves it relative to the Markdown file, serves it through the `hubble-asset://` protocol, and renders it with `sandbox="allow-scripts"` without `allow-same-origin`. The iframe therefore has an opaque origin and cannot reach the host app, Electron preload bridge, local storage, or parent DOM.

## Decisions

- **Load authored HTML by `src`, not `srcdoc`.** Opaque sandboxed `srcdoc` rendered blank in Electron because the child document got a zero layout box on cold start. Loading the workspace file through `hubble-asset://` preserves the opaque sandbox and gives Chromium a normal frame document.
- **Keep dependencies workspace-scoped under `.hubble/`.** Agent-created embeds share one workspace dependency environment:

  ```text
  .hubble/
    package.json
    pnpm-lock.yaml
    node_modules/
  ```

- **Publish the Hubble bridge as `@hubble.md/runtime`.** Embed HTML opts into Hubble APIs explicitly:

  ```html
  <script src="./.hubble/node_modules/@hubble.md/runtime/global.js"></script>
  ```

  Nested HTML files use normal relative paths back to `.hubble/node_modules`.
- **Third-party browser dependencies are installed, not copied into each embed.** The playground proves Alpine and Tailwind browser usage from `.hubble/node_modules`.
- **The iframe runtime exposes a small global API.** Today it provides `window.hubble.files.list()` and `window.hubble.files.read()` plus height reporting over `postMessage`.

## Consequences

- HTML embeds are viewable in a normal browser as static HTML, but Hubble-specific APIs only work when the runtime is loaded inside Hubble.
- Agents need an install step for `.hubble/package.json` before using Alpine, Tailwind, or Hubble runtime imports.
- `node_modules` is not committed; `.hubble/package.json` and lockfiles are the portable contract.
- The broker remains async and capability-scoped. Future write/create file APIs should extend the runtime broker rather than exposing direct filesystem access.
- Legacy in-realm Embed Bundle code should be removed or re-scoped behind a separate future ADR. New local mini-app work should use iframe HTML embeds.
