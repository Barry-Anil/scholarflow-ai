# ScholarFlow UI Registry

Established: 2026-10-09

### Button

File: `src/components/ui/button.tsx`
Last updated: 2026-10-09

| Property         | Class                                                              |
| ---------------- | ------------------------------------------------------------------ |
| Background       | `bg-slate-950` primary; `bg-white` secondary; `bg-teal-600` accent |
| Border           | `border border-slate-200` secondary                                |
| Border radius    | `rounded-xl`                                                       |
| Text — primary   | `text-white text-sm font-semibold`                                 |
| Text — secondary | `text-slate-800 text-sm font-semibold`                             |
| Spacing          | `h-11 px-5 gap-2` default                                          |
| Hover state      | `hover:bg-slate-800`, `hover:bg-slate-50`, or `hover:bg-teal-700`  |
| Shadow           | `shadow-sm` on filled variants                                     |
| Accent usage     | Teal is reserved for primary workflow emphasis and focus states    |

**Pattern notes:** All interactive controls use a visible teal focus ring and a 12px radius. Use slate primary for universal actions and teal accent for workflow progress.

### Card

File: `src/components/ui/card.tsx`
Last updated: 2026-10-09

| Property         | Class                            |
| ---------------- | -------------------------------- |
| Background       | `bg-white`                       |
| Border           | `border border-slate-200`        |
| Border radius    | `rounded-2xl`                    |
| Text — primary   | `text-slate-950`                 |
| Text — secondary | `text-slate-500`                 |
| Spacing          | `p-6`; header uses `space-y-1.5` |
| Hover state      | none by default                  |
| Shadow           | `shadow-sm`                      |
| Accent usage     | none by default                  |

**Pattern notes:** Cards are quiet white surfaces. Interactive cards may add a subtle border-color hover without increasing shadow weight.

### Input and Label

Files: `src/components/ui/input.tsx`, `src/components/ui/label.tsx`
Last updated: 2026-10-09

| Property         | Class                                          |
| ---------------- | ---------------------------------------------- |
| Background       | `bg-white`                                     |
| Border           | `border border-slate-200`                      |
| Border radius    | `rounded-xl`                                   |
| Text — primary   | `text-slate-950 text-sm`                       |
| Text — secondary | `text-slate-700 text-sm font-medium` label     |
| Spacing          | `h-11 px-3.5` input                            |
| Hover state      | none                                           |
| Shadow           | `shadow-xs`                                    |
| Accent usage     | `focus:border-teal-500 focus:ring-teal-500/15` |

**Pattern notes:** Labels sit directly above controls with a small vertical gap. Validation text uses concise red copy below the field.

### Wordmark

File: `src/components/brand/wordmark.tsx`
Last updated: 2026-10-09

| Property         | Class                                             |
| ---------------- | ------------------------------------------------- |
| Background       | `bg-slate-950` mark; inverse uses `bg-white`      |
| Border           | none                                              |
| Border radius    | `rounded-xl`                                      |
| Text — primary   | `text-slate-950 text-lg font-bold tracking-tight` |
| Text — secondary | none                                              |
| Spacing          | `gap-2.5`                                         |
| Hover state      | none                                              |
| Shadow           | none                                              |
| Accent usage     | `text-teal-500` for AI suffix                     |

**Pattern notes:** The book-check icon anchors the identity. Keep the teal accent limited to the AI suffix and workflow signals. Configure navigation through the Wordmark's `href` prop; never wrap it in another link because the component already renders a single anchor.

### Form

File: `src/features/auth/auth-form.tsx`
Last updated: 2026-10-09

| Property         | Class                                                     |
| ---------------- | --------------------------------------------------------- |
| Background       | inherited; status panels use `bg-teal-50` or `bg-rose-50` |
| Border           | status panels use `border-teal-200` or `border-rose-200`  |
| Border radius    | `rounded-xl`                                              |
| Text — primary   | inherited from inputs and labels                          |
| Text — secondary | validation uses `text-rose-600 text-xs font-medium`       |
| Spacing          | `space-y-5`; field groups use `space-y-2`                 |
| Hover state      | inherited from Button                                     |
| Shadow           | none                                                      |
| Accent usage     | Teal for success; rose only for validation and errors     |

**Pattern notes:** Forms use a single vertical rhythm, one concise error per field, full-width primary submission, and accessible status messaging.

