"use client";

import {
  ArrowLeft,
  BookOpen,
  Check,
  Circle,
  Headphones,
  LoaderCircle,
  MessageCircle,
  Pause,
  Play,
  Send,
  Square,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  lessonModes,
  lessonSchema,
  type LessonMode,
  type StudyLesson,
} from "./contracts";

type Reference = {
  chunkId: string;
  sectionId: string;
  sectionTitle: string;
  pageStart?: number;
  pageEnd?: number;
  excerpt?: string;
};

type WorkspaceData = {
  session: {
    id: string;
    title: string;
    status: string;
    currentSectionId: string | null;
    preferredTtsProvider: string;
    preferredVoiceId: string | null;
    playbackRate: string;
    filename: string | null;
    errorMessage: string | null;
    metadata: Record<string, unknown> | null;
  };
  sections: Array<{
    id: string;
    position: number;
    title: string;
    content: string;
    pageStart: number | null;
    pageEnd: number | null;
  }>;
  progress: Array<{ sectionId: string; completedAt: Date | null }>;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    supportLevel: string | null;
    references: Reference[];
    metadata: Record<string, unknown>;
    createdAt: Date;
  }>;
  explanations: Array<{
    id: string;
    sectionId: string;
    mode: string;
    content: Record<string, unknown>;
    references: Reference[];
    createdAt: Date;
  }>;
};

type ChatItem = {
  id: string;
  role: string;
  content: string;
  supportLevel?: string | null;
  references?: Reference[];
};

const modeLabels: Record<LessonMode, string> = {
  normal: "Explain",
  beginner: "Beginner",
  example: "Examples",
  deep: "Deep dive",
  summary: "Summary",
  quiz: "Quiz me",
  dialogue: "Dialogue",
};

function lessonText(lesson: StudyLesson | null, fallback: string) {
  if (!lesson) return fallback;
  return [
    lesson.title,
    lesson.introduction,
    ...lesson.explanation,
    ...lesson.keyTerms.map((item) => `${item.term}. ${item.definition}`),
    ...lesson.examples,
    ...lesson.steps,
    ...lesson.takeaways,
  ].join("\n\n");
}

