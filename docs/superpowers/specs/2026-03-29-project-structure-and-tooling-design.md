# Project Structure & Tooling Setup — Design Spec

## Goal

Set up a professional Node.js/TypeScript project structure for live-city with all the support infrastructure equivalent to a well-configured Spring Boot project (SonarQube, JaCoCo, NullAway, etc.), aligned with DESIGN.md and inspired by pi-mono patterns.

## Scope

- Project directory structure matching DESIGN.md architecture
- Dependency corrections (replace mismatched deps with DESIGN.md-specified ones)
- Linting + formatting (Biome)
- Testing + code coverage (Vitest + v8)
- Pre-commit hooks (Husky)
- Structured logging in logfmt format (pino + pino-logfmt)
- Environment validation (dotenv + zod)
- Node version pinning (.nvmrc + engines)
- Git setup (.gitignore, .editorconfig, git init)

## Out of Scope

- Actual feature implementation (extraction, scheduling, Appwrite integration)
- CI/CD pipelines (GitHub Actions — can be added later)
- Mobile app / website setup

---

## 1. Tooling Decisions

All tooling choices are validated against pi-mono (the reference project) or justified by service-specific needs.

| Concern | Tool | Rationale |
|---|---|---|
| Lint + Format | **Biome** | Single tool, Rust-fast. Used by pi-mono. Replaces ESLint + Prettier. |
| Test + Coverage | **Vitest + v8 coverage** | Used by pi-mono. Fast, TS-native, built-in mocking. |
| Pre-commit hooks | **Husky** | Used by pi-mono. Runs Biome check + type check before commits. |
| Null safety | **TypeScript strict mode** | Already enabled. Equivalent to NullAway. |
| Logging | **pino + pino-logfmt** | Service-specific: long-running scheduled jobs need structured logs with levels and timestamps. logfmt format per user preference. |
| Env validation | **dotenv + zod** | Service-specific: required config (Appwrite creds) must fail fast at startup, not during a 3am job. |
| Node version | **.nvmrc + engines** | Pin Node version. pi-mono uses engines field. |

## 2. Dependency Corrections

### Remove (not in DESIGN.md)

- `hono`, `@hono/node-server` — no custom API server needed
- `better-sqlite3`, `@types/better-sqlite3` — using Appwrite, not SQLite
- `drizzle-orm`, `drizzle-kit` — using Appwrite, not SQL
- `@mozilla/readability`, `linkedom` — browser-tools skill handles extraction
- `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core` — using full `pi-coding-agent` SDK instead

### Add (from DESIGN.md)

- `@mariozechner/pi-coding-agent` — agent SDK with OAuth, skills, tools
- `node-appwrite` — server SDK for Appwrite
- `node-cron` — keep (already present, in DESIGN.md)
- `yaml` — keep (already present, in DESIGN.md)

### Add (tooling)

- `@biomejs/biome` — lint + format
- `vitest` — testing
- `@vitest/coverage-v8` — code coverage
- `husky` — pre-commit hooks
- `pino` — logging framework
- `pino-logfmt` — logfmt transport for pino
- `dotenv` — .env file loading
- `zod` — env/config schema validation
- `tsx` — keep (already present, dev runner)
- `typescript` — keep (already present)
- `@types/node` — keep
- `@types/node-cron` — keep

## 3. Project Structure