### Inline creation form

File: `src/features/courses/new-course-form.tsx`
Last updated: 2026-10-09

| Property         | Class                                          |
| ---------------- | ---------------------------------------------- |
| Background       | inherited from parent Card                     |
| Border           | inherited from Input                           |
| Border radius    | `rounded-xl` controls                          |
| Text — primary   | `text-slate-700 text-sm font-medium` labels    |
| Text — secondary | status uses `text-teal-700` or `text-rose-600` |
| Spacing          | `gap-4`; field groups use `space-y-2`          |
| Hover state      | inherited from Button                          |
| Shadow           | none beyond controls                           |
| Accent usage     | Accent button identifies the creation action   |

**Pattern notes:** Desktop creation rows place compact metadata first, the descriptive field second, and the action last; they stack naturally on small screens.

### Workspace shell and dashboard

Files: `src/app/(workspace)/dashboard/layout.tsx`, `src/app/(workspace)/dashboard/page.tsx`
Last updated: 2026-10-10

| Property         | Class                                                                           |
| ---------------- | ------------------------------------------------------------------------------- |
| Background       | `bg-canvas` workspace; `bg-white` navigation and cards                          |
| Border           | `border-slate-200`; empty states use `border-dashed`                            |
| Border radius    | `rounded-xl` navigation/status; `rounded-2xl` cards and empty states            |
| Text — primary   | `text-slate-950`; headings use `font-semibold tracking-tight`                   |
| Text — secondary | `text-slate-500 text-sm`                                                        |
| Spacing          | page `p-5 lg:p-8`; sections `mt-6` or `mt-8`; cards `p-6`                       |
| Hover state      | nav actions inherit Button patterns                                             |
| Shadow           | `shadow-sm` cards only                                                          |
| Accent usage     | Teal = ready/success; amber = in progress; rose = failure; sky = course context |

**Pattern notes:** Product data appears in quiet white cards on a warm neutral canvas. Every status color carries a stable semantic meaning. Empty states use dashed borders and never fabricate sample records. Request-time workspace content streams behind a matching shell: retain the page spacing and heading hierarchy, then use `animate-pulse` on empty white card surfaces without displaying invented values. Navigation labels must reflect the current product and must not carry hard-coded roadmap badges or obsolete phase messaging.

### Workspace navigation and hubs

Files: `src/components/workspace/workspace-nav.tsx`, `src/components/workspace/hub-ui.tsx`, `src/app/(workspace)/dashboard/*/page.tsx`
Last updated: 2026-10-10

| Property         | Class                                                                               |
| ---------------- | ----------------------------------------------------------------------------------- |
| Background       | `bg-white` shell/cards; `bg-slate-950` active navigation; `bg-slate-50/60` empty    |
| Border           | `border-slate-200`; `border-dashed` for empty states                                |
| Border radius    | `rounded-xl` navigation/status; `rounded-2xl` hub cards and empty states            |
| Text — primary   | `text-slate-950 font-semibold`                                                      |
| Text — secondary | `text-slate-500 text-sm leading-6`                                                  |
| Spacing          | navigation `px-3 py-2.5 gap-2.5`; pages `p-5 lg:p-8`; hub sections `space-y-6`      |
| Hover state      | `hover:bg-slate-100 hover:text-slate-900`; linked cards use `hover:border-teal-300` |
| Shadow           | `shadow-sm` on primary cards; none on nested rows                                   |
| Accent usage     | Teal for active workflow/success; sky context; amber attention; rose failure        |

**Pattern notes:** Every sidebar item is a real Next.js link to a stable top-level workspace hub. The current URL controls the active state and `aria-current`; course detail routes remain under Courses. Mobile uses the same links in a horizontally scrollable row. Hub pages aggregate across courses and link into existing detail workspaces instead of duplicating editing controls. Configuration pages may show readiness and non-secret model names but never credential values.

### Marketing and auth shells

Files: `src/app/page.tsx`, `src/app/(auth)/layout.tsx`
Last updated: 2026-10-09

