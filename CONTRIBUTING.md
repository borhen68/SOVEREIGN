# Contributing to SOVEREIGN

## Quick Start
1. Fork and clone the repo.
2. Install dependencies: `npm install`
3. Run tests: `npm test`
4. Start API: `npm run start`

## Branch and PR Rules
- Use focused branches and small PRs.
- Add tests for behavior changes.
- Keep API changes documented in `README.md`.
- Do not include secrets in commits.

## Commit Style
Use clear commit messages:
- `feat: ...`
- `fix: ...`
- `docs: ...`
- `test: ...`
- `chore: ...`

## Development Standards
- Keep behavior deterministic and idempotent where possible.
- Respect runtime policy and security controls.
- Add migration notes when changing persisted state schema.

## Pull Request Checklist
- [ ] Tests pass locally.
- [ ] New behavior has tests.
- [ ] README/docs updated.
- [ ] No secrets in code or logs.
