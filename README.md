# ScholarFlow AI

ScholarFlow AI is an evidence-led academic assignment workspace. Its target workflow is:

`Student Agent drafts → Research Agent verifies → Reviewer Agent evaluates → Student Agent revises`

The application treats course material as the primary knowledge source, preserves immutable draft and review history, reports uncertainty, and requires the student to approve final work. It does not promise a grade or submit work to university systems.

## Current implementation

Implemented and verified:

- Next.js 16.4 App Router foundation with strict TypeScript and Tailwind CSS 4.
- Responsive landing, setup, authentication, and protected dashboard experiences.
- Supabase email/password signup, verification callback, login, recovery, password update, session refresh, and sign-out.
- Server-side authentication checks in the data-access layer and every implemented mutation.
- Transactional course creation with persisted owner membership.
- Live dashboard counts and honest empty states—no production-path mock records.
- Drizzle schema and migrations for all required workspace, document, agent, evidence, review, revision, usage, and export records.
- Local Ollama embeddings, pgvector HNSW search, PostgreSQL full-text search, and reciprocal-rank fusion with automatic keyword fallback.
- Supabase Auth foreign keys, automatic profile provisioning, updated-at triggers, and RLS on all 22 application tables.
- Private Supabase Storage policies that grant course members read access and editors upload access for supported material types.
- Course knowledge workspaces with authenticated PDF, DOCX, TXT, Markdown, and CSV uploads up to 25 MB.
- SHA-256 duplicate detection, private Storage paths, persistent processing jobs, bounded retries, and visible failures.
- Server-side PDF page extraction, bounded DOCX ZIP/XML extraction, text normalization, deterministic overlapping chunks, and page attribution.
- Course-scoped hybrid retrieval with source filenames, page references, embedding coverage, and resumable 32-chunk backfill batches.
- Assignment workspaces that preserve the original brief, parse numbered questions and rubric criteria, and record the external-research policy.
- Per-question Markdown editing with word-limit context, explicit saves, immutable draft versions, and restored latest answers.
- Persisted Agent C runs that retrieve owner-scoped course passages first, optionally supplement evidence gaps with Crossref publication abstracts, and record actual activity events and research gaps.
- Persisted Agent B runs using schema-validated Ollama output, evidence-only prompts, structured citations, per-answer confidence reasons, immutable AI draft versions, and usage records.
- Independent Agent A runs that review the latest complete draft per question, verify citations against retrieved evidence, record severity-ranked findings and uncertainty, and enforce explicit quality gates without claiming a guaranteed grade.
- Student-controlled finding decisions and bounded Agent B revision cycles that create immutable drafts, reuse only saved evidence, retain change history, and pause for inspection before another independent review.
- Per-question agent jobs processed through authenticated bounded requests, with browser-driven resume, stale-lock recovery, idempotent retries, and hidden partial AI drafts.
- Citation allow-listing that removes model-invented source IDs and caps unsupported answer confidence below 50; citations remain unverified until independent review.
- Per-assignment concurrency protection, rolling daily agent limits, bounded provider timeouts, and actionable failure states.
- Deterministic unit/security tests with no paid provider dependency.
- Metadata-honest inline citations and reference lists sourced only from persisted citation fields.
- Strict, version-bound student approval that requires a passed Agent A report, verified citations, and no active agent work.
- Audited Markdown, DOCX, and PDF export jobs with bounded retries, private owner-scoped Storage, and short-lived signed downloads.
- Atomic PostgreSQL rate limits for authentication, uploads, workspace mutations, agent queues, workers, approvals, exports, and downloads; identifiers are stored only as one-way hashes.
- Correlated structured logs, sanitized uncaught-request instrumentation, public liveness, and secret-protected database readiness checks.
- Global CSP, clickjacking, MIME-sniffing, referrer, permissions, cross-origin opener, and production HSTS response headers.
- Standalone non-root Docker deployment, deterministic GitHub Actions quality/container builds, and an isolated hosted-Chrome workflow.
- Chrome coverage for real document ingestion/retrieval and the complete assignment approval/export/download path.
- Owner/editor/viewer collaboration: owners manage registered members, editors run the academic workflow, viewers can inspect and download without mutating work, and outsiders remain isolated by RLS.

Not implemented yet:

- Automated infrastructure provisioning and a live production deployment remain environment-owner decisions.

## Knowledge-base workflow

Open a course from the dashboard to reach its knowledge workspace. Uploading a document performs this sequence:

1. Re-authorize the signed-in user against the target course.
2. Validate the file type and 25 MB limit, then compute a SHA-256 digest.
3. Store the original in the private `course-materials` bucket under `{user}/{course}/{document}/...`.
4. Persist the document and resumable processing job in one database transaction.
5. Extract and normalize text, replace any previous chunks transactionally, and record the final status.

