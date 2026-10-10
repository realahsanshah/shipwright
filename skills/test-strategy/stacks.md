# Test conventions by stack

Prefer the runner the project already uses (see its CLAUDE.md). These are defaults.

## Node / TypeScript

| Runner | File naming | Run one test | Coverage |
|---|---|---|---|
| node:test | `*.test.mjs`, `*.test.js` | `node --test path/to/file.test.mjs` (add `--test-name-pattern "name"`) | `node --test --experimental-test-coverage` |
| vitest | `*.test.ts`, `*.spec.ts` | `npx vitest run path/to/file.test.ts -t "name"` | `npx vitest run --coverage` |
| jest | `*.test.ts`, `__tests__/` | `npx jest path/to/file.test.ts -t "name"` | `npx jest --coverage` |
| Playwright (e2e) | `*.spec.ts` in `e2e/` or `tests/` | `npx playwright test path/to/file.spec.ts -g "name"` | not applicable |

## Python

| Runner | File naming | Run one test | Coverage |
|---|---|---|---|
| pytest | `test_*.py`, `*_test.py` | `pytest path/test_x.py::test_name` | `pytest --cov=<package>` (needs pytest-cov) |

FastAPI: use `TestClient` (Starlette) or `httpx.AsyncClient` with `ASGITransport` for endpoint tests.

## .NET

| Runner | File naming | Run one test | Coverage |
|---|---|---|---|
| xunit | `*Tests.cs` in a `*.Tests` project | `dotnet test --filter "FullyQualifiedName~TestName"` | `dotnet test --collect:"XPlat Code Coverage"` |

ASP.NET Core endpoints: use `WebApplicationFactory<Program>` for integration tests.

## React

| Runner | File naming | Run one test | Coverage |
|---|---|---|---|
| Testing Library + vitest or jest | `Component.test.tsx` beside the component | `npx vitest run Component.test.tsx -t "name"` or `npx jest Component.test.tsx -t "name"` | `--coverage` on either runner |

Query by role and visible text, not by class names or implementation details.

## React Native

| Runner | File naming | Run one test | Coverage |
|---|---|---|---|
| jest + React Native Testing Library | `Component.test.tsx` or `__tests__/` | `npx jest path/to/file.test.tsx -t "name"` | `npx jest --coverage` |
