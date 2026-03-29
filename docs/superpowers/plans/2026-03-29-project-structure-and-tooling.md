# Project Structure & Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up all project tooling and infrastructure (Biome, Vitest, Husky, etc.) with corrected dependencies — no application code.

**Architecture:** Single-package TypeScript project with Biome for lint+format, Vitest for test+coverage, Husky for pre-commit hooks, pino+logfmt for logging, dotenv+zod for env validation. Follows pi-mono patterns where applicable.

**Tech Stack:** TypeScript 5.x, Biome, Vitest, Husky, pino, zod, Node 22

---

### Task 1: Git + .gitignore + .editorconfig + .nvmrc

**Files:**
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `.nvmrc`

- [ ] **Step 1: Create .gitignore**

Based on pi-mono's `.gitignore`, adapted for single-package project:

```gitignore
# Dependencies
node_modules/

# Build output
dist/

# Environment
.env

# Logs
*.log

# OS files
.DS_Store

# Editor files
.vscode/
.zed/
.idea/
*.swp
*.swo
*~

# Test / coverage
coverage/
.nyc_output/

# TypeScript
*.tsbuildinfo

# Misc
*.cpuprofile
```

- [ ] **Step 2: Create .editorconfig**

```editorconfig
root = true

[*]
indent_style = tab
indent_size = 3
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false

[*.yaml]
indent_style = space
indent_size = 2
```

- [ ] **Step 3: Create .nvmrc**

```
22
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore .editorconfig .nvmrc
git commit -m "chore: add gitignore, editorconfig, nvmrc"
```

---

### Task 2: Rewrite package.json with corrected dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Rewrite package.json**

Replace entire contents with corrected dependencies aligned to DESIGN.md:

```json
{
  "name": "live-city",
  "version": "0.1.0",
  "type": "module",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
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
  },
  "dependencies": {
    "@mariozechner/pi-coding-agent": "latest",
    "node-appwrite": "^14.0.0",
    "node-cron": "^3.0.0",
    "yaml": "^2.0.0",
    "pino": "^9.0.0",
    "pino-logfmt": "^0.3.0",
    "dotenv": "^16.0.0",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "@biomejs/biome": "2.3.5",
    "@types/node": "^22.0.0",
    "@types/node-cron": "^3.0.0",
    "husky": "^9.1.7",
    "tsx": "^4.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0",
    "@vitest/coverage-v8": "^3.2.0"
  }
}
```

- [ ] **Step 2: Delete old node_modules and lock file, then install**

```bash
rm -rf node_modules package-lock.json
npm install
```

- [ ] **Step 3: Verify install succeeded**

Run: `ls node_modules/@biomejs/biome node_modules/vitest node_modules/pino`
Expected: directories exist, no errors

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: correct dependencies to match DESIGN.md, add tooling deps"
```

---

### Task 3: Update tsconfig.json

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1: Rewrite tsconfig.json**

Aligned with pi-mono's `tsconfig.base.json`, adapted for single-package:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 2: Commit**

```bash
git add tsconfig.json
git commit -m "chore: update tsconfig to match pi-mono base config"
```

---

### Task 4: Create biome.json

**Files:**
- Create: `biome.json`

- [ ] **Step 1: Create biome.json**

Based on pi-mono's config, adapted for single-package:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.3.5/schema.json",
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "noNonNullAssertion": "off",
        "useConst": "error"
      },
      "suspicious": {
        "noExplicitAny": "off"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "indentWidth": 3,
    "lineWidth": 120
  },
  "files": {
    "includes": ["src/**/*.ts", "test/**/*.ts"],
    "ignore": ["node_modules", "dist"]
  }
}
```

- [ ] **Step 2: Verify biome works**

Run: `npx biome check .`
Expected: no errors (no source files yet to lint)

- [ ] **Step 3: Commit**

```bash
git add biome.json
git commit -m "chore: add biome config for linting and formatting"
```

---

### Task 5: Create vitest.config.ts

**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/index.ts"],
			reporter: ["text", "lcov"],
		},
	},
});
```

- [ ] **Step 2: Verify vitest works**

Run: `npx vitest --run`
Expected: "No test files found" (no tests yet, but no config errors)

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: add vitest config with v8 coverage"
```

---

### Task 6: Set up Husky pre-commit hook

**Files:**
- Create: `.husky/pre-commit`

- [ ] **Step 1: Initialize husky**

```bash
npx husky init
```

This creates `.husky/` directory with a sample pre-commit hook.

- [ ] **Step 2: Write pre-commit hook**

Replace `.husky/pre-commit` contents with:

```sh
#!/bin/sh

# Get list of staged files before running checks
STAGED_FILES=$(git diff --cached --name-only)

# Format + lint
echo "Running biome check..."
npm run check
if [ $? -ne 0 ]; then
  echo "❌ Checks failed. Please fix the errors before committing."
  exit 1
fi

# Re-stage files that may have been auto-formatted
for file in $STAGED_FILES; do
  if [ -f "$file" ]; then
    git add "$file"
  fi
done

echo "✅ All pre-commit checks passed!"
```

- [ ] **Step 3: Verify hook is executable**

Run: `ls -la .husky/pre-commit`
Expected: `-rwxr-xr-x` permissions

If not: `chmod +x .husky/pre-commit`

- [ ] **Step 4: Commit**

```bash
git add .husky/
git commit -m "chore: add husky pre-commit hook with biome + tsc checks"
```

---

### Task 7: Create scaffolding and placeholder files

**Files:**
- Create: `src/index.ts`
- Create: `test/unit/.gitkeep`
- Create: `test/integration/.gitkeep`
- Create: `config/cities/.gitkeep`
- Create: `.env.example`

- [ ] **Step 1: Create directory scaffolding**

```bash
mkdir -p src test/unit test/integration config/cities
```

- [ ] **Step 2: Create minimal src/index.ts**

```ts
console.log("live-city starting...");
```

- [ ] **Step 3: Create .gitkeep files**

```bash
touch test/unit/.gitkeep test/integration/.gitkeep config/cities/.gitkeep
```

- [ ] **Step 4: Create .env.example**

```env
# Appwrite
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=
APPWRITE_API_KEY=

# Logging
LOG_LEVEL=info

# Environment
NODE_ENV=development
```

- [ ] **Step 5: Verify the full toolchain works end-to-end**

Run each command and confirm:

```bash
# Build
npm run build
# Expected: compiles successfully, dist/index.js created

# Check (lint + format + type check)
npm run check
# Expected: passes with no errors

# Test
npm run test
# Expected: "No test files found" — no config errors

# Dev
npm run dev &
# Expected: "live-city starting..." printed, then watching
# Kill it: kill %1
```

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/ config/ .env.example
git commit -m "chore: add scaffolding, placeholder entry point, env template"
```

---

### Task 8: Remove stale files and final cleanup

**Files:**
- Delete: `.idea/` (if present, IDE-generated)

- [ ] **Step 1: Check for stale files that should be ignored**

```bash
git status
```

Verify `.idea/`, `node_modules/`, `dist/` are properly ignored by `.gitignore`.

- [ ] **Step 2: Remove .idea from git tracking if it was committed**

```bash
git rm -r --cached .idea/ 2>/dev/null || true
```

- [ ] **Step 3: Final verification — full toolchain smoke test**

```bash
npm run build && npm run check && npm run test
```

Expected: build succeeds, check passes, test reports no files (no errors).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: project tooling setup complete"
```
