# CI, Docker, and Release v0.1.0

## Objective
Add repository-local CI, DockerHub publishing, and GitHub Release automation for
`rw-girs` v0.1.0.

## Ownership
Primary repository: `rw-girs`.

Supporting repositories/services:
- DockerHub repository `${DOCKER_USERNAME}/rw-girs`
- GitHub Actions and GitHub Releases for this repository

## Dependencies
- Node.js 24
- Yarn 4 as configured by `.yarnrc.yml`
- Docker Buildx in GitHub Actions
- Repository secrets `DOCKER_USERNAME` and `DOCKER_PASSWORD`

## Affected Repositories/Services
- `rw-girs`
- DockerHub image `${DOCKER_USERNAME}/rw-girs`
- GitHub Release `v0.1.0`

## Risks
- Missing or invalid DockerHub secrets will fail non-PR publishing jobs.
- DockerHub repository permissions must allow pushing `${DOCKER_USERNAME}/rw-girs`.
- The Docker runtime image depends on the built `dist/main.js` entry point and
  the repository's current dependency graph.

## Validation Strategy
- Run `yarn build`.
- Run `yarn test`.
- Run `docker build -t rw-girs:test .`.
- In local sandboxes without Docker socket access, defer Docker image validation
  to GitHub Actions or a user shell with Docker permissions.
- Verify pull requests build Docker images without pushing.
- Verify `main` pushes publish only `latest`.
- Verify `v*` tag pushes publish only versioned tags and create a GitHub
  Release.

## Rollback Considerations
Revert `.github/workflows/ci.yml`, `Dockerfile`, `.dockerignore`, and related
documentation if the publishing flow needs to be disabled. Remove any incorrect
DockerHub tags manually if a release is pushed with the wrong metadata.

## Checklist
- [x] Add Docker build artifacts.
- [x] Add CI workflow for build, test, Docker build, DockerHub push, and GitHub
  Release.
- [x] Document DockerHub image usage and release behavior.
- [x] Validate local build and contract smoke test.
- [x] Validate Docker image build and healthcheck on an available Docker host.
- [ ] Publish `v0.1.0` after the checked commit is merged to `main`.

## Validation Notes
- `yarn install --immutable`, `yarn build`, and `yarn test` passed on 2026-06-08.
- A clean `rw-girs:plan-close` image build and isolated container healthcheck passed on `strato.V80` on 2026-06-08.
- GitHub currently has no `v0.1.0` release. Do not publish until the uncommitted Docker/README/Compose changes are reviewed and committed.