PDF extraction is capped at 500 pages. DOCX extraction reads only bounded Word text XML parts and ignores embedded binaries. Failed jobs remain visible and may be retried up to their recorded attempt limit. Search results always identify the source and include a page number when the source format provides one.

## Assignment workflow

Open **Assignments** from a course knowledge workspace. Creation stores the complete brief, converts numbered questions and their bullet points into a structured outline, and parses one rubric criterion per line. Percentages such as `(40%)` are retained as rubric weights.

The editor stores Markdown per question. Each explicit save creates a new immutable `assignment_drafts` version and matching per-question answer records; reopening the workspace restores the latest version. Student-authored answers are recorded as not yet evaluated rather than receiving a fabricated confidence score. Agent B answers include confidence reasons, while Agent A records independent findings, citation verification, quality-gate results, and remaining uncertainty.

## Agent A, Agent B, and Agent C workflow

The assignment workspace exposes three separate operations:

1. **Agent C research** searches accessible indexed course passages first using hybrid semantic and keyword retrieval. If Ollama embeddings are unavailable, retrieval falls back to keyword search. When fewer than two local passages match a question and the assignment permits external research, it queries Crossref's public REST API for publication abstracts. Findings retain source IDs, titles, excerpts, locators, limitations, and the run that produced them. No search API key is required.
2. **Agent B drafting** uses the latest completed Agent C run. Ollama receives untrusted evidence in a clearly delimited prompt and must return a Zod-validated structured answer. Citations not present in the supplied source allow-list are removed. Each run creates a new immutable draft version; it never overwrites a student's work.
3. **Agent A review** evaluates the latest complete draft independently from Agent B. It checks the brief, rubric, reasoning, evidence, and exact citation allow-list; stores critical, major, minor, and suggestion findings; and passes quality gates only when every question is reviewed, required findings are resolved, citations are verified, and review confidence is sufficient. A passing report still requires student inspection and approval.
4. **Controlled revision** lets the student accept or reject each finding and add an optional note. Agent B revises only accepted findings from the reviewed draft and latest saved Agent C evidence, creates a new immutable version, records the cycle in revision history, and stops for student inspection. A later Agent A run must explicitly verify prior finding IDs before they become resolved.

Each operation is queued as one persisted job per assignment question. The authenticated workspace processes one bounded job request at a time and resumes remaining work when the page is reopened. Stale locks are recoverable, completed question work is idempotent, and an Agent B draft remains hidden until its full run completes. Failed runs and provider errors remain visible in the activity timeline. Revision automation stops at `MAX_AGENT_ITERATIONS`; manual editing remains available. Agent B requires a running Ollama service and the configured writer model; Agent C's local retrieval works without an AI provider.

## Requirements

- Node.js 22+
- npm
- A Supabase project, or the Supabase CLI and Docker for local development
- Ollama is optional for manual editing and keyword retrieval, but required for semantic retrieval, Agent B drafting, and Agent A review

## Local setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy the environment template:

   ```powershell
   Copy-Item .env.example .env.local
   ```

3. Add your Supabase URL, publishable key (or legacy anon key), service-role key, and PostgreSQL connection string. Never expose the service-role key through a `NEXT_PUBLIC_` variable.

4. Apply the migrations:

   ```powershell
   npm run db:migrate
   ```

   For local Supabase, run `supabase start` first and use the database URL shown by `supabase status` as `DATABASE_URL`.

5. In Supabase Auth URL configuration, set the site URL to `http://localhost:3000` and allow `http://localhost:3000/auth/callback` as a redirect URL.

6. Start the application:

   ```powershell
   npm run dev
   ```

Without Supabase public configuration, the landing page and `/setup` remain available and protected routes redirect to setup. The application does not fabricate authentication or database responses.

## Supabase notes

The migrations expect a Supabase database because they reference the `auth` and `storage` schemas. They:

- create `pgcrypto` and `vector` extensions;
- create the normalized public schema;
- link owner identities to `auth.users`;
- provision a profile after signup;
- enable RLS on every public application table;
- create private `course-materials` and `assignment-exports` buckets with type and size limits; and
- authorize private objects through their course or assignment relationship.

Course owners can add existing registered accounts as editors or viewers. Editors can upload evidence and create, draft, research, review, revise, approve, and export assignments. Viewers have read-only access to course evidence and completed workspace results. Only owners can manage membership or delete the course; live RLS integration tests cover owner, editor, viewer, and outsider behavior.

Use a direct database connection for migrations. Runtime queries disable prepared statements for compatibility with Supabase poolers.

## Production operations and deployment

`GET /api/health/live` is a dependency-free liveness check used by the container. `GET /api/health/ready` verifies application configuration and database connectivity; it requires `Authorization: Bearer <JOB_WORKER_SECRET>`. Set `JOB_WORKER_SECRET` to a unique value of at least 32 characters.

