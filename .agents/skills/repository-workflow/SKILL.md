---
name: "repository-workflow"
description: "Use for repository-local workflows, validation, migrations, runtime debugging, and release checks in rw-girs."
---
# Repository Skills

## websocket-contract-review
- Treat payload and channel changes as public contracts.
- Verify producer and consumer compatibility with the Global Intercom plugin.
- Document fallback and failure behavior.

## runtime-debugging
- Reproduce with local Yarn scripts first.
- Capture environment assumptions and exact startup commands in active task notes.

## storage-migration-review
- Treat MongoDB shape changes as migrations.
- Require rollback notes and compatibility review.

## release-validation
- Preserve Yarn, TypeScript build, and runtime scripts.
- Never require workspace-root files for relay release or deployment.
