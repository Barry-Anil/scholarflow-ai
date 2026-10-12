ALTER TABLE "document_chunks" ADD COLUMN "embedding_model" varchar(160);--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "embedded_at" timestamp with time zone;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.can_edit_assignment(target_assignment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.id = target_assignment_id AND private.can_edit_course(a.course_id)
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.can_access_draft(target_draft_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.assignment_drafts d
    WHERE d.id = target_draft_id AND private.can_access_assignment(d.assignment_id)
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.can_edit_draft(target_draft_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.assignment_drafts d
    WHERE d.id = target_draft_id AND private.can_edit_assignment(d.assignment_id)
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.can_access_answer(target_answer_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.draft_answers da
    WHERE da.id = target_answer_id AND private.can_access_draft(da.draft_id)
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.can_edit_answer(target_answer_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.draft_answers da
    WHERE da.id = target_answer_id AND private.can_edit_draft(da.draft_id)
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.can_access_review(target_report_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.review_reports r
    WHERE r.id = target_report_id AND private.can_access_assignment(r.assignment_id)
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.can_edit_review(target_report_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.review_reports r
    WHERE r.id = target_report_id AND private.can_edit_assignment(r.assignment_id)
  );
$$;
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS assignments_own_all ON public.assignments;
DROP POLICY IF EXISTS documents_own_all ON public.documents;
DROP POLICY IF EXISTS document_chunks_own_all ON public.document_chunks;
DROP POLICY IF EXISTS processing_jobs_own_all ON public.processing_jobs;
DROP POLICY IF EXISTS agent_runs_own_all ON public.agent_runs;
DROP POLICY IF EXISTS agent_run_events_own_all ON public.agent_run_events;
DROP POLICY IF EXISTS assignment_drafts_own_all ON public.assignment_drafts;
DROP POLICY IF EXISTS research_findings_own_all ON public.research_findings;
DROP POLICY IF EXISTS review_reports_own_all ON public.review_reports;
DROP POLICY IF EXISTS revision_history_own_all ON public.revision_history;
DROP POLICY IF EXISTS usage_records_own_all ON public.usage_records;
DROP POLICY IF EXISTS export_records_own_all ON public.export_records;
DROP POLICY IF EXISTS assignment_questions_owner_all ON public.assignment_questions;
DROP POLICY IF EXISTS rubric_criteria_owner_all ON public.rubric_criteria;
DROP POLICY IF EXISTS draft_answers_owner_all ON public.draft_answers;
DROP POLICY IF EXISTS answer_citations_owner_all ON public.answer_citations;
DROP POLICY IF EXISTS review_findings_owner_all ON public.review_findings;
DROP POLICY IF EXISTS draft_approvals_own_read ON public.draft_approvals;
DROP POLICY IF EXISTS draft_approvals_own_insert ON public.draft_approvals;
--> statement-breakpoint
CREATE POLICY assignments_course_read ON public.assignments FOR SELECT TO authenticated USING (private.can_access_course(course_id));
CREATE POLICY assignments_course_insert ON public.assignments FOR INSERT TO authenticated WITH CHECK (private.can_edit_course(course_id));
CREATE POLICY assignments_course_update ON public.assignments FOR UPDATE TO authenticated USING (private.can_edit_course(course_id)) WITH CHECK (private.can_edit_course(course_id));
CREATE POLICY assignments_course_delete ON public.assignments FOR DELETE TO authenticated USING (private.can_edit_course(course_id));
--> statement-breakpoint
CREATE POLICY documents_course_read ON public.documents FOR SELECT TO authenticated USING (private.can_access_course(course_id));
CREATE POLICY documents_course_write ON public.documents FOR ALL TO authenticated USING (private.can_edit_course(course_id)) WITH CHECK (private.can_edit_course(course_id));
CREATE POLICY document_chunks_course_read ON public.document_chunks FOR SELECT TO authenticated USING (private.can_access_course(course_id));
CREATE POLICY document_chunks_course_write ON public.document_chunks FOR ALL TO authenticated USING (private.can_edit_course(course_id)) WITH CHECK (private.can_edit_course(course_id));
CREATE POLICY processing_jobs_course_read ON public.processing_jobs FOR SELECT TO authenticated USING (private.can_access_course(course_id));
CREATE POLICY processing_jobs_course_write ON public.processing_jobs FOR ALL TO authenticated USING (private.can_edit_course(course_id)) WITH CHECK (private.can_edit_course(course_id));
--> statement-breakpoint
CREATE POLICY assignment_questions_course_read ON public.assignment_questions FOR SELECT TO authenticated USING (private.can_access_assignment(assignment_id));
CREATE POLICY assignment_questions_course_write ON public.assignment_questions FOR ALL TO authenticated USING (private.can_edit_assignment(assignment_id)) WITH CHECK (private.can_edit_assignment(assignment_id));
CREATE POLICY rubric_criteria_course_read ON public.rubric_criteria FOR SELECT TO authenticated USING (private.can_access_assignment(assignment_id));
CREATE POLICY rubric_criteria_course_write ON public.rubric_criteria FOR ALL TO authenticated USING (private.can_edit_assignment(assignment_id)) WITH CHECK (private.can_edit_assignment(assignment_id));
CREATE POLICY agent_runs_course_read ON public.agent_runs FOR SELECT TO authenticated USING (private.can_access_assignment(assignment_id));
CREATE POLICY agent_runs_course_write ON public.agent_runs FOR ALL TO authenticated USING (private.can_edit_assignment(assignment_id)) WITH CHECK (private.can_edit_assignment(assignment_id));
CREATE POLICY agent_run_events_course_read ON public.agent_run_events FOR SELECT TO authenticated USING (private.can_access_assignment(assignment_id));
CREATE POLICY agent_run_events_course_write ON public.agent_run_events FOR ALL TO authenticated USING (private.can_edit_assignment(assignment_id)) WITH CHECK (private.can_edit_assignment(assignment_id));
CREATE POLICY assignment_drafts_course_read ON public.assignment_drafts FOR SELECT TO authenticated USING (private.can_access_assignment(assignment_id));
CREATE POLICY assignment_drafts_course_write ON public.assignment_drafts FOR ALL TO authenticated USING (private.can_edit_assignment(assignment_id)) WITH CHECK (private.can_edit_assignment(assignment_id));
CREATE POLICY research_findings_course_read ON public.research_findings FOR SELECT TO authenticated USING (private.can_access_assignment(assignment_id));
CREATE POLICY research_findings_course_write ON public.research_findings FOR ALL TO authenticated USING (private.can_edit_assignment(assignment_id)) WITH CHECK (private.can_edit_assignment(assignment_id));
CREATE POLICY review_reports_course_read ON public.review_reports FOR SELECT TO authenticated USING (private.can_access_assignment(assignment_id));
CREATE POLICY review_reports_course_write ON public.review_reports FOR ALL TO authenticated USING (private.can_edit_assignment(assignment_id)) WITH CHECK (private.can_edit_assignment(assignment_id));
CREATE POLICY draft_approvals_course_read ON public.draft_approvals FOR SELECT TO authenticated USING (private.can_access_assignment(assignment_id));
CREATE POLICY draft_approvals_course_write ON public.draft_approvals FOR ALL TO authenticated USING (private.can_edit_assignment(assignment_id)) WITH CHECK (private.can_edit_assignment(assignment_id));
CREATE POLICY revision_history_course_read ON public.revision_history FOR SELECT TO authenticated USING (private.can_access_assignment(assignment_id));
CREATE POLICY revision_history_course_write ON public.revision_history FOR ALL TO authenticated USING (private.can_edit_assignment(assignment_id)) WITH CHECK (private.can_edit_assignment(assignment_id));
CREATE POLICY usage_records_course_read ON public.usage_records FOR SELECT TO authenticated USING (private.can_access_course(course_id));
CREATE POLICY usage_records_course_write ON public.usage_records FOR ALL TO authenticated USING (private.can_edit_course(course_id)) WITH CHECK (private.can_edit_course(course_id));
CREATE POLICY export_records_course_read ON public.export_records FOR SELECT TO authenticated USING (private.can_access_assignment(assignment_id));
CREATE POLICY export_records_course_write ON public.export_records FOR ALL TO authenticated USING (private.can_edit_assignment(assignment_id)) WITH CHECK (private.can_edit_assignment(assignment_id));
--> statement-breakpoint
CREATE POLICY draft_answers_course_read ON public.draft_answers FOR SELECT TO authenticated USING (private.can_access_draft(draft_id));
CREATE POLICY draft_answers_course_write ON public.draft_answers FOR ALL TO authenticated USING (private.can_edit_draft(draft_id)) WITH CHECK (private.can_edit_draft(draft_id));
CREATE POLICY answer_citations_course_read ON public.answer_citations FOR SELECT TO authenticated USING (private.can_access_answer(answer_id));
CREATE POLICY answer_citations_course_write ON public.answer_citations FOR ALL TO authenticated USING (private.can_edit_answer(answer_id)) WITH CHECK (private.can_edit_answer(answer_id));
CREATE POLICY review_findings_course_read ON public.review_findings FOR SELECT TO authenticated USING (private.can_access_review(report_id));
CREATE POLICY review_findings_course_write ON public.review_findings FOR ALL TO authenticated USING (private.can_edit_review(report_id)) WITH CHECK (private.can_edit_review(report_id));
--> statement-breakpoint
DROP POLICY IF EXISTS course_materials_owner_read ON storage.objects;
DROP POLICY IF EXISTS course_materials_owner_insert ON storage.objects;
DROP POLICY IF EXISTS course_materials_owner_update ON storage.objects;
DROP POLICY IF EXISTS course_materials_owner_delete ON storage.objects;
CREATE POLICY course_materials_member_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'course-materials' AND EXISTS (
    SELECT 1 FROM public.documents d WHERE d.storage_path = name AND private.can_access_course(d.course_id)
  )
);
CREATE POLICY course_materials_editor_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'course-materials' AND private.can_edit_course(((storage.foldername(name))[2])::uuid)
);
CREATE POLICY course_materials_editor_update ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id = 'course-materials' AND EXISTS (
    SELECT 1 FROM public.documents d WHERE d.storage_path = name AND private.can_edit_course(d.course_id)
  )
) WITH CHECK (bucket_id = 'course-materials');
CREATE POLICY course_materials_editor_delete ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'course-materials' AND EXISTS (
    SELECT 1 FROM public.documents d WHERE d.storage_path = name AND private.can_edit_course(d.course_id)
  )
);
