-- Supabase Auth relationships and automatic profile provisioning.
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_auth_users_fk
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.courses ADD CONSTRAINT courses_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.course_members ADD CONSTRAINT course_members_user_id_auth_users_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.assignments ADD CONSTRAINT assignments_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.documents ADD CONSTRAINT documents_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.document_chunks ADD CONSTRAINT document_chunks_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.processing_jobs ADD CONSTRAINT processing_jobs_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.agent_run_events ADD CONSTRAINT agent_run_events_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.assignment_drafts ADD CONSTRAINT assignment_drafts_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.research_findings ADD CONSTRAINT research_findings_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.review_reports ADD CONSTRAINT review_reports_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.revision_history ADD CONSTRAINT revision_history_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.usage_records ADD CONSTRAINT usage_records_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.export_records ADD CONSTRAINT export_records_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (new.id, new.raw_user_meta_data ->> 'display_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$;

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER courses_set_updated_at BEFORE UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER assignments_set_updated_at BEFORE UPDATE ON public.assignments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER documents_set_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER processing_jobs_set_updated_at BEFORE UPDATE ON public.processing_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER assignment_questions_set_updated_at BEFORE UPDATE ON public.assignment_questions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER rubric_criteria_set_updated_at BEFORE UPDATE ON public.rubric_criteria FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER agent_runs_set_updated_at BEFORE UPDATE ON public.agent_runs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER draft_answers_set_updated_at BEFORE UPDATE ON public.draft_answers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER review_findings_set_updated_at BEFORE UPDATE ON public.review_findings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.can_access_course(target_course_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id = target_course_id
      AND (c.owner_id = (SELECT auth.uid()) OR EXISTS (
        SELECT 1 FROM public.course_members cm
        WHERE cm.course_id = c.id AND cm.user_id = (SELECT auth.uid())
      ))
  );
$$;

CREATE OR REPLACE FUNCTION private.can_edit_course(target_course_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id = target_course_id
      AND (c.owner_id = (SELECT auth.uid()) OR EXISTS (
        SELECT 1 FROM public.course_members cm
        WHERE cm.course_id = c.id
          AND cm.user_id = (SELECT auth.uid())
          AND cm.role IN ('owner'::public.course_member_role, 'editor'::public.course_member_role)
      ))
  );
$$;

CREATE OR REPLACE FUNCTION private.can_access_assignment(target_assignment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.id = target_assignment_id
      AND private.can_access_course(a.course_id)
  );
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated;

-- Row Level Security: the MVP is private-owner-first. Course membership is
-- modeled now; broader editor/viewer access can be opened table-by-table.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rubric_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answer_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revision_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_own_all ON public.profiles FOR ALL TO authenticated
  USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY courses_member_read ON public.courses FOR SELECT TO authenticated
  USING (private.can_access_course(id));
CREATE POLICY courses_owner_insert ON public.courses FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY courses_owner_update ON public.courses FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY courses_owner_delete ON public.courses FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

CREATE POLICY course_members_read ON public.course_members FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM public.courses c WHERE c.id = course_id AND c.owner_id = (SELECT auth.uid())
  ));
CREATE POLICY course_members_owner_insert ON public.course_members FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.courses c WHERE c.id = course_id AND c.owner_id = (SELECT auth.uid())
  ));
CREATE POLICY course_members_owner_update ON public.course_members FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.courses c WHERE c.id = course_id AND c.owner_id = (SELECT auth.uid())
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.courses c WHERE c.id = course_id AND c.owner_id = (SELECT auth.uid())
  ));
CREATE POLICY course_members_owner_delete ON public.course_members FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.courses c WHERE c.id = course_id AND c.owner_id = (SELECT auth.uid())
  ));

CREATE POLICY assignments_own_all ON public.assignments FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY documents_own_all ON public.documents FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY document_chunks_own_all ON public.document_chunks FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY processing_jobs_own_all ON public.processing_jobs FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY agent_runs_own_all ON public.agent_runs FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY agent_run_events_own_all ON public.agent_run_events FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY assignment_drafts_own_all ON public.assignment_drafts FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY research_findings_own_all ON public.research_findings FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY review_reports_own_all ON public.review_reports FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY revision_history_own_all ON public.revision_history FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY usage_records_own_all ON public.usage_records FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY export_records_own_all ON public.export_records FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY assignment_questions_owner_all ON public.assignment_questions FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.assignments a WHERE a.id = assignment_id AND a.owner_id = (SELECT auth.uid())
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.assignments a WHERE a.id = assignment_id AND a.owner_id = (SELECT auth.uid())
  ));
CREATE POLICY rubric_criteria_owner_all ON public.rubric_criteria FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.assignments a WHERE a.id = assignment_id AND a.owner_id = (SELECT auth.uid())
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.assignments a WHERE a.id = assignment_id AND a.owner_id = (SELECT auth.uid())
  ));
CREATE POLICY draft_answers_owner_all ON public.draft_answers FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.assignment_drafts d WHERE d.id = draft_id AND d.owner_id = (SELECT auth.uid())
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.assignment_drafts d WHERE d.id = draft_id AND d.owner_id = (SELECT auth.uid())
  ));
CREATE POLICY answer_citations_owner_all ON public.answer_citations FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.draft_answers da
    JOIN public.assignment_drafts d ON d.id = da.draft_id
    WHERE da.id = answer_id AND d.owner_id = (SELECT auth.uid())
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.draft_answers da
    JOIN public.assignment_drafts d ON d.id = da.draft_id
    WHERE da.id = answer_id AND d.owner_id = (SELECT auth.uid())
  ));
CREATE POLICY review_findings_owner_all ON public.review_findings FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.review_reports r WHERE r.id = report_id AND r.owner_id = (SELECT auth.uid())
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.review_reports r WHERE r.id = report_id AND r.owner_id = (SELECT auth.uid())
  ));

-- RLS still applies to these grants; they only make the API-visible tables usable.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Keyword side of hybrid retrieval. Semantic retrieval uses the HNSW vector
-- index generated in migration 0000.
CREATE INDEX document_chunks_content_fts_idx
  ON public.document_chunks
  USING gin (to_tsvector('english', content));

-- Uploaded documents are private and namespaced by the authenticated user ID.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'course-materials',
  'course-materials',
  false,
  26214400,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/csv'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

CREATE POLICY course_materials_owner_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'course-materials'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
CREATE POLICY course_materials_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'course-materials'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
CREATE POLICY course_materials_owner_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'course-materials'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  ) WITH CHECK (
    bucket_id = 'course-materials'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
CREATE POLICY course_materials_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'course-materials'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
