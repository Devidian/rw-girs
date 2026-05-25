# Repository Policy

## Runtime Policy
- Preserve the repository's Yarn and TypeScript build setup.
- Runtime changes must update package scripts, deployment notes, and docs when affected.

## Architecture Policy
- Keep relay/server protocol behavior separate from in-game plugin client behavior.
- Treat WebSocket payloads as compatibility-sensitive contracts.

## Dependency Policy
- Add dependencies only when necessary and compatible with the runtime.
- Avoid introducing alternate package-manager lock files.

## API Verification Policy
- Verify WebSocket contract changes against expected plugin consumers.
- Document payload, versioning, fallback, and failure behavior.

## Release Policy
- Preserve build and runtime scripts.
- Deployment-impacting changes require docs updates.

## Documentation Policy
- `PLANS.md` stays intentionally minimal and links to `docs/active/`, `docs/roadmaps/`, and `docs/phase-archive.md`.
- Active tasks belong in `docs/active/`.
- Large plans and roadmaps belong in `docs/roadmaps/`.
- Completed work is summarized in `docs/phase-archive.md`.
- Planning documents must include objective, ownership, dependencies, risks, validation strategy, affected repositories/services, rollback considerations, and checkbox progress.
