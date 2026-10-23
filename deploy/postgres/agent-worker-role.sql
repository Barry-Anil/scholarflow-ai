-- Run in the Supabase SQL Editor after creating the login with a strong,
-- separately managed password. BYPASSRLS is limited by the explicit grants.
alter role scholarflow_agent_worker bypassrls;
grant connect on database postgres to scholarflow_agent_worker;
grant usage on schema public to scholarflow_agent_worker;

grant select on table
  public.courses,
  public.course_members,
  public.assignments,
  public.assignment_questions,
  public.rubric_criteria,
  public.documents,
  public.document_chunks,
  public.assignment_drafts,
  public.draft_answers,
  public.answer_citations,
  public.research_findings,
  public.review_reports,
  public.review_findings,
  public.revision_history,
  public.agent_runs,
  public.agent_run_events,
  public.usage_records,
  public.processing_job_diagnostics,
  public.processing_jobs,
  public.agent_worker_heartbeats
to scholarflow_agent_worker;

grant insert, update on table
  public.assignments,
  public.assignment_drafts,
  public.draft_answers,
  public.answer_citations,
  public.research_findings,
  public.review_reports,
  public.review_findings,
  public.revision_history,
  public.agent_runs,
  public.agent_run_events,
  public.usage_records,
  public.processing_job_diagnostics,
  public.processing_jobs,
  public.agent_worker_heartbeats
to scholarflow_agent_worker;
