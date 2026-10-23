# Durable agent worker

## Root cause and architecture

The former `POST /api/agent-jobs/[jobId]` route claimed and processed an AI job inside a Vercel request. Agent A sends one structured Ollama call per question with the draft, rubric, evidence, prior findings, and JSON schema. CPU-only inference can outlive the HTTP request, so the request timeout incorrectly became the workflow timeout.

Agent start actions now only persist `agent_runs`, `processing_jobs`, reports, and draft placeholders. The authenticated job endpoint is read-only. A systemd worker on the Ollama host claims database jobs, renews a lease, runs the existing agent code, and persists the existing immutable results and events. A PostgreSQL session advisory lock and a serial worker loop prevent concurrent CPU generation.

Transient AI/network/database failures retry up to `max_attempts`. The first retry waits 15 seconds and later retries wait 60 seconds. Invalid context and authorization failures are terminal. A terminal failure retains the existing behavior: the run fails, queued sibling jobs are cancelled, review reports remain failed, and no successful review is claimed.

## Database migration

Apply `drizzle/0007_mysterious_stature.sql`. It adds nullable lease fields and a protected diagnostics table, so existing jobs and assignment data are not rewritten:

- `lease_expires_at`
- `last_error_code`
- `processing_job_diagnostics`, an RLS-protected table with no browser-role grants
- `processing_jobs_lease_idx`

Create the login with a unique password in the Supabase SQL Editor, then paste
and run `deploy/postgres/agent-worker-role.sql` in a second query:

```sql
create role scholarflow_agent_worker
with login password 'REPLACE_WITH_A_UNIQUE_WORKER_PASSWORD'
bypassrls;
```

Alternatively, from an Ubuntu shell with `psql` installed, apply the grants with
`psql "$ADMIN_DATABASE_URL" -f deploy/postgres/agent-worker-role.sql`. Do not
paste that shell command into the SQL Editor. The worker role has `BYPASSRLS`
because it has no user JWT; explicit table grants limit its access. Do not use
this connection in browser or `NEXT_PUBLIC_*` variables.

For the long-running worker, use the direct Supabase endpoint on port `5432` or
the shared **session pooler** on port `5432`. Do not use the transaction pooler
on port `6543`: the worker's singleton advisory lock is session-scoped. With the
shared pooler, the custom-role username is
`scholarflow_agent_worker.PROJECT_REF`.

## Ubuntu installation

```bash
sudo useradd --system --home /opt/scholarflow-ai --shell /usr/sbin/nologin scholarflow
sudo mkdir -p /opt/scholarflow-ai /etc/scholarflow
sudo chown -R scholarflow:scholarflow /opt/scholarflow-ai
sudo -u scholarflow git clone YOUR_REPOSITORY_URL /opt/scholarflow-ai
cd /opt/scholarflow-ai
sudo -u scholarflow npm ci
sudo install -o root -g root -m 600 deploy/systemd/agent-worker.env.example /etc/scholarflow/agent-worker.env
sudo editor /etc/scholarflow/agent-worker.env
sudo install -o root -g root -m 644 deploy/systemd/scholarflow-agent-worker.service /etc/systemd/system/scholarflow-agent-worker.service
sudo systemctl daemon-reload
sudo systemctl enable --now scholarflow-agent-worker
sudo systemctl status scholarflow-agent-worker
journalctl -u scholarflow-agent-worker -f
```

Use `OLLAMA_URL=http://127.0.0.1:11434` on this host. Cloudflare Access remains enabled on the public hostname; the worker does not need Cloudflare credentials for localhost. If localhost is unavailable, use the protected HTTPS URL and add both `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` to the root-owned worker environment file.

## Vercel variables

Keep the existing application variables:

- `DATABASE_URL`
- Supabase public URL, publishable key, and service-role key
- `JOB_WORKER_SECRET`
- `OLLAMA_URL=https://ollama.elevateai360.com`
- `OLLAMA_MODEL` and optional role-specific model variables
- both Cloudflare Access service-token variables

Worker lease variables are not required in Vercel. Vercel no longer executes queued AI jobs. Its AI settings remain useful for the protected AI health endpoint.

## Deployment sequence

1. Back up the database and record the currently deployed commit.
2. Deploy the additive migration.
3. Create and verify the restricted worker role.
4. Install the repository and worker environment on Ubuntu.
5. Stop the worker until the web deployment is ready.
6. Deploy the Next.js application.
7. Start the systemd worker and inspect structured logs.
8. Enqueue one research run, one draft, and one Agent A review.

## End-to-end verification

1. Start an agent operation and confirm the action returns promptly.
2. Close or reload the assignment page; the job must continue.
3. Confirm `processing_jobs.locked_by`, `lease_expires_at`, and `attempts` update while the worker runs.
4. Confirm the page polls with `GET` and never sends a processing `POST`.
5. Stop the worker during a job. After the lease expires, restart it and confirm the job is reclaimed without duplicate answers, findings, citations, or events.
6. Temporarily stop Ollama and confirm retries are queued at 15 and 60 seconds.
7. Exhaust all attempts and confirm the job and run fail, siblings cancel, and the review is not presented as successful.
8. Run a successful Agent A review and verify all question events exist before the report and run become completed.
9. Verify another user cannot read the job status endpoint.

## Monitoring drawer

Apply `drizzle/0008_agent_worker_heartbeats.sql` and re-run
`deploy/postgres/agent-worker-role.sql` so the worker role can write
`agent_worker_heartbeats`. Without that grant the worker keeps processing jobs,
but the drawer reports the worker as "Never reported".

The worker records stage events (`*.question_started`,
`*.model_request_started`, `*.model_response_received`,
`*.model_request_failed`, `*.retry_scheduled`, `research.retrieval_completed`)
in `agent_run_events`. Event writes are best-effort and never fail a job. Jobs
processed before this change show "no stage reported yet".

The assignment workspace polls three read-only endpoints, each checking course
read access: `/api/assignments/:id/monitor`, `/monitor/events`, and
`/provenance`. The Ollama tags probe runs from the web server, is cached per
server instance for `AGENT_MONITOR_HEALTH_TTL_MS`, and only proves the server is
reachable and the models are installed; generation outcomes come from recorded
events and usage records.

To verify: start a run, open the monitor, and confirm that the stage changes to
"Waiting for the model" while Ollama works. Stop the worker and confirm that the
heartbeat turns stale and running tasks show as potentially stalled once the
lease expires, not as failed.

## Rollback

1. Stop and disable the worker: `sudo systemctl disable --now scholarflow-agent-worker`.
2. Roll the web application back to the previously recorded commit.
3. If reverting to synchronous processing temporarily, do so only after the old application is live; queued jobs remain in the database.
4. The migration is additive and may safely remain during application rollback.
5. After confirming no deployed code references the new columns, they may be removed in a later planned migration. Do not drop them during an incident.
6. Revoke the worker role with `revoke all privileges on all tables in schema public from scholarflow_agent_worker;` and disable its login if the worker is retired.