function splitSpeech(value: string) {
  const chunks: string[] = [];
  let remaining = value.trim();
  while (remaining.length) {
    let end = Math.min(1_950, remaining.length);
    if (end < remaining.length) {
      const sentence = Math.max(
        remaining.lastIndexOf(". ", end),
        remaining.lastIndexOf("\n", end),
      );
      if (sentence > 800) end = sentence + 1;
    }
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  return chunks;
}

export function StudyWorkspace({ data }: { data: WorkspaceData }) {
  const initialSection =
    data.sections.find(
      (section) => section.id === data.session.currentSectionId,
    ) ?? data.sections[0];
  const initialCompleted = new Set(
    data.progress
      .filter((item) => item.completedAt)
      .map((item) => item.sectionId),
  );
  const initialExplanation = data.explanations.find(
    (item) => item.sectionId === initialSection?.id && item.mode === "normal",
  );
  const initialLesson = initialExplanation
    ? lessonSchema.safeParse(initialExplanation.content)
    : null;
  const [activeId, setActiveId] = useState(initialSection?.id ?? "");
  const [completed, setCompleted] = useState(initialCompleted);
  const [mode, setMode] = useState<LessonMode>("normal");
  const [lesson, setLesson] = useState<StudyLesson | null>(
    initialLesson?.success ? initialLesson.data : null,
  );
  const [lessonReferences, setLessonReferences] = useState<Reference[]>(
    initialExplanation?.references ?? [],
  );
  const [generatedLessons, setGeneratedLessons] = useState<
    Record<string, { lesson: StudyLesson; references: Reference[] }>
  >({});
  const [lessonLoading, setLessonLoading] = useState(false);
  const [error, setError] = useState<string | null>(data.session.errorMessage);
  const [mobilePanel, setMobilePanel] = useState<
    "sections" | "lesson" | "chat"
  >("lesson");
  const [messages, setMessages] = useState<ChatItem[]>(data.messages);
  const [question, setQuestion] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [provider, setProvider] = useState<"browser" | "inworld">(
    data.session.preferredTtsProvider === "inworld" ? "inworld" : "browser",
  );
  const [voiceId, setVoiceId] = useState(data.session.preferredVoiceId ?? "");
  const [rate, setRate] = useState(Number(data.session.playbackRate) || 1);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>(
    [],
  );
  const [inworldVoices, setInworldVoices] = useState<
    Array<{ voiceId: string; displayName: string; languageCode?: string }>
  >([]);
  const [inworldConfigured, setInworldConfigured] = useState(false);
  const [audioState, setAudioState] = useState<
    "idle" | "loading" | "playing" | "paused"
  >("idle");
  const [settingsState, setSettingsState] = useState<
    "idle" | "saving" | "saved"
  >("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioRun = useRef(0);

  const active =
    data.sections.find((section) => section.id === activeId) ?? initialSection;
  const completionPercent = data.sections.length
    ? Math.round((completed.size / data.sections.length) * 100)
    : 0;

  function loadSavedLesson(sectionId: string, nextMode: LessonMode) {
    const generated = generatedLessons[`${sectionId}:${nextMode}`];
    if (generated) {
      setLesson(generated.lesson);
      setLessonReferences(generated.references);
      return;
    }
    const existing = data.explanations.find(
      (item) => item.sectionId === sectionId && item.mode === nextMode,
    );
    const parsed = existing ? lessonSchema.safeParse(existing.content) : null;
    setLesson(parsed?.success ? parsed.data : null);
    setLessonReferences(existing?.references ?? []);
  }

  function selectSection(sectionId: string) {
    stopAudio();
    setActiveId(sectionId);
    loadSavedLesson(sectionId, mode);
    setMobilePanel("lesson");
  }

  function selectMode(nextMode: LessonMode) {
    setMode(nextMode);
    loadSavedLesson(activeId, nextMode);
  }

  useEffect(() => {
    if (!activeId) return;
    void fetch("/api/study-tutor/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "view",
        sessionId: data.session.id,
        sectionId: activeId,
      }),
    });
  }, [activeId, data.session.id]);

  useEffect(() => {
    const loadBrowserVoices = () =>
      setBrowserVoices(window.speechSynthesis?.getVoices() ?? []);
    loadBrowserVoices();
    window.speechSynthesis?.addEventListener(
      "voiceschanged",
      loadBrowserVoices,
    );
    void fetch("/api/study-tutor/tts")
      .then((response) => response.json())
      .then(
        (payload: { configured?: boolean; voices?: typeof inworldVoices }) => {
          setInworldConfigured(Boolean(payload.configured));
          setInworldVoices(payload.voices ?? []);
        },
      )
      .catch(() => undefined);
    return () => {
      window.speechSynthesis?.removeEventListener(
        "voiceschanged",
        loadBrowserVoices,
      );
      window.speechSynthesis?.cancel();
      audioRun.current += 1;
      audioRef.current?.pause();
    };
  }, []);

  function stopAudio() {
    audioRun.current += 1;
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    audioRef.current = null;
    setAudioState("idle");
  }

  async function playAudio() {
    if (!active) return;
    if (audioState === "paused") {
      if (provider === "browser") window.speechSynthesis.resume();
      else await audioRef.current?.play();
      setAudioState("playing");
      return;
    }
    stopAudio();
    const text = lessonText(lesson, `${active.title}. ${active.content}`);
    if (provider === "browser") {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;
      utterance.voice =
        browserVoices.find((voice) => voice.name === voiceId) ?? null;
      utterance.onend = () => setAudioState("idle");
      utterance.onerror = () => {
        setAudioState("idle");
        setError("Browser speech could not play this lesson.");
      };
      window.speechSynthesis.speak(utterance);
      setAudioState("playing");
      return;
    }
    const run = ++audioRun.current;
    setAudioState("loading");
    try {
      for (const chunk of splitSpeech(text)) {
        if (run !== audioRun.current) return;
        const response = await fetch("/api/study-tutor/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: chunk, voiceId: voiceId || undefined }),
        });
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? "Inworld speech failed.");
        }
        const url = URL.createObjectURL(await response.blob());
        const audio = new Audio(url);
        audio.playbackRate = rate;
        audioRef.current = audio;
        setAudioState("playing");
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error("Audio playback failed."));
          void audio.play().catch(reject);
        });
        URL.revokeObjectURL(url);
      }
      if (run === audioRun.current) setAudioState("idle");
    } catch (speechError) {
      setAudioState("idle");
      setError(
        speechError instanceof Error
          ? `${speechError.message} Browser speech remains available.`
          : "Speech failed.",
      );
    }
  }

  function pauseAudio() {
    if (provider === "browser") window.speechSynthesis.pause();
    else audioRef.current?.pause();
    setAudioState("paused");
  }

  async function generateLesson() {
    if (!active) return;
    setLessonLoading(true);
    setError(null);
    const response = await fetch("/api/study-tutor/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: data.session.id,
        sectionId: active.id,
        mode,
      }),
    });
    const payload = (await response.json()) as {
      lesson?: StudyLesson;
      references?: Reference[];
      error?: string;
    };
    setLessonLoading(false);
    if (!response.ok || !payload.lesson) {
      setError(payload.error ?? "The lesson could not be generated.");
      return;
    }
    setLesson(payload.lesson);
    const references = payload.references ?? [];
    setLessonReferences(references);
    setGeneratedLessons((current) => ({
      ...current,
      [`${active.id}:${mode}`]: { lesson: payload.lesson!, references },
    }));
  }

  async function toggleComplete() {
    if (!active) return;
    const isComplete = completed.has(active.id);
    const response = await fetch("/api/study-tutor/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: isComplete ? "uncomplete" : "complete",
        sessionId: data.session.id,
        sectionId: active.id,
      }),
    });
    if (!response.ok) return;
    setCompleted((current) => {
      const next = new Set(current);
      if (isComplete) next.delete(active.id);
      else next.add(active.id);
      return next;
    });
  }

  async function saveAudioSettings() {
    setSettingsState("saving");
    const response = await fetch("/api/study-tutor/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "settings",
        sessionId: data.session.id,
        provider,
        voiceId: voiceId || null,
        playbackRate: rate,
      }),
    });
    setSettingsState(response.ok ? "saved" : "idle");
    if (response.ok) window.setTimeout(() => setSettingsState("idle"), 1500);
  }

  async function sendQuestion(suggested?: string) {
    const value = (suggested ?? question).trim();
    if (!value || chatLoading) return;
    setQuestion("");
    setChatLoading(true);
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", content: value },
    ]);
    const response = await fetch("/api/study-tutor/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: data.session.id,
        sectionId: active?.id,
        message: value,
      }),
    });
    const payload = (await response.json()) as {
      answer?: string;
      supportLevel?: string;
      references?: Reference[];
      suggestedQuestions?: string[];
      error?: string;
    };
    setChatLoading(false);
    if (!response.ok || !payload.answer) {
      setError(payload.error ?? "The tutor could not answer that question.");
      return;
    }
    setMessages((current) => [
      ...current,
      {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: payload.answer!,
        supportLevel: payload.supportLevel,
        references: payload.references,
      },
    ]);
  }

  const suggestedQuestions = useMemo(() => {
    const last = [...data.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    const value = last?.metadata?.suggestedQuestions;
    return Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string")
          .slice(0, 3)
      : [];
  }, [data.messages]);

  if (!active) {
    return (
      <main className="p-8">
        <p className="text-rose-600">This session has no readable sections.</p>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-72px)] p-4 lg:p-6">
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/study-tutor"
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
            aria-label="Back to study sessions"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-slate-950">
              {data.session.title}
            </h1>
            <p className="truncate text-xs text-slate-500">
              {data.session.filename}
            </p>
          </div>
        </div>
        <div className="min-w-48">
          <div className="flex justify-between text-xs font-medium text-slate-500">
            <span>
              {completed.size} of {data.sections.length} complete
            </span>
            <span>{completionPercent}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-teal-600"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-white p-1 lg:hidden">
        {(["sections", "lesson", "chat"] as const).map((panel) => (
          <button
            key={panel}
            type="button"
            className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize ${mobilePanel === panel ? "bg-slate-950 text-white" : "text-slate-500"}`}
            onClick={() => setMobilePanel(panel)}
          >
            {panel}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)_340px]">
        <aside
          className={`${mobilePanel === "sections" ? "block" : "hidden"} overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:block`}
        >
          <div className="border-b border-slate-200 p-4">
            <h2 className="font-semibold text-slate-950">Sections</h2>
            <p className="mt-1 text-xs text-slate-500">
              Completion is marked only when you choose it.
            </p>
          </div>
          <nav
            className="max-h-[calc(100vh-250px)] space-y-1 overflow-y-auto p-2"
            aria-label="Document sections"
          >
            {data.sections.map((section) => {
              const selected = section.id === active.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => selectSection(section.id)}
                  className={`flex w-full items-start gap-2 rounded-xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30 ${selected ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-100"}`}
                >
                  {completed.has(section.id) ? (
                    <Check
                      className={`mt-0.5 size-4 shrink-0 ${selected ? "text-teal-300" : "text-teal-600"}`}
                    />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 opacity-50" />
                  )}
                  <span>
                    <span className="line-clamp-2 text-sm font-medium">
                      {section.title}
                    </span>
                    {section.pageStart && (
                      <span
                        className={`mt-1 block text-[11px] ${selected ? "text-slate-300" : "text-slate-400"}`}
                      >
                        Page/slide {section.pageStart}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section
          className={`${mobilePanel === "lesson" ? "block" : "hidden"} min-w-0 space-y-4 lg:block`}
        >
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">
                  Section {active.position + 1}
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                  {active.title}
                </h2>
              </div>
              <Button
                variant={completed.has(active.id) ? "secondary" : "accent"}
                size="sm"
                onClick={toggleComplete}
              >
                {completed.has(active.id) ? "Mark incomplete" : "Mark complete"}
              </Button>
            </div>
            <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">
                View source text
              </summary>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">
                {active.content}
              </p>
            </details>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap gap-2">
              {lessonModes.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => selectMode(item)}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold ${mode === item ? "bg-slate-950 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                >
                  {modeLabels[item]}
                </button>
              ))}
            </div>
            <Button
              className="mt-4"
              variant="accent"
              onClick={generateLesson}
              disabled={lessonLoading}
            >
              {lessonLoading ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <BookOpen className="size-4" />
              )}
              {lesson ? "Regenerate lesson" : "Generate grounded lesson"}
            </Button>
            {error && (
              <p
                className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
                role="alert"
              >
                {error}
              </p>
            )}
            {lesson ? (
              <article className="mt-6 space-y-6">
                <div>
                  <h3 className="text-xl font-semibold text-slate-950">
                    {lesson.title}
                  </h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    {lesson.introduction}
                  </p>
                </div>
                <div className="space-y-3">
                  {lesson.explanation.map((paragraph, index) => (
                    <p key={index} className="text-sm leading-7 text-slate-700">
                      {paragraph}
                    </p>
                  ))}
                </div>
                {lesson.keyTerms.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-950">
                      Key terms
                    </h4>
                    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                      {lesson.keyTerms.map((item) => (
                        <div
                          key={item.term}
                          className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                        >
                          <dt className="text-sm font-semibold text-slate-800">
                            {item.term}
                          </dt>
                          <dd className="mt-1 text-xs leading-5 text-slate-600">
                            {item.definition}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
                {lesson.examples.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-950">
                      Examples
                    </h4>
                    <ul className="mt-2 space-y-2">
                      {lesson.examples.map((item, index) => (
                        <li
                          key={index}
                          className="rounded-xl bg-sky-50 p-3 text-sm leading-6 text-sky-950"
                        >
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {lesson.steps.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-950">
                      Steps
                    </h4>
                    <ol className="mt-2 space-y-2">
                      {lesson.steps.map((item, index) => (
                        <li
                          key={index}
                          className="flex gap-3 text-sm leading-6 text-slate-700"
                        >
                          <span className="font-semibold text-teal-700">
                            {index + 1}.
                          </span>
                          {item}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <div>
                  <h4 className="text-sm font-semibold text-slate-950">
                    Takeaways
                  </h4>
                  <ul className="mt-2 space-y-2">
                    {lesson.takeaways.map((item, index) => (
                      <li
                        key={index}
                        className="flex gap-2 text-sm leading-6 text-slate-700"
                      >
                        <Check className="mt-1 size-4 shrink-0 text-teal-600" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                {lesson.dialogue?.length ? (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-950">
                      Tutor dialogue
                    </h4>
                    <div className="mt-3 space-y-2">
                      {lesson.dialogue.map((line, index) => (
                        <div
                          key={index}
                          className={`rounded-xl p-3 text-sm leading-6 ${line.speaker === "Tutor" ? "bg-teal-50 text-teal-950" : "bg-slate-100 text-slate-800"}`}
                        >
                          <span className="font-semibold">
                            {line.speaker}:{" "}
                          </span>
                          {line.text}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {lesson.selfCheck.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-950">
                      Self-check
                    </h4>
                    <div className="mt-2 space-y-2">
                      {lesson.selfCheck.map((item, index) => (
                        <details
                          key={index}
                          className="rounded-xl border border-slate-200 p-3"
                        >
                          <summary className="cursor-pointer text-sm font-medium text-slate-800">
                            {item.question}
                          </summary>
                          <p className="mt-2 text-sm leading-6 text-slate-600">
                            {item.answer}
                          </p>
                        </details>
                      ))}
                    </div>
                  </div>
                )}
                {lessonReferences.length > 0 && (
                  <div className="border-t border-slate-200 pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Sources used
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {lessonReferences.map((reference) => (
                        <span
                          key={reference.chunkId}
                          className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600"
                        >
                          {reference.sectionTitle}
                          {reference.pageStart
                            ? ` · p/slide ${reference.pageStart}`
                            : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            ) : (
              <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center">
                <BookOpen className="mx-auto size-7 text-slate-400" />
                <p className="mt-3 text-sm font-semibold text-slate-800">
                  Choose a mode and generate a lesson
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  The explanation will use this section’s persisted source
                  chunks.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Headphones className="size-5 text-teal-700" />
              <h3 className="font-semibold text-slate-950">Listen</h3>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-medium text-slate-600">
                Provider
                <select
                  value={provider}
                  onChange={(event) => {
                    stopAudio();
                    setProvider(event.target.value as "browser" | "inworld");
                  }}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="browser">Browser voice</option>
                  <option value="inworld" disabled={!inworldConfigured}>
                    Inworld {!inworldConfigured ? "(not configured)" : ""}
                  </option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                Voice
                <select
                  value={voiceId}
                  onChange={(event) => setVoiceId(event.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="">Default</option>
                  {provider === "browser"
                    ? browserVoices.map((voice) => (
                        <option
                          key={`${voice.name}-${voice.lang}`}
                          value={voice.name}
                        >
                          {voice.name} · {voice.lang}
                        </option>
                      ))
                    : inworldVoices.map((voice) => (
                        <option key={voice.voiceId} value={voice.voiceId}>
                          {voice.displayName}
                          {voice.languageCode ? ` · ${voice.languageCode}` : ""}
                        </option>
                      ))}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                Speed
                <select
                  value={rate}
                  onChange={(event) => setRate(Number(event.target.value))}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  {[0.75, 1, 1.25, 1.5, 2].map((value) => (
                    <option key={value} value={value}>
                      {value}×
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={playAudio}
                disabled={audioState === "loading"}
              >
                {audioState === "loading" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                {audioState === "paused" ? "Resume" : "Play"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={pauseAudio}
                disabled={audioState !== "playing"}
              >
                <Pause className="size-4" />
                Pause
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={stopAudio}
                disabled={audioState === "idle"}
              >
                <Square className="size-4" />
                Stop
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={saveAudioSettings}
                disabled={settingsState === "saving"}
              >
                {settingsState === "saved"
                  ? "Saved"
                  : settingsState === "saving"
                    ? "Saving…"
                    : "Save audio settings"}
              </Button>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              Browser speech stays on this device. Inworld audio is generated on
              demand through the server and is not stored.
            </p>
          </div>
        </section>

        <aside
          className={`${mobilePanel === "chat" ? "flex" : "hidden"} min-h-[620px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:flex lg:max-h-[calc(100vh-130px)]`}
        >
          <div className="border-b border-slate-200 p-4">
            <div className="flex items-center gap-2">
              <MessageCircle className="size-5 text-teal-700" />
              <h2 className="font-semibold text-slate-950">Ask your notes</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Answers label how strongly the document supports them.
            </p>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 text-sm leading-6 text-slate-500">
                Ask for clarification, comparisons, examples, or a quick check
                of this section.
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-xl p-3 text-sm leading-6 ${message.role === "user" ? "ml-6 bg-slate-950 text-white" : "mr-3 border border-slate-200 bg-slate-50 text-slate-700"}`}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.role === "assistant" && message.supportLevel && (
                  <p
                    className={`mt-2 text-[11px] font-semibold uppercase tracking-wider ${message.supportLevel === "document" ? "text-teal-700" : message.supportLevel === "mixed" ? "text-amber-700" : "text-rose-600"}`}
                  >
                    {message.supportLevel === "document"
                      ? "Supported by notes"
                      : message.supportLevel === "mixed"
                        ? "Notes + labeled general knowledge"
                        : "Insufficient support in notes"}
                  </p>
                )}
                {message.references?.length ? (
                  <div className="mt-2 border-t border-slate-200 pt-2 text-[11px] text-slate-500">
                    {message.references.map((reference) => (
                      <p key={reference.chunkId}>
                        {reference.sectionTitle}
                        {reference.pageStart
                          ? ` · p/slide ${reference.pageStart}`
                          : ""}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {chatLoading && (
              <div className="mr-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                <LoaderCircle className="size-4 animate-spin" />
                Checking your notes…
              </div>
            )}
          </div>
          <div className="border-t border-slate-200 p-3">
            {suggestedQuestions.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {suggestedQuestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => void sendQuestion(item)}
                    className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-teal-300"
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendQuestion();
                  }
                }}
                rows={2}
                maxLength={2000}
                placeholder="Ask about this section…"
                className="min-h-11 flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15"
              />
              <Button
                size="icon"
                variant="accent"
                aria-label="Send question"
                onClick={() => void sendQuestion()}
                disabled={!question.trim() || chatLoading}
              >
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