Build the portable image with the public Supabase values that should be embedded in the browser bundle:

```bash
docker build -t scholarflow-ai \
  --build-arg NEXT_PUBLIC_APP_URL=https://app.example.com \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://project.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key .
```

Inject `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JOB_WORKER_SECRET`, and optional AI configuration only at runtime. The image runs as the unprivileged `nextjs` user and exposes port 3000.

`.github/workflows/ci.yml` runs formatting, strict types, linting, deterministic tests, the production build, and a complete container build. `hosted-e2e.yml` is manual and requires the five `E2E_*` Supabase/database secrets; it keeps staging credentials out of pull-request jobs.

## Optional AI configuration

The environment template includes the active local-first provider settings used by Agents A and B and optional polite-pool identification used by Agent C.

For the local baseline:

1. Install [Ollama](https://ollama.com/).
2. Pull a writer/reviewer model and embedding model, for example:

   ```powershell
   ollama pull qwen3:8b
   ollama pull nomic-embed-text
   ```

3. Keep `AI_PROVIDER=ollama` and `OLLAMA_BASE_URL=http://localhost:11434`.

4. Keep `AI_EMBEDDING_DIMENSIONS=768` for the database vector schema. Existing chunks can be embedded from the course knowledge page in resumable batches of 32.

5. Optionally set `AI_REQUEST_TIMEOUT_MS`, `DAILY_AI_REQUEST_LIMIT`, and `MAX_AGENT_ITERATIONS`. Defaults are 90 seconds per model request, 100 agent runs per rolling 24 hours, and five revision cycles per assignment.

Crossref's public REST API is the optional external-research adapter, so it does not require an API key. Set `CROSSREF_CONTACT_EMAIL` to identify requests to Crossref's polite pool. External research remains disabled when the assignment policy disallows it. AI credentials stay server-only, and paid AI use defaults to disabled.

## Commands

| Command                          | Purpose                                         |
| -------------------------------- | ----------------------------------------------- |
| `npm run dev`                    | Start the Next.js development server            |
| `npm run build`                  | Create a production build                       |
| `npm run start:standalone`       | Run the generated standalone production server  |
| `npm run lint`                   | Run ESLint                                      |
| `npm run typecheck`              | Run strict TypeScript checking                  |
| `npm test`                       | Run deterministic Vitest tests                  |
| `npm run test:integration:local` | Test migrations and RLS against local Supabase  |
| `npm run test:e2e:chrome`        | Run hosted Chrome knowledge and assignment E2E  |
| `npm run format:check`           | Verify Prettier formatting                      |
| `npm run db:generate`            | Generate a migration after schema changes       |
| `npm run db:migrate`             | Apply tracked migrations                        |
| `npm run db:studio`              | Open Drizzle Studio                             |
| `npm run verify:rate-limit`      | Verify the live atomic counter and denial limit |

## Architecture

- `src/app/` — routes, layouts, callback handler, and request proxy.
- `src/components/` — reusable design-system components.
- `src/features/` — authentication, courses, dashboard, knowledge, assignment, and persisted agent workflow use cases.
- `src/lib/ai/` — typed provider contracts and the Ollama structured-output adapter.
- `src/lib/research/` — fixed-endpoint external research adapters.
- `src/lib/auth/` — Supabase clients and server-only session checks.
- `src/lib/db/` — Drizzle client and domain-separated schema.
- `src/lib/validation/` — shared Zod contracts.
- `drizzle/` — versioned structural and Supabase security migrations.
- `tests/` — deterministic unit and security checks.
- `ui-registry.md` — visual consistency rules captured by component type.

Privileged reads and writes belong in server-only data-access modules. `src/proxy.ts` refreshes sessions and performs optimistic redirects only; it is not the authorization boundary.

## Verification

Phases 1–6 are checked with formatting, ESLint, strict TypeScript, deterministic mocked-provider tests, hosted Chrome E2E flows, a production build, migration verification, rendered DOCX/PDF inspection, response-header/health checks, and a standalone container build. Standard tests never require a paid provider or local model. Dependency advisories are reviewed separately and are not force-fixed through breaking downgrades.

The local integration suite creates temporary confirmed users, verifies RLS and cross-user isolation through the `authenticated` database role, checks the private Storage bucket, and removes its test users afterward. Start Supabase, apply migrations, then run `npm run test:integration:local`.

## Privacy and academic integrity

- Process only material you are authorized to use.
- Private documents and credentials must never be logged or included in exports.
- Uploaded content is untrusted and must not be allowed to override system instructions.
- AI confidence labels are heuristics, not probabilities or official grades.
- Students remain responsible for citation verification, academic-integrity compliance, and final submission.
