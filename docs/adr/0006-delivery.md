# 6. Delivery: GitHub Actions to Cloudflare Workers static assets

Status: accepted

## Context

Every push must build and redeploy the application without manual steps, including pushes made
during the interview, and a change must be visible on the next page load. Each branch should be
reviewable on its own URL.

## Decision

- **CI.** GitHub Actions runs on every push, with actions pinned by commit SHA:
  - a build job: the Wasm module and the production build stamped with the commit SHA;
  - a test job: type-checking, the Vitest suite with coverage, and the Rust tests;
  - a lint job: Prettier, ESLint, Stylelint, rustfmt, Clippy for the native and wasm32 targets;
  - an audit job;
  - a deploy job that needs the build and test jobs. Lint and audit report on the same commit but
    do not hold the deploy back.
- **Deployment.** The build is published as Cloudflare Workers static assets. `main` deploys to
  production with `wrangler deploy`. Any other branch is uploaded as a version with a preview
  alias derived from the branch name: lowercase, at most 37 characters, ending in a short hash
  when truncated so that two long branch names cannot share a URL.
- **Caching.** `_headers` marks fingerprinted scripts, styles and media (fonts and the `.wasm`
  included) immutable. HTML keeps Cloudflare's default `max-age=0, must-revalidate`.
- **Missing URLs.** Requests that match no asset reach a Worker of a few lines: paths without a
  file extension are app routes and get the shell with a 200, for every client, so deep links
  work; anything else is a missing file and gets a 404 with `no-store`.
- **Advisories.** The audit job does not gate deploys.
- **Routes** are loaded eagerly.

## Consequences

- A push is live without manual steps, and the footer shows which commit is being served.
- With Cloudflare's built-in SPA fallback instead of the Worker, a missing chunk requested as a
  script received the HTML shell with a 200, and `_headers` then made that response immutable
  under the script's URL; this was reproduced by hand. The fallback also served deep links only to
  clients that send navigation hints (`Sec-Fetch-Mode`), so `curl` or a link previewer got 404.
- An advisory published upstream on the day of the interview cannot freeze the demo; it shows up
  as a failed audit check.
- Eager routes cost about 22 KB (gzipped) of forms code on the first load. In exchange, a tab
  opened before a deploy never needs a lazy chunk that the deploy removed. The worker file has the
  same problem on a restart, which its error message addresses.

## Alternatives considered

- **GitHub Pages.** It served HTML with `max-age=600` when checked, so a push could take ten
  minutes to appear. It has no per-branch previews and no real SPA fallback.
- **A host's own Git integration** (Cloudflare Pages, Vercel, Netlify). Each host's build image
  would need rustup and wasm-pack, and the deploy would not wait for the Rust job.
- **Gating deploys on the audit.** Safer in a product; for a demo whose production dependencies
  are mostly the framework, it would turn someone else's advisory into a frozen demo.
- **Gating deploys on every check, lint included.** The usual choice, and the first version of
  this pipeline. A change pushed during the interview with one unformatted line would have left the
  old version online without anyone noticing.
- **Gating deploys on the build alone.** Tried next; it let a failing test go live. A behaviour
  regression should stop a deploy; formatting should not.
- **Lazy routes.** A smaller first load; see the trade-off above.