```
live-city/
├── src/
│   ├── config/                  # @Configuration equivalent
│   │   ├── env.ts               # Env validation with zod (fail fast)
│   │   └── loader.ts            # YAML city config loader
│   ├── core/                    # Domain layer
│   │   ├── types.ts             # Domain interfaces (schemas, DTOs)
│   │   └── errors.ts            # Custom error hierarchy
│   ├── extraction/              # @Service layer
│   │   ├── extractor.ts         # AI extraction via pi-coding-agent
│   │   └── validator.ts         # Schema validation on extracted data
│   ├── scheduler/               # @Scheduled equivalent
│   │   └── scheduler.ts         # node-cron job orchestration
│   ├── storage/                 # @Repository layer
│   │   └── appwrite.ts          # Appwrite client + persistence
│   ├── utils/                   # Cross-cutting concerns
│   │   └── logger.ts            # pino + logfmt setup
│   └── index.ts                 # Entry point (Application.java main)
├── test/
│   ├── unit/                    # Fast isolated tests
│   │   └── .gitkeep
│   └── integration/             # Tests with external deps
│       └── .gitkeep
├── config/
│   └── cities/
│       └── bengaluru.yaml       # Per-city config (like Spring profiles)
├── .husky/
│   └── pre-commit               # Quality gate before commits
├── biome.json                   # Lint + format rules
├── tsconfig.json                # TypeScript config (strict)
├── vitest.config.ts             # Test + coverage config
├── .nvmrc                       # Node version pin
├── .env.example                 # Env template (documented)
├── .editorconfig                # Editor consistency
├── .gitignore                   # Comprehensive ignores
├── package.json                 # Corrected dependencies
└── DESIGN.md                    # Existing design doc
```

## 4. Configuration Details

### biome.json

Follows pi-mono style with adjustments for a single-package project:
- Linter: recommended rules enabled, `noExplicitAny: off` (practical for AI SDK integration), `useConst: error`
- Formatter: tabs, line width 120 (matches pi-mono)
- Scope: `src/**/*.ts`, `test/**/*.ts`

### vitest.config.ts

- Test dirs: `test/unit`, `test/integration`
- Coverage provider: v8
- Coverage thresholds: initially 0% (enforced as code is added)
- Coverage reporters: text, lcov (for IDE integration)

### tsconfig.json

Updated to match pi-mono's base config:
- `target: ES2022`, `module: Node16`, `moduleResolution: Node16`
- `strict: true`, `declaration: true`, `sourceMap: true`
- `resolveJsonModule: true`

### .husky/pre-commit

Runs sequentially:
1. `biome check --write` (format + lint, auto-fix)
2. `tsc --noEmit` (type check)
3. Re-stage auto-fixed files

### .env.example

Documents all required environment variables:
- `APPWRITE_ENDPOINT` — Appwrite cloud URL
- `APPWRITE_PROJECT_ID` — project identifier
- `APPWRITE_API_KEY` — server API key
- `LOG_LEVEL` — pino log level (default: info)
- `NODE_ENV` — environment (development/production)

### package.json scripts

```json
{
  "build": "tsc",
  "start": "node dist/index.js",
  "dev": "tsx watch src/index.ts",
  "check": "biome check --write --error-on-warnings . && tsc --noEmit",
  "lint": "biome check .",
  "format": "biome format --write .",
  "test": "vitest --run",
  "test:watch": "vitest",
  "test:coverage": "vitest --run --coverage",
  "prepare": "husky"
}
```

## 5. Spring Boot Equivalence Summary

| Spring Boot | live-city Equivalent |
|---|---|
| `@SpringBootApplication` + `main()` | `src/index.ts` entry point |
| `application.yml` + `@Profile` | `config/cities/*.yaml` + `.env` |
| `@Configuration` + `@Bean` | `src/config/env.ts` (zod-validated) |
| `@Service` | `src/extraction/` module |
| `@Repository` | `src/storage/` module |
| `@Scheduled` / Quartz | `src/scheduler/` with node-cron |
| Domain DTOs / Entities | `src/core/types.ts` |
| Custom exceptions | `src/core/errors.ts` |
| SonarQube + Checkstyle | Biome (lint + format) |
| JaCoCo | Vitest + v8 coverage |
| NullAway | TypeScript `strict: true` |
| JUnit + Mockito | Vitest (built-in mocking) |
| Maven Enforcer + git hooks | Husky pre-commit |
| Logback + logfmt encoder | pino + pino-logfmt |
| `.mvnw` / Java version | `.nvmrc` + `engines` |