| Property         | Class                                                                        |
| ---------------- | ---------------------------------------------------------------------------- |
| Background       | `bg-canvas` marketing; `bg-white` form panel; `bg-slate-950` narrative panel |
| Border           | `border-slate-200` light surfaces; `border-white/10` dark surfaces           |
| Border radius    | `rounded-2xl` content; `rounded-[2rem]` hero frame                           |
| Text — primary   | `text-slate-950`; hero headings use `font-serif`                             |
| Text — secondary | `text-slate-500` or `text-slate-200` on dark surfaces                        |
| Spacing          | major sections use 64–96px vertical rhythm; content cards use 16–32px        |
| Hover state      | inherited Button/Link color shifts                                           |
| Shadow           | hero only uses `shadow-2xl shadow-slate-900/15`                              |
| Accent usage     | Teal reinforces evidence, readiness, and key workflow actions                |

**Pattern notes:** Serif is reserved for high-level narrative headings. Application headings remain sans-serif for clarity and density.

### Error boundary

File: `src/app/(workspace)/dashboard/error.tsx`
Last updated: 2026-10-09

| Property         | Class                                                              |
| ---------------- | ------------------------------------------------------------------ |
| Background       | White Card on the workspace canvas; icon uses `bg-rose-50`         |
| Border           | Inherited `border-slate-200` Card border                           |
| Border radius    | `rounded-2xl` Card; `rounded-xl` icon container                    |
| Text — primary   | `text-slate-950 text-2xl font-semibold tracking-tight`             |
| Text — secondary | `text-slate-500 text-sm leading-6`                                 |
| Spacing          | `p-8`; action uses `mt-6`                                          |
| Hover state      | Inherited from Button                                              |
| Shadow           | Inherited `shadow-sm` Card shadow                                  |
| Accent usage     | Rose is reserved for actionable failures; identifiers remain muted |

**Pattern notes:** Failure states explain impact without exposing internal errors, offer one clear recovery action, and may show only an opaque diagnostic reference.

### Knowledge upload and retrieval

Files: `src/features/knowledge/upload-document-form.tsx`, `src/app/(workspace)/dashboard/courses/[courseId]/knowledge/page.tsx`
Last updated: 2026-10-09

| Property         | Class                                                                            |
| ---------------- | -------------------------------------------------------------------------------- |
| Background       | `bg-white` cards; `bg-slate-50/70` upload area and empty states                  |
| Border           | `border-slate-200`; upload and empty states use `border-dashed`                  |
| Border radius    | `rounded-xl` controls/status/results; `rounded-2xl` upload and empty-state areas |
| Text — primary   | `text-slate-950` headings; `text-slate-800 font-semibold` labels                 |
| Text — secondary | `text-slate-500 text-xs` metadata; `text-slate-600 text-sm leading-6` excerpts   |
| Spacing          | cards `p-6`; upload area `p-5`; retrieval results `p-4` and `space-y-3`          |
| Hover state      | inherited from Button and linked course-row patterns                             |
| Shadow           | `shadow-sm` on cards only                                                        |
| Accent usage     | Teal for ready/searchable; sky processing; amber queued/partial; rose failed     |

**Pattern notes:** File controls live in a dashed neutral drop area and always state accepted formats and size limits. Document status colors retain their workspace semantics. Retrieval results must name the source and page when known; excerpts are real source text and never generated placeholders.

### Assignment workspace and versioned editor

Files: `src/features/assignments/create-assignment-form.tsx`, `src/features/assignments/draft-editor.tsx`, `src/app/(workspace)/dashboard/courses/[courseId]/assignments/[assignmentId]/page.tsx`
Last updated: 2026-10-21

| Property         | Class                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| Background       | `bg-white` cards/editor; `bg-slate-50/70` policy panels; `bg-teal-50` save confirmation |
| Border           | `border border-slate-200`; successful saves use `border-teal-200`                       |
| Border radius    | `rounded-xl` controls/status; `rounded-2xl` question cards and save panel               |
| Text — primary   | `text-slate-950` headings/prompts; `text-slate-800 font-semibold` labels                |
| Text — secondary | `text-slate-500 text-xs` context; `text-slate-600 text-sm leading-6` supporting copy    |
| Spacing          | forms `space-y-5`; question cards `p-5`; workspace sections `gap-6`                     |
| Hover state      | inherited from Button and linked assignment-row patterns                                |
| Shadow           | `shadow-sm` question/cards; `shadow-lg` save panel                                      |
| Accent usage     | Teal identifies parsing context, criteria checks, workflow actions, and saved status    |

