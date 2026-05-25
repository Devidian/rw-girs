# AGENTS.md

## Repository Purpose
This repository owns the Global Intercom relay/server tooling for Rising World integrations.

It is a standalone TypeScript service and must not depend on workspace-root orchestration files for development, validation, release, or deployment.

## Ownership
Owns:
- WebSocket relay/server behavior
- relay-side Discord/MongoDB integration where configured
- TypeScript build and runtime configuration for the relay service

Does not own:
- in-game plugin client behavior
- manager backend/frontend behavior
- workspace-root orchestration rules

## Mandatory Workflow Rules
- Use Yarn as configured by this repository.
- Preserve the TypeScript build and runtime scripts unless explicitly changed.
- Treat WebSocket payload changes as compatibility-sensitive contracts.
- Follow `.codex/agents.toml` for local agent roles, task classes, context loading, and escalation.
- Follow `docs/policies/repository-policy.md` for reusable governance rules.
- Keep `README.md` when added and `PLANS.md` aligned with setup, workflow, or deployment changes.

## Validation
- Run the repository build script for build-impacting changes.
- Run targeted runtime or contract checks for WebSocket behavior changes.
- Review plugin compatibility when relay payloads or channel semantics change.