**Pattern notes:** Keep the assignment side rail focused on active workflow controls, evidence, approval, and revision history. Rubric details, agent activity, and the original brief live in the shared workspace drawer instead of duplicated preview cards. Question cards always show their number, prompt, optional word limit, requirements, and a large monospace Markdown field. Every explicit save creates a recoverable version and confirms the version/word count in a server-rendered teal status panel. The save panel is static on narrow screens and sticky only from `sm` upward so it never obscures mobile editing.

### Agent controls, evidence, and activity

Files: `src/features/agents/agent-controls.tsx`, `src/features/agents/agent-job-monitor.tsx`, `src/app/(workspace)/dashboard/courses/[courseId]/assignments/[assignmentId]/page.tsx`, `src/features/assignments/draft-editor.tsx`
Last updated: 2026-10-10

| Property         | Class                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Background       | `bg-white` cards; `bg-slate-50/70` policy/confidence panels; semantic status backgrounds   |
| Border           | `border-slate-200`; teal/amber/rose borders match success, partial, and failure semantics  |
| Border radius    | `rounded-xl` evidence/status/confidence panels; `rounded-2xl` agent cards                  |
| Text — primary   | `text-slate-800 font-semibold` controls/source titles; `text-slate-950` section headings   |
| Text — secondary | `text-slate-500 text-xs leading-5` provenance, model, limitations, and activity timestamps |
| Spacing          | agent controls `space-y-4`; evidence `space-y-3` and `p-3`; activity timeline `space-y-4`  |
| Hover state      | inherited from Button; unavailable downstream actions use the disabled control pattern     |
| Shadow           | inherited `shadow-sm` Card shadow; no extra shadow on nested evidence panels               |
| Accent usage     | Teal marks grounded actions and passing review; amber/rose flag required review findings   |

**Pattern notes:** Agent operations are presented as an explicit sequence: research, drafting, independent review, then student-controlled revision. The teal live-status panel shows persisted task position with a compact spinner, explains that reopening the page resumes work, and disables conflicting actions until the active run ends. Never show fabricated progress; every activity item comes from a persisted run event. Evidence cards name the source type, title, excerpt, and locator when available; traceable does not mean independently verified. AI confidence appears only on completed agent-generated drafts and always includes a reason plus traceable-citation count. The independent review panel uses teal for passed gates, sky for an active review, and amber for required changes; findings use rose for critical, amber for major, sky for minor, and slate for suggestions. Finding decisions use paired teal Accept and neutral Reject actions beneath an optional compact note field; the persisted decision label remains visible after submission. Revision history uses quiet neutral cards and iteration numbers, while the primary revision action displays the current/max cycle count. Every finding includes a recommended correction, uncertainty remains visible, and a passing quality gate never implies final student approval. Status panels survive streamed route refreshes through URL-backed server rendering.

### Citations, approval, and private exports

Files: `src/features/assignments/draft-editor.tsx`, `src/features/exports/approval-export-panel.tsx`, `src/features/exports/export-job-monitor.tsx`
Last updated: 2026-10-10

| Property         | Class                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Background       | `bg-slate-50/70` evidence/attestation/history; `bg-teal-50` approved and active-job state |
| Border           | `border-slate-200`; `border-teal-200` only after approval or while generating             |
| Border radius    | `rounded-xl` nested records and approval panels                                           |
| Text — primary   | `text-slate-800 text-xs font-semibold` source and export names                            |
| Text — secondary | `text-slate-500 text-[11px] leading-5` locators, timestamps, and safety copy              |
| Spacing          | panels `space-y-5`; nested records `p-3`; export actions use a compact three-column grid  |
| Hover state      | inherited Button/Link patterns; unavailable approval and export actions remain disabled   |
| Shadow           | none on nested panels; the containing workspace Card supplies the surface shadow          |
| Accent usage     | Teal means verified, approved, or processing; neutral circles expose unmet gates          |

**Pattern notes:** Show each stored citation directly below its answer, including verification state and only metadata that actually exists; never synthesize authors, page numbers, or links. Approval is a strict checklist plus explicit checkbox attestation bound to one immutable draft, and it never suggests university submission or guaranteed correctness. Private export controls remain disabled until that exact draft is approved. Export generation uses a resumable teal status panel, while history exposes only completed artifacts through authenticated short-lived download links.

### Course collaboration and read-only workspaces

Files: `src/features/courses/member-manager.tsx`, `src/app/(workspace)/dashboard/courses/[courseId]/members/page.tsx`, `src/features/assignments/draft-editor.tsx`
Last updated: 2026-10-11

| Property         | Class                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------- |
| Background       | `bg-white` cards/controls; `bg-slate-50/70` member rows and read-only notices          |
| Border           | `border border-slate-200`                                                              |
| Border radius    | `rounded-xl` controls/rows; `rounded-2xl` containing cards                             |
| Text — primary   | `text-slate-800 font-semibold`; form labels use `text-slate-700 text-sm font-medium`   |
| Text — secondary | `text-slate-500 text-xs leading-5`                                                     |
| Spacing          | member form `gap-3`; nested rows `p-3`; page/card sections follow existing `space-y-6` |
| Hover state      | inherited Button/Input patterns                                                        |
| Shadow           | `shadow-xs` controls; containing Card supplies `shadow-sm`                             |
| Accent usage     | Teal for owner/editor actions and success; slate for viewer/read-only; rose for errors |

**Pattern notes:** Membership is managed by registered email in an inline responsive row. Role labels use compact rounded badges and plain language. Owner-only controls are omitted—not merely disabled—for non-owners. Viewer workspaces keep answer text selectable through read-only fields, replace save copy with a clear access explanation, and hide every mutation control while preserving evidence, history, approved exports, and downloads.

### Embedding coverage and backfill

Files: `src/features/knowledge/embedding-backfill-form.tsx`, `src/app/(workspace)/dashboard/courses/[courseId]/knowledge/page.tsx`
Last updated: 2026-10-11

| Property         | Class                                                                                |
| ---------------- | ------------------------------------------------------------------------------------ |
| Background       | inherited white Card surface; progress/status copy remains neutral                   |
| Border           | inherited `border-slate-200`                                                         |
| Border radius    | `rounded-xl` controls; `rounded-2xl` containing Card                                 |
| Text — primary   | `text-slate-800 font-semibold`                                                       |
| Text — secondary | `text-slate-500 text-xs`; failures use `text-rose-600 font-medium`                   |
| Spacing          | form `gap-3`; compact action uses Button `size="sm"`                                 |
| Hover state      | inherited secondary Button pattern                                                   |
| Shadow           | none beyond containing Card                                                          |
| Accent usage     | Teal indicates hybrid-ready coverage; amber indicates partial coverage/fallback mode |

**Pattern notes:** Embedding generation is presented as an optional, resumable enhancement to always-available keyword search. Coverage uses real embedded/total counts, and action copy states the bounded batch size. Never imply semantic search is active when the provider failed; show the keyword fallback mode explicitly.

### Agent activity tracker

Files: `src/components/kokonutui/currency-transfer.tsx`, `src/features/agents/agent-activity-tracker.tsx`, `src/app/(workspace)/dashboard/activity/page.tsx`
Last updated: 2026-10-20

| Property         | Class                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------- |
| Background       | `bg-white` card; `bg-teal-50` agent mark; semantic slate/sky/emerald/rose status pills |
| Border           | `border border-slate-200`; progress rails use `bg-slate-200`                           |
| Border radius    | `rounded-2xl` card; `rounded-xl` agent mark; `rounded-full` status pills               |
| Text — primary   | `text-slate-950 font-semibold`; step text uses `text-slate-900 text-sm`                |
| Text — secondary | `text-slate-500 text-xs`; pending steps use `text-slate-400`                           |
| Spacing          | card `p-5`; tracker grid `gap-4`; stages use `gap-3` and `pb-4`                        |
| Hover state      | assignment link uses `hover:text-teal-800`; reference retains the Kokonut copy state   |
| Shadow           | `shadow-sm`                                                                            |
| Accent usage     | Teal identifies agents/links; sky active; emerald completed; rose failed/cancelled     |

**Pattern notes:** This tracker adapts Kokonut UI's transfer progress rail without carrying financial language into the agent domain. Always show Agent A, B, and C in that order, backed by the latest persisted run for reviewer, student, and researcher roles. Stage completion must reflect database state rather than simulated progress. Poll every five seconds only while a run is queued or running, then stop automatically. Keep the detailed history below the cards, preserve assignment links, and never expose run input/output content in the summary cards or polling response.
