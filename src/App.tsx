import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  Clock3,
  Copy,
  DoorOpen,
  ExternalLink,
  FileJson,
  History,
  LayoutList,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  Mic2,
  Monitor,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  Waves,
  Wifi,
  X,
} from "lucide-react";
import { clonePlan, EXAMPLE_DISRUPTIONS, SAMPLE_PLAN } from "./lib/data";
import {
  exportHandoff,
  formatTime,
  formatTimeFull,
  parseImportedPlan,
  repairPlan,
  repairInterpretedPlan,
  validateCandidate,
} from "./lib/planner";
import type {
  EventPlan,
  Handoff,
  RepairOption,
  RepairResult,
  Session,
} from "./lib/types";
import "./styles.css";
import "./usability.css";
import EventEditor from "./components/EventEditor";
import GuidedRepair from "./components/GuidedRepair";
import type { GuidedChange } from "./components/GuidedRepair";
import { exportCalendar, exportCurrentSchedule } from "./lib/calendar";

type View = "schedule" | "people" | "history";
interface ChangeRecord {
  id: string;
  at: string;
  before: EventPlan;
  result: RepairResult;
  option: RepairOption;
}
interface ServiceHealth {
  status?: string;
  mode?: string;
  configured?: { nebius?: boolean; tavily?: boolean };
  models?: Record<string, string>;
}

function initialPlan(): EventPlan {
  try {
    const saved = localStorage.getItem("ripple-plan-v1");
    return saved
      ? parseImportedPlan(JSON.parse(saved))
      : clonePlan(SAMPLE_PLAN);
  } catch {
    return clonePlan(SAMPLE_PLAN);
  }
}

function storedHistory(plan: EventPlan): ChangeRecord[] {
  try {
    const raw = JSON.parse(
      localStorage.getItem(`ripple-history-${plan.id}`) ?? "[]",
    );
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 12).flatMap((record: ChangeRecord) => {
      try {
        const before = parseImportedPlan(record.before);
        const result = checkedServiceResult(record.result, before);
        const option = result.options.find(
          (item) => item.id === record.option.id,
        );
        return before.id === plan.id &&
          option &&
          typeof record.id === "string" &&
          !Number.isNaN(Date.parse(record.at))
          ? [{ ...record, before, result, option }]
          : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function storedEvents(): EventPlan[] {
  try {
    const raw = JSON.parse(localStorage.getItem("ripple-events-v1") ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 6).flatMap((item) => {
      try {
        return [parseImportedPlan(item)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function download(name: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(
    new Blob([content], { type: `${type};charset=utf-8` }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeUrl(value: string): string {
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use an http or https service URL without credentials, query parameters, or a fragment.",
    );
  return url.href.replace(/\/$/, "");
}

async function serviceJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const value = body as {
      detail?: unknown;
      error?: { message?: unknown };
    } | null;
    const message =
      typeof value?.error?.message === "string"
        ? value.error.message
        : typeof value?.detail === "string"
          ? value.detail
          : `The service returned ${response.status}. Your event plan is unchanged.`;
    throw new Error(message);
  }
  return body;
}

function checkedServiceResult(value: unknown, plan: EventPlan): RepairResult {
  const next = value as RepairResult;
  const string = (item: unknown): item is string => typeof item === "string";
  const strings = (item: unknown): item is string[] =>
    Array.isArray(item) && item.every(string);
  if (
    !next ||
    !string(next.id) ||
    !string(next.summary) ||
    !["demo", "live"].includes(next.mode) ||
    !strings(next.blockers) ||
    !Array.isArray(next.options) ||
    !Array.isArray(next.trace)
  )
    throw new Error(
      "The service returned an incomplete repair. Your event plan is unchanged.",
    );
  const intent = next.interpretation;
  if (
    !intent ||
    !["delay", "room", "duration", "absence", "unknown"].includes(
      intent.kind,
    ) ||
    !(intent.targetId === null || string(intent.targetId)) ||
    !Number.isInteger(intent.minutes) ||
    !string(intent.description)
  )
    throw new Error(
      "The service returned an invalid change interpretation. Your event plan is unchanged.",
    );
  if (
    next.trace.some(
      (step) =>
        !step ||
        !string(step.id) ||
        !string(step.label) ||
        !string(step.detail) ||
        !["complete", "running", "pending"].includes(step.status) ||
        (step.model !== undefined && !string(step.model)) ||
        (step.provider !== undefined && !string(step.provider)),
    )
  )
    throw new Error(
      "The service returned an invalid repair trace. Your event plan is unchanged.",
    );
  if (
    next.sources !== undefined &&
    (!Array.isArray(next.sources) ||
      next.sources.some(
        (source) =>
          !source ||
          !string(source.title) ||
          !string(source.url) ||
          !/^https?:\/\//.test(source.url) ||
          !string(source.snippet) ||
          (source.retrievedAt !== undefined && !string(source.retrievedAt)),
      ))
  )
    throw new Error(
      "The service returned invalid research sources. Your event plan is unchanged.",
    );
  const count = next.options.length;
  next.options = next.options
    .filter((option) => {
      try {
        return (
          !!option &&
          string(option.id) &&
          string(option.title) &&
          string(option.description) &&
          string(option.tradeoff) &&
          Number.isFinite(option.score) &&
          Array.isArray(option.changes) &&
          option.changes.every(
            (change) =>
              !!change &&
              string(change.sessionId) &&
              plan.sessions.some(
                (session) => session.id === change.sessionId,
              ) &&
              ["start", "roomId", "duration", "ownerId"].includes(
                change.field,
              ) &&
              string(change.before) &&
              string(change.after) &&
              string(change.reason),
          ) &&
          Array.isArray(option.handoffs) &&
          option.handoffs.every(
            (handoff) =>
              !!handoff &&
              string(handoff.personId) &&
              plan.people.some((person) => person.id === handoff.personId) &&
              string(handoff.title) &&
              string(handoff.message),
          ) &&
          Array.isArray(option.sessions) &&
          validateCandidate(plan, option.sessions, intent).every(
            (check) => check.passed,
          )
        );
      } catch {
        return false;
      }
    })
    .map((option) => ({
      ...option,
      checks: validateCandidate(plan, option.sessions, intent),
    }));
  if (
    new Set(next.options.map((option) => option.id)).size !==
    next.options.length
  )
    throw new Error(
      "The service returned ambiguous repair options. Your event plan is unchanged.",
    );
  if (next.options.length < count)
    next.blockers.push(
      "At least one service proposal failed the browser’s independent checks and was withheld.",
    );
  if (!next.options.length && !next.blockers.length)
    next.blockers = [
      "The service did not return a repair that passed the local checks. The current plan has been kept.",
    ];
  return next;
}

function Modal({
  title,
  eyebrow,
  children,
  onClose,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previous.current = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previous.current?.focus();
    };
  }, []);
  return (
    <div
      className="modal-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key === "Tab") {
            const elements = Array.from(
              panel.current?.querySelectorAll<HTMLElement>(
                "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
              ) ?? [],
            );
            const first = elements[0];
            const last = elements[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <button
          className="icon-button modal-close"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={19} />
        </button>
        {eyebrow && <div className="eyebrow purple">{eyebrow}</div>}
        <h2 id="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Avatar({
  plan,
  id,
  small = false,
}: {
  plan: EventPlan;
  id: string;
  small?: boolean;
}) {
  const person = plan.people.find((item) => item.id === id);
  return (
    <span
      className={`avatar ${small ? "avatar-small" : ""}`}
      style={{ background: person?.color ?? "#d7d3e4" }}
      title={person?.name}
    >
      {person?.initials ?? "?"}
    </span>
  );
}

function Equipment({ name }: { name: string }) {
  const Icon =
    name === "wifi"
      ? Wifi
      : name === "screen"
        ? Monitor
        : name === "microphone"
          ? Mic2
          : LayoutList;
  return (
    <span className="equipment">
      <Icon size={13} />
      {name === "wifi" ? "Wi-Fi" : name}
    </span>
  );
}

function App() {
  const [plan, setPlan] = useState<EventPlan>(initialPlan);
  const [view, setView] = useState<View>("schedule");
  const [disruption, setDisruption] = useState("");
  const [result, setResult] = useState<RepairResult | null>(null);
  const [resultBase, setResultBase] = useState<EventPlan | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [history, setHistory] = useState<ChangeRecord[]>(() =>
    storedHistory(plan),
  );
  const [events, setEvents] = useState<EventPlan[]>(storedEvents);
  const [storageFailed, setStorageFailed] = useState(false);
  const [editor, setEditor] = useState<"create" | "edit" | null>(null);
  const [inputMode, setInputMode] = useState<"guided" | "text">("guided");
  const [guidedChange, setGuidedChange] = useState<GuidedChange | null>(null);
  const [roomFilter, setRoomFilter] = useState("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState<
    "settings" | "checks" | "about" | "reset" | "events" | null
  >(null);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [serviceUrl, setServiceUrl] = useState(() => {
    try {
      return localStorage.getItem("ripple-service-url") ?? "";
    } catch {
      return "";
    }
  });
  const [accessToken, setAccessToken] = useState("");
  const [jobStatus, setJobStatus] = useState<"queued" | "running" | null>(null);
  const [useService, setUseService] = useState(false);
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [serviceError, setServiceError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const isSample = plan.id === SAMPLE_PLAN.id;
  const selected =
    result?.options.find((option) => option.id === selectedId) ??
    result?.options[0];
  const displaySessions = (
    selected && !applied ? selected.sessions : plan.sessions
  )
    .filter((session) => roomFilter === "all" || session.roomId === roomFilter)
    .sort((a, b) => a.start - b.start);
  const changedIds = new Set(
    selected?.changes.map((change) => change.sessionId) ?? [],
  );
  const preview = !!selected && !applied;
  const baseChecks = useMemo(
    () =>
      validateCandidate(plan, plan.sessions, {
        kind: "unknown",
        targetId: null,
        minutes: 0,
        description: "The current event plan.",
      }),
    [plan],
  );
  const checks = selected?.checks ?? baseChecks;
  const fixedCount = plan.sessions.filter((session) => session.locked).length;
  const eventDate = new Date(`${plan.date}T12:00:00`);
  const dateLabel = Number.isNaN(eventDate.getTime())
    ? plan.date
    : new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "long",
        day: "numeric",
      }).format(eventDate);
  const shortDate = Number.isNaN(eventDate.getTime())
    ? plan.date
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
      }).format(eventDate);

  useEffect(() => {
    try {
      localStorage.setItem("ripple-plan-v1", JSON.stringify(plan));
      localStorage.setItem(
        `ripple-history-${plan.id}`,
        JSON.stringify(history.slice(0, 12)),
      );
      localStorage.setItem("ripple-events-v1", JSON.stringify(events));
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [plan, history, events]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menuOpen]);
  useEffect(() => () => requestRef.current?.abort(), []);

  const clearRepair = () => {
    setResult(null);
    setResultBase(null);
    setApplied(false);
    setError("");
    setSelectedId("");
    setShowTrace(false);
  };

  const runRepair = async () => {
    const exact = inputMode === "guided" ? guidedChange : null;
    const input =
      inputMode === "guided" ? (exact?.text ?? "") : disruption.trim();
    if (!input || busy) {
      textareaRef.current?.focus();
      return;
    }
    setDisruption(input);
    setBusy(true);
    setError("");
    setResult(null);
    setApplied(false);
    setView("schedule");
    setRoomFilter("all");
    setShowTrace(false);
    setJobStatus(null);
    const before = clonePlan(plan);
    setResultBase(before);
    try {
      let next: RepairResult;
      if (useService) {
        const payload = JSON.stringify({
          plan: before,
          disruption: exact
            ? `${input} The selected ${exact.interpretation.kind === "room" ? "room" : "activity"} ID is ${exact.interpretation.targetId}.`
            : input,
          ...(exact ? { confirmedChange: exact.interpretation } : {}),
        });
        if (new TextEncoder().encode(payload).length > 65536)
          throw new Error(
            "This event is larger than the service’s 64 KB request limit. Reduce lengthy notes or import a smaller event, then try again.",
          );
        const controller = new AbortController();
        requestRef.current = controller;
        const timeout = setTimeout(() => controller.abort(), 600000);
        try {
          const origin = safeUrl(serviceUrl);
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (accessToken.trim())
            headers.Authorization = `Bearer ${accessToken.trim()}`;
          const submission = (await serviceJson(
            await fetch(`${origin}/api/jobs`, {
              method: "POST",
              headers,
              body: payload,
              signal: controller.signal,
            }),
          )) as { id?: unknown; status?: unknown };
          if (
            !submission ||
            typeof submission.id !== "string" ||
            !/^[a-zA-Z0-9_-]+$/.test(submission.id)
          )
            throw new Error(
              "The service did not return a valid background repair ID. No changes were applied.",
            );
          setJobStatus("queued");
          for (;;) {
            const job = (await serviceJson(
              await fetch(
                `${origin}/api/jobs/${encodeURIComponent(submission.id)}`,
                { headers, signal: controller.signal },
              ),
            )) as {
              status?: string;
              result?: unknown;
              error?: { message?: unknown };
            };
            if (job?.status === "completed") {
              next = checkedServiceResult(job.result, before);
              if (
                exact &&
                (next.interpretation.kind !== exact.interpretation.kind ||
                  next.interpretation.targetId !==
                    exact.interpretation.targetId ||
                  next.interpretation.minutes !== exact.interpretation.minutes)
              )
                throw new Error(
                  "The service interpreted a different change from the one you selected. No repair was applied. Try again or use the local planner.",
                );
              break;
            }
            if (job?.status === "failed")
              throw new Error(
                typeof job.error?.message === "string"
                  ? job.error.message
                  : "The background repair could not complete. No automatic retry was started and your plan is unchanged.",
              );
            if (!job || !["queued", "running"].includes(job.status ?? ""))
              throw new Error(
                "The service returned an unknown repair status. Your plan is unchanged.",
              );
            setJobStatus(job.status as "queued" | "running");
            await new Promise<void>((resolve, reject) => {
              const abort = () => {
                clearTimeout(wait);
                reject(
                  new DOMException(
                    "Stopped waiting for the repair.",
                    "AbortError",
                  ),
                );
              };
              const wait = setTimeout(() => {
                controller.signal.removeEventListener("abort", abort);
                resolve();
              }, 1600);
              controller.signal.addEventListener("abort", abort, {
                once: true,
              });
              if (controller.signal.aborted) abort();
            });
          }
        } finally {
          clearTimeout(timeout);
          requestRef.current = null;
        }
      } else {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => setTimeout(resolve, 180)),
        );
        next = exact
          ? repairInterpretedPlan(before, exact.interpretation, input)
          : repairPlan(before, input);
      }
      setResult(next);
      setSelectedId(next.options[0]?.id ?? "");
    } catch (failure) {
      setError(
        failure instanceof Error && failure.name === "AbortError"
          ? "Stopped waiting for the repair. A submitted background job may still finish on the service. No changes were applied and no retry was started."
          : failure instanceof Error
            ? failure.message
            : "Something interrupted the repair. Please try again.",
      );
    } finally {
      setBusy(false);
      setJobStatus(null);
    }
  };

  const applyRepair = () => {
    if (!selected || !result || !resultBase || busy) return;
    if (JSON.stringify(plan) !== JSON.stringify(resultBase)) {
      setError(
        "The event plan changed after this preview was created. Generate a fresh repair before applying it.",
      );
      return;
    }
    if (
      !validateCandidate(
        resultBase,
        selected.sessions,
        result.interpretation,
      ).every((check) => check.passed)
    ) {
      setError(
        "This repair no longer passes every check. Please generate a new one.",
      );
      return;
    }
    setHistory((previous) => [
      {
        id: result.id,
        at: new Date().toISOString(),
        before: clonePlan(resultBase),
        result,
        option: selected,
      },
      ...previous.slice(0, 11),
    ]);
    setPlan({
      ...clonePlan(plan),
      sessions: selected.sessions.map((session) => ({ ...session })),
    });
    setApplied(true);
    setToast(
      "The local plan is updated. Handoff drafts are ready; nothing was sent.",
    );
  };

  const undoLast = () => {
    if (busy) return;
    const latest = history[0];
    if (!latest) return;
    setPlan(clonePlan(latest.before));
    setHistory((previous) => previous.slice(1));
    clearRepair();
    setDisruption("");
    setToast("The previous plan has been restored.");
  };

  const exportSelected = () => {
    if (!result || !selected) return;
    download(
      `ripple-${plan.id}-${applied ? "handoff" : "proposal"}.txt`,
      exportHandoff(resultBase ?? plan, result, selected, applied),
    );
    setToast(
      applied
        ? "The approved schedule and handoff drafts were downloaded."
        : "The proposal was downloaded. It has not been applied.",
    );
  };

  const copyHandoff = async (handoff: Handoff) => {
    if (!applied) return;
    try {
      await navigator.clipboard.writeText(handoff.message);
      setCopied(handoff.personId);
      setTimeout(() => setCopied(null), 2200);
    } catch {
      setToast(
        "Clipboard access is unavailable. Download the handoff plan to copy the drafts.",
      );
    }
  };

  const importPlan = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 300000)
        throw new Error("Please choose a JSON event plan smaller than 300 KB.");
      const imported = parseImportedPlan(JSON.parse(await file.text()));
      saveEvent(imported);
      setToast(
        `“${imported.name}” is ready. ${imported.sessions.length} activities passed the baseline checks.`,
      );
    } catch (failure) {
      setToast(
        failure instanceof Error
          ? failure.message
          : "This event plan could not be imported.",
      );
    }
    event.target.value = "";
  };

  const checkService = async () => {
    setChecking(true);
    setServiceError("");
    setHealth(null);
    try {
      const url = safeUrl(serviceUrl);
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok)
        throw new Error(`The service returned ${response.status}.`);
      const value = (await response.json()) as ServiceHealth;
      if (!value || !["demo", "live"].includes(value.mode ?? ""))
        throw new Error(
          "This endpoint does not identify itself as a Ripple service.",
        );
      setHealth(value);
      setServiceUrl(url);
      try {
        localStorage.setItem("ripple-service-url", url);
      } catch {
        /* Connection works in memory. */
      }
    } catch (failure) {
      setServiceError(
        failure instanceof Error
          ? failure.message
          : "Could not reach the service.",
      );
    } finally {
      setChecking(false);
    }
  };

  const changeAsOf = (value: string) => {
    if (!value || busy) return;
    const [hours, minutes] = value.split(":").map(Number);
    const next = hours * 60 + minutes;
    if (next < plan.start || next > plan.end) {
      setToast(
        "Choose a repair time within the event’s opening and closing times.",
      );
      return;
    }
    setPlan((previous) => ({ ...previous, asOf: next }));
    clearRepair();
  };

  const chooseExample = (text: string) => {
    setInputMode("text");
    setDisruption(text);
    clearRepair();
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const saveEvent = (next: EventPlan) => {
    const checked = parseImportedPlan(next);
    if (editor === "edit" && checked.id === SAMPLE_PLAN.id)
      checked.id = `event-${crypto.randomUUID()}`;
    if (checked.id !== plan.id)
      setEvents((previous) =>
        [
          clonePlan(plan),
          ...previous.filter(
            (item) => item.id !== plan.id && item.id !== checked.id,
          ),
        ].slice(0, 6),
      );
    setPlan(checked);
    setHistory(checked.id === plan.id ? [] : storedHistory(checked));
    clearRepair();
    setDisruption("");
    setRoomFilter("all");
    setView("schedule");
    setInputMode("guided");
    setEditor(null);
    setModal(null);
    setToast(
      `${checked.name} is ready. Your changes have been applied.`,
    );
  };

  const downloadCalendar = () => {
    try {
      download(`ripple-${plan.id}.ics`, exportCalendar(plan), "text/calendar");
      setToast(
        "Calendar file downloaded. Import it into your calendar; no invitations were sent.",
      );
    } catch (failure) {
      setToast(
        failure instanceof Error
          ? failure.message
          : "Calendar export failed. Download the text schedule instead.",
      );
    }
  };

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to the event plan
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setView("schedule");
          }}
          aria-label="Ripple home"
        >
          <span className="brand-symbol">
            <i />
            <i />
            <i />
          </span>
          <span>
            ripple<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-label">
          YOUR WORKSPACE<span>01</span>
        </div>
        <button
          className="event-switcher"
          onClick={() => setModal("events")}
          aria-label="Your events"
          disabled={busy}
        >
          <div className="event-mark">
            {isSample ? (
              <>
                f<span>n</span>
              </>
            ) : (
              plan.name.slice(0, 2)
            )}
          </div>
          <div>
            <strong>
              {plan.name === SAMPLE_PLAN.name ? "Fieldnotes" : plan.name}
            </strong>
            <span>
              {shortDate} · {isSample ? "Sample event" : "Your event"}
            </span>
          </div>
          <ChevronDown size={15} className="muted" />
        </button>
        <nav className="side-nav" aria-label="Workspace navigation">
          <button
            className={view === "schedule" ? "nav-item active" : "nav-item"}
            onClick={() => setView("schedule")}
          >
            <LayoutList size={17} />
            The live plan
            <span className="nav-dot" />
          </button>
          <button
            className={view === "people" ? "nav-item active" : "nav-item"}
            onClick={() => setView("people")}
          >
            <Users size={17} />
            People & spaces
          </button>
          <button
            className={view === "history" ? "nav-item active" : "nav-item"}
            onClick={() => setView("history")}
          >
            <History size={17} />
            Change log<span className="count-badge">{history.length}</span>
          </button>
        </nav>
        <div className="side-note">
          <div className="note-lines" aria-hidden="true">
            <svg viewBox="0 0 180 75">
              <path d="M-10 52C20 2 37 76 65 28S102 73 130 27 164 68 191 14" />
              <path d="M-10 64C20 14 37 88 65 40S102 85 130 39 164 80 191 26" />
              <path d="M-10 40C20-10 37 64 65 16S102 61 130 15 164 56 191 2" />
            </svg>
          </div>
          <p>
            Good plans make
            <br />
            room for change.
          </p>
          <button onClick={() => setModal("about")}>
            A little about Ripple <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className="nav-item settings-nav"
            onClick={() => setModal("settings")}
            disabled={busy}
          >
            <Settings2 size={17} />
            Connection settings
          </button>
          <div className="local-note">
            <span className="status-dot" />
            {storageFailed
              ? "Download to keep your plan"
              : "Saved in this browser"}
          </div>
          <div className="built-with">Made for the unexpected.</div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="workspace-picker"
              disabled={busy}
              onClick={() => setModal("events")}
            >
              Your events <ChevronDown size={12} />
            </button>{" "}
            <span>/</span>{" "}
            <strong>
              {view === "schedule"
                ? "The live plan"
                : view === "people"
                  ? "People & spaces"
                  : "Change log"}
            </strong>
          </div>
          <div className="topbar-right">
            <button
              className={`mode-badge ${useService && health?.mode === "live" ? "live" : ""}`}
              onClick={() => setModal("settings")}
              disabled={busy}
            >
              <span />
              {useService
                ? health?.mode === "live"
                  ? "Live service"
                  : "Rules service"
                : "Local planner"}
              <ChevronDown size={12} />
            </button>
            <span className="topbar-divider" />
            <span className="producer-avatar" title="Your local workspace">
              You
            </span>
          </div>
        </header>
        <main id="main-content" className="main-content">
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                SCHEDULE REPAIR FOR EVENT ORGANIZERS
              </div>
              <h1>
                {view === "schedule"
                  ? isSample
                    ? "Keep a good day going."
                    : plan.name
                  : view === "people"
                    ? "Good things take good people."
                    : "Every change has a story."}
              </h1>
              <p>
                {plan.name}
                <span>·</span>
                {dateLabel}
              </p>
            </div>
            <div className="event-stamp" aria-hidden="true">
              <span className="stamp-top">GATHER. MAKE.</span>
              <Waves size={26} strokeWidth={1.3} />
              <span className="stamp-bottom">KEEP GOING.</span>
            </div>
          </section>

          <div className="event-actions">
            <p>
              {isSample
                ? "You’re exploring a sample. Try a change, or bring your own event."
                : storageFailed ? "Your event is open. Download it to keep a copy." : "Your event, saved on this device. One activity at a time."}
            </p>
            <div>
              <button
                className={isSample ? "primary-button" : "secondary-button"}
                disabled={busy}
                onClick={() => setEditor("create")}
              >
                <Plus size={15} />
                Create event
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setEditor("edit")}
              >
                Edit event
              </button>
              <button
                className="secondary-button"
                onClick={() =>
                  download(
                    `ripple-${plan.id}-schedule.txt`,
                    exportCurrentSchedule(plan),
                  )
                }
              >
                <ArrowDownToLine size={15} />
                Download schedule
              </button>
              <button className="secondary-button" onClick={downloadCalendar}>
                Add to calendar
              </button>
            </div>
          </div>
          {storageFailed && (
            <div className="storage-warning" role="alert">
              Your browser could not save these changes. The plan is still open
              here. Download the schedule or event JSON before closing this tab.
            </div>
          )}

          <div className="event-facts">
            <span>
              <MapPin size={14} />
              {plan.venue}
            </span>
            <span>
              <Clock3 size={14} />
              {formatTimeFull(plan.start)} – {formatTimeFull(plan.end)}
            </span>
            <span>
              <Users size={14} />
              {Math.max(
                ...plan.sessions.map((session) => session.attendees),
              )}{" "}
              attendees
            </span>
            <span className="facts-spacer" />
            <span className="timezone-label">
              {plan.timezone.split("/").pop()?.replaceAll("_", " ")} time
            </span>
          </div>

          <nav className="mobile-nav" aria-label="Event navigation">
            <button
              className={view === "schedule" ? "active" : ""}
              onClick={() => setView("schedule")}
            >
              <LayoutList size={14} />
              The plan
            </button>
            <button
              className={view === "people" ? "active" : ""}
              onClick={() => setView("people")}
            >
              <Users size={14} />
              People & spaces
            </button>
            <button
              className={view === "history" ? "active" : ""}
              onClick={() => setView("history")}
            >
              <History size={14} />
              Changes{history.length > 0 && <span>{history.length}</span>}
            </button>
          </nav>
          <div className="workspace-grid">
            <div className="primary-column">
              {view === "schedule" && (
                <section className="schedule-panel">
                  <div className="panel-heading">
                    <div className="heading-with-count">
                      <h2>The run of show</h2>
                      <span className="soft-count">
                        {plan.sessions.length} moments
                      </span>
                      {preview && (
                        <span className="preview-label">Preview</span>
                      )}
                      {applied && (
                        <span className="updated-label">
                          <Check size={12} />
                          Updated
                        </span>
                      )}
                    </div>
                    <div className="panel-tools">
                      <label className="room-select">
                        <span className="sr-only">Filter by space</span>
                        <select
                          value={roomFilter}
                          onChange={(event) =>
                            setRoomFilter(event.target.value)
                          }
                        >
                          <option value="all">All spaces</option>
                          {plan.rooms.map((room) => (
                            <option key={room.id} value={room.id}>
                              {room.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={12} />
                      </label>
                      <div className="menu-wrap">
                        <button
                          className="icon-button"
                          aria-label="Schedule actions"
                          aria-expanded={menuOpen}
                          onClick={() => setMenuOpen(!menuOpen)}
                        >
                          <MoreHorizontal size={19} />
                        </button>
                        {menuOpen && (
                          <>
                            <button
                              className="menu-dismiss"
                              onClick={() => setMenuOpen(false)}
                              aria-label="Dismiss schedule menu"
                            />
                            <div className="dropdown-menu">
                              <button
                                disabled={busy}
                                onClick={() => {
                                  setMenuOpen(false);
                                  importRef.current?.click();
                                }}
                              >
                                <FileJson size={15} />
                                Import an event plan
                              </button>
                              <button
                                onClick={() => {
                                  download(
                                    "ripple-sample-plan.json",
                                    JSON.stringify(SAMPLE_PLAN, null, 2),
                                    "application/json",
                                  );
                                  setMenuOpen(false);
                                }}
                              >
                                <ArrowDownToLine size={15} />
                                Download sample JSON
                              </button>
                              <button
                                onClick={() => {
                                  download(
                                    `ripple-${plan.id}.json`,
                                    JSON.stringify(plan, null, 2),
                                    "application/json",
                                  );
                                  setMenuOpen(false);
                                }}
                              >
                                <ArrowDownToLine size={15} />
                                Export this event JSON
                              </button>
                              <div className="menu-rule" />
                              <button
                                disabled={busy}
                                onClick={() => {
                                  setMenuOpen(false);
                                  setModal("reset");
                                }}
                              >
                                <RotateCcw size={15} />
                                Reset to sample event
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="schedule-subhead">
                    <span>
                      <span className="small-square" />
                      {preview
                        ? "A way forward, ready for your review"
                        : "The whole day, all in one place"}
                    </span>
                    <label className="asof-control">
                      Repair from{" "}
                      <input
                        type="time"
                        aria-label="Repair from time; earlier activities stay fixed"
                        value={`${String(Math.floor((plan.asOf ?? plan.start) / 60)).padStart(2, "0")}:${String((plan.asOf ?? plan.start) % 60).padStart(2, "0")}`}
                        min={`${String(Math.floor(plan.start / 60)).padStart(2, "0")}:${String(plan.start % 60).padStart(2, "0")}`}
                        max={`${String(Math.floor(plan.end / 60)).padStart(2, "0")}:${String(plan.end % 60).padStart(2, "0")}`}
                        onChange={(event) => changeAsOf(event.target.value)}
                        disabled={busy}
                      />
                    </label>
                  </div>
                  {preview && (
                    <div className="preview-banner">
                      <span>
                        <Sparkles size={15} />
                        <strong>
                          {changedIds.size} activities change.
                        </strong>{" "}
                        Fixed moments stay right where they are.
                      </span>
                      <button onClick={() => setModal("checks")}>
                        View checks <ArrowUpRight size={13} />
                      </button>
                    </div>
                  )}
                  <div className="timeline" aria-label="Event schedule">
                    {displaySessions.map((session, index) => {
                      const previous = (resultBase ?? plan).sessions.find(
                        (item) => item.id === session.id,
                      );
                      const changed = !!selected && changedIds.has(session.id);
                      const person = plan.people.find(
                        (item) => item.id === session.ownerId,
                      );
                      const room = plan.rooms.find(
                        (item) => item.id === session.roomId,
                      );
                      const elapsed = session.start < (plan.asOf ?? plan.start);
                      const isExpanded = expandedSession === session.id;
                      return (
                        <div
                          key={session.id}
                          className={`timeline-row ${changed ? "changed" : ""} ${session.kind === "break" ? "break-row" : ""} ${elapsed ? "elapsed" : ""}`}
                          style={{ animationDelay: `${index * 28}ms` }}
                        >
                          <div className="timeline-time">
                            {changed && previous?.start !== session.start && (
                              <del>{formatTime(previous!.start)}</del>
                            )}
                            <strong>{formatTime(session.start)}</strong>
                            <span>{session.start < 720 ? "AM" : "PM"}</span>
                          </div>
                          <div className="timeline-track">
                            <span
                              className={`timeline-dot ${changed ? "changed-dot" : ""} ${session.kind !== "session" ? "hollow-dot" : ""}`}
                            />
                          </div>
                          <button
                            className="session-card"
                            aria-expanded={isExpanded}
                            onClick={() =>
                              setExpandedSession(isExpanded ? null : session.id)
                            }
                          >
                            <div className="session-main">
                              <div className="session-topline">
                                <span
                                  className={`session-kind ${session.kind === "break" ? "break-kind" : ""}`}
                                >
                                  {isSample && session.id === "keynote"
                                    ? "KEYNOTE"
                                    : isSample && session.id === "workshop"
                                      ? "WORKSHOP"
                                      : isSample && session.id === "build"
                                        ? "BUILD SESSION"
                                        : isSample && session.id === "showcase"
                                          ? "COMMUNITY DEMOS"
                                          : session.kind === "break"
                                            ? "BREAK"
                                            : session.kind === "fixed"
                                              ? "FIXED COMMITMENT"
                                              : isSample
                                                ? "CONVERSATION"
                                                : "ACTIVITY"}
                                </span>
                                {changed && (
                                  <span className="change-tag">
                                    {applied ? "Updated" : "Changing"}
                                  </span>
                                )}
                              </div>
                              <h3>{session.title}</h3>
                              <div className="session-meta">
                                <span>{person?.name}</span>
                                <i />
                                {changed &&
                                previous?.roomId !== session.roomId ? (
                                  <span className="room-changed">
                                    {room?.name}
                                    <ArrowUpRight size={11} />
                                  </span>
                                ) : (
                                  <span>{room?.name}</span>
                                )}
                                <i />
                                <span>{session.duration} min</span>
                              </div>
                              {isExpanded && (
                                <div className="session-expanded">
                                  <p>{session.notes}</p>
                                  <div>
                                    <span>{session.attendees} attendees</span>
                                    <span>
                                      {session.setupMinutes ?? 0} min changeover
                                    </span>
                                    {session.requiredEquipment.map((item) => (
                                      <Equipment key={item} name={item} />
                                    ))}
                                  </div>
                                  {changed &&
                                    selected?.changes
                                      .filter(
                                        (change) =>
                                          change.sessionId === session.id,
                                      )
                                      .map((change) => (
                                        <p
                                          key={change.field}
                                          className="change-reason"
                                        >
                                          <ArrowRight size={13} />
                                          {change.before} → {change.after}.{" "}
                                          {change.reason}
                                        </p>
                                      ))}
                                </div>
                              )}
                            </div>
                            <div className="session-side">
                              {session.locked || elapsed ? (
                                <span className="fixed-label">
                                  <LockKeyhole size={11} />
                                  {elapsed ? "Started" : "Fixed"}
                                </span>
                              ) : (
                                <Avatar
                                  plan={plan}
                                  id={session.ownerId}
                                  small
                                />
                              )}
                              <ChevronDown
                                size={14}
                                className={isExpanded ? "chevron-open" : ""}
                              />
                            </div>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="schedule-footer">
                    <span>
                      <ShieldCheck size={15} />
                      {fixedCount} fixed moments protected
                    </span>
                    <span>Earlier activities stay fixed</span>
                  </div>
                </section>
              )}

              {view === "people" && (
                <section className="people-panel">
                  <div className="panel-heading">
                    <div className="heading-with-count">
                      <h2>The people behind the day</h2>
                      <span className="soft-count">{plan.people.length}</span>
                    </div>
                  </div>
                  <div className="people-list">
                    {plan.people.map((person) => (
                      <div className="person-row" key={person.id}>
                        <Avatar plan={plan} id={person.id} />
                        <div>
                          <strong>{person.name}</strong>
                          <span>{person.role}</span>
                        </div>
                        <span className="person-count">
                          {
                            plan.sessions.filter(
                              (session) => session.ownerId === person.id,
                            ).length
                          }{" "}
                          activities
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="spaces-heading">
                    <h2>A place for every idea</h2>
                    <span>{plan.rooms.length} spaces</span>
                  </div>
                  <div className="space-cards">
                    {plan.rooms.map((room) => (
                      <article className="space-card" key={room.id}>
                        <div className="space-icon">
                          <DoorOpen size={21} />
                        </div>
                        <h3>{room.name}</h3>
                        <p>Room for {room.capacity} people</p>
                        <div>
                          {room.equipment.map((item) => (
                            <Equipment name={item} key={item} />
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="info-footnote">
                    <FileJson size={15} />
                    People, spaces, and requirements come from your event plan.
                    Use the schedule menu to import your own JSON.
                  </div>
                </section>
              )}

              {view === "history" && (
                <section className="history-panel">
                  <div className="panel-heading">
                    <div className="heading-with-count">
                      <h2>A record of the ripples</h2>
                      <span className="soft-count">
                        {history.length} applied
                      </span>
                    </div>
                  </div>
                  {history.length ? (
                    <div className="history-list">
                      {history.map((record, index) => (
                        <article key={record.id} className="history-card">
                          <div className="history-number">
                            {String(history.length - index).padStart(2, "0")}
                          </div>
                          <div>
                            <div className="history-card-top">
                              <span className="eyebrow">APPLIED LOCALLY</span>
                              <time>
                                {new Date(record.at).toLocaleTimeString([], {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </time>
                            </div>
                            <h3>{record.option.title}</h3>
                            <p>{record.result.interpretation.description}</p>
                            <div className="history-changes">
                              {record.option.changes.map((change) => (
                                <span
                                  key={`${change.sessionId}-${change.field}`}
                                >
                                  {change.before}
                                  <ArrowRight size={11} />
                                  {change.after}
                                </span>
                              ))}
                            </div>
                            <button
                              className="text-button"
                              onClick={() =>
                                download(
                                  `ripple-change-${history.length - index}.txt`,
                                  exportHandoff(
                                    record.before,
                                    record.result,
                                    record.option,
                                    true,
                                  ),
                                )
                              }
                            >
                              <ArrowDownToLine size={14} />
                              Download handoff
                            </button>
                          </div>
                        </article>
                      ))}
                      <button
                        className="secondary-button undo-history"
                        disabled={busy}
                        onClick={undoLast}
                      >
                        <RotateCcw size={15} />
                        Undo the latest change
                      </button>
                    </div>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-icon">
                        <History size={28} strokeWidth={1.4} />
                      </div>
                      <h3>A fresh page.</h3>
                      <p>
                        When you apply a repair, its changes and handoff drafts
                        will appear here. Your latest 12 repairs stay on this
                        device.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => {
                          setView("schedule");
                          textareaRef.current?.focus();
                        }}
                      >
                        Back to the plan <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                </section>
              )}

              {selected && view === "schedule" && (
                <section className="handoff-section">
                  <div className="section-mini-heading">
                    <div>
                      <div className="eyebrow">NO ONE LEFT WONDERING</div>
                      <h2>The right update. The right person.</h2>
                    </div>
                    <span className="drafts-label">
                      {selected.handoffs.length} drafts
                    </span>
                  </div>
                  <p className="handoff-subtitle">
                    {applied
                      ? "Approved update. Copy a draft to share it with the person affected."
                      : "Proposal drafts. Apply this repair before sharing these updates."}{" "}
                    Nothing is sent automatically.
                  </p>
                  <div className="handoff-list">
                    {selected.handoffs.map((handoff) => (
                      <div key={handoff.personId} className="handoff-card">
                        <div className="handoff-person">
                          <Avatar plan={plan} id={handoff.personId} small />
                          <div>
                            <strong>
                              {plan.people.find(
                                (person) => person.id === handoff.personId,
                              )?.name ?? handoff.personId}
                            </strong>
                            <span>
                              {plan.people.find(
                                (person) => person.id === handoff.personId,
                              )?.role ?? "Activity owner"}
                            </span>
                          </div>
                          <button
                            className="icon-button"
                            disabled={!applied}
                            onClick={() => void copyHandoff(handoff)}
                            aria-label={`Copy ${handoff.title}`}
                          >
                            {copied === handoff.personId ? (
                              <Check size={16} />
                            ) : (
                              <Copy size={16} />
                            )}
                          </button>
                        </div>
                        <p>{handoff.message}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <aside className="repair-column" aria-label="Repair the event plan">
              <section className={`repair-panel ${result ? "has-result" : ""}`}>
                <div className="repair-accent" />
                {!result && (
                  <>
                    <div className="sparkle-label">
                      <Sparkles size={15} />
                      <span>A LITTLE HELP WITH THE UNEXPECTED</span>
                    </div>
                    <h2>
                      Plans change.
                      <br />
                      <em>You’ve got this.</em>
                    </h2>
                    <p className="repair-intro">
                      Choose what changed. Compare checked repairs, then decide
                      what to apply.
                    </p>
                  </>
                )}
                {result && (
                  <div className="result-heading">
                    <div
                      className={`result-status-icon ${!selected ? "attention-icon" : applied ? "applied-icon" : ""}`}
                    >
                      {!selected ? (
                        <CircleAlert size={23} />
                      ) : applied ? (
                        <CheckCheck size={24} />
                      ) : (
                        <Sparkles size={23} />
                      )}
                    </div>
                    <div className="eyebrow">
                      {applied
                        ? "BACK IN MOTION"
                        : selected
                          ? "THERE’S A WAY FORWARD"
                          : "A HUMAN MOMENT"}
                    </div>
                    <h2>
                      {applied
                        ? "That’s the new plan."
                        : selected
                          ? "A ripple. Not a reset."
                          : "This needs a decision."}
                    </h2>
                    <p>
                      {applied
                        ? "The schedule is updated. All that’s left is bringing your people along."
                        : result.summary}
                    </p>
                  </div>
                )}

                {!result && (
                  <>
                    <div
                      className="input-mode-switch"
                      aria-label="How to describe the change"
                    >
                      <button
                        aria-pressed={inputMode === "guided"}
                        disabled={busy}
                        onClick={() => setInputMode("guided")}
                      >
                        Choose a change
                      </button>
                      <button
                        aria-pressed={inputMode === "text"}
                        disabled={busy}
                        onClick={() => setInputMode("text")}
                      >
                        Describe in words
                      </button>
                    </div>
                    {inputMode === "guided" ? (
                      <GuidedRepair
                        plan={plan}
                        busy={busy}
                        onChange={setGuidedChange}
                      />
                    ) : (
                      <>
                        <div
                          className={`disruption-input ${busy ? "input-busy" : ""}`}
                        >
                          <label htmlFor="disruption" className="sr-only">
                            Describe the change to your event
                          </label>
                          <textarea
                            ref={textareaRef}
                            id="disruption"
                            placeholder={
                              isSample
                                ? "e.g. Maya is 40 minutes late for her keynote."
                                : "Name one activity or room and say what changed. For exact choices, use Choose a change."
                            }
                            value={disruption}
                            onChange={(event) =>
                              setDisruption(event.target.value)
                            }
                            disabled={busy}
                            maxLength={1800}
                            onKeyDown={(event) => {
                              if (
                                (event.metaKey || event.ctrlKey) &&
                                event.key === "Enter"
                              ) {
                                event.preventDefault();
                                void runRepair();
                              }
                            }}
                          />
                          <div className="input-foot">
                            <span>What changed?</span>
                            <span>⌘ ↵</span>
                          </div>
                        </div>
                        <p className="text-mode-help">
                          {useService && health?.mode === "live"
                            ? "The connected model will interpret your change."
                            : "Handles one named delay, room closure, or duration change. Use the guided form if names are ambiguous."}
                        </p>
                      </>
                    )}
                    <button
                      className="primary-button repair-button"
                      disabled={
                        busy ||
                        (inputMode === "guided"
                          ? !guidedChange
                          : !disruption.trim())
                      }
                      onClick={() => void runRepair()}
                    >
                      {busy ? (
                        <>
                          <LoaderCircle size={17} className="spin" />
                          {useService
                            ? "Working through the change…"
                            : "Checking the possibilities…"}
                        </>
                      ) : (
                        <>
                          Find a way forward
                          <ArrowUpRight size={18} />
                        </>
                      )}
                    </button>
                    {error && (
                      <div className="inline-error" role="alert">
                        <CircleAlert size={16} />
                        <span>{error}</span>
                      </div>
                    )}
                    {busy && useService && (
                      <div className="job-wait" role="status">
                        <span>
                          <LoaderCircle size={13} className="spin" />
                          {jobStatus === "running"
                            ? "Working in the background. You can keep reviewing the plan."
                            : "The repair is queued. Your current plan stays in place."}
                        </span>
                        <button onClick={() => requestRef.current?.abort()}>
                          Stop waiting
                        </button>
                      </div>
                    )}
                    {isSample && (
                      <div className="example-section">
                        <div className="eyebrow">
                          OR TRY A LITTLE PLOT TWIST
                        </div>
                        {EXAMPLE_DISRUPTIONS.map((example) => (
                          <button
                            key={example.icon}
                            className={`example-button ${disruption === example.text ? "example-active" : ""}`}
                            onClick={() => chooseExample(example.text)}
                            disabled={busy}
                          >
                            <span className={`example-icon ${example.icon}`}>
                              {example.icon === "clock" ? (
                                <Clock3 size={16} />
                              ) : example.icon === "room" ? (
                                <DoorOpen size={16} />
                              ) : (
                                <Plus size={16} />
                              )}
                            </span>
                            {example.label}
                            <ArrowUpRight size={14} />
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {result && (
                  <>
                    <div className="reported-change">
                      <span className="eyebrow">THE CHANGE</span>
                      <p>{disruption}</p>
                      <p className="interpretation-confirmation">
                        {result.interpretation.description}
                      </p>
                      {!applied && (
                        <button
                          onClick={() => {
                            clearRepair();
                            setTimeout(() => textareaRef.current?.focus(), 0);
                          }}
                        >
                          Edit
                          <ArrowUpRight size={12} />
                        </button>
                      )}
                    </div>
                    {!selected && (
                      <>
                        <div className="blocker-box">
                          {result.blockers.map((blocker, index) => (
                            <p key={index}>
                              <CircleAlert size={15} />
                              {blocker}
                            </p>
                          ))}
                        </div>
                        <button
                          className="primary-button"
                          onClick={() => {
                            clearRepair();
                            setTimeout(() => textareaRef.current?.focus(), 0);
                          }}
                        >
                          Adjust the change
                          <ArrowRight size={16} />
                        </button>
                        <button
                          className="secondary-button full-width"
                          onClick={() => setEditor("edit")}
                        >
                          Edit event constraints
                        </button>
                      </>
                    )}
                    {selected && !applied && (
                      <>
                        <div className="options-heading">
                          <span className="eyebrow">
                            CHOOSE YOUR WAY FORWARD
                          </span>
                          <span>
                            {result.options.length}{" "}
                            {result.options.length === 1 ? "option" : "options"}
                          </span>
                        </div>
                        <div className="repair-options">
                          {result.options.map((option, index) => (
                            <button
                              key={option.id}
                              className={`repair-option ${option.id === selected.id ? "selected" : ""}`}
                              onClick={() => setSelectedId(option.id)}
                              aria-pressed={option.id === selected.id}
                            >
                              <div className="option-top">
                                <span className="option-radio">
                                  {option.id === selected.id && <span />}
                                </span>
                                <span>
                                  {index === 0
                                    ? "SMALLEST CHANGE FOUND"
                                    : "ANOTHER WAY THROUGH"}
                                </span>
                                {index === 0 && (
                                  <span className="recommended-star">✦</span>
                                )}
                              </div>
                              <h3>{option.title}</h3>
                              <p>{option.description}</p>
                              <div className="option-metrics">
                                {
                                  new Set(
                                    option.changes.map(
                                      (change) => change.sessionId,
                                    ),
                                  ).size
                                }{" "}
                                activities<span>·</span>
                                {option.handoffs.length} people to update
                              </div>
                            </button>
                          ))}
                        </div>
                        <button
                          className="checks-button"
                          onClick={() => setModal("checks")}
                        >
                          <ShieldCheck size={17} />
                          <span>All {checks.length} guardrails checked</span>
                          <ArrowUpRight size={14} />
                        </button>
                        <button
                          className="primary-button apply-button"
                          onClick={applyRepair}
                        >
                          Make this the plan
                          <Check size={17} />
                        </button>
                        <p className="approval-note">
                          Updates this browser’s plan. Sends no messages.
                        </p>
                      </>
                    )}
                    {selected && applied && (
                      <>
                        <div className="applied-metrics">
                          <div>
                            <strong>{changedIds.size}</strong>
                            <span>activities updated</span>
                          </div>
                          <div>
                            <strong>{selected.handoffs.length}</strong>
                            <span>handoff drafts ready</span>
                          </div>
                        </div>
                        <button
                          className="primary-button"
                          onClick={exportSelected}
                        >
                          Download the handoff
                          <ArrowDownToLine size={17} />
                        </button>
                        <button
                          className="secondary-button full-width"
                          onClick={() => {
                            clearRepair();
                            setDisruption("");
                            setTimeout(() => textareaRef.current?.focus(), 0);
                          }}
                        >
                          Another change?
                          <Plus size={16} />
                        </button>
                        <button className="undo-button" onClick={undoLast}>
                          <RotateCcw size={13} />
                          Undo this change
                        </button>
                      </>
                    )}
                  </>
                )}

                {result && (
                  <div className="trace-section">
                    <button
                      className="trace-toggle"
                      onClick={() => setShowTrace(!showTrace)}
                      aria-expanded={showTrace}
                    >
                      <span>
                        <span className="tiny-status-dot" />
                        {result.mode === "demo"
                          ? "How the planner checked this"
                          : "How the repair was made"}
                      </span>
                      <ChevronDown
                        size={14}
                        className={showTrace ? "chevron-open" : ""}
                      />
                    </button>
                    {showTrace && (
                      <div className="trace-list">
                        {result.trace.map((step) => (
                          <div className="trace-step" key={step.id}>
                            <span>
                              <Check size={12} />
                            </span>
                            <div>
                              <strong>{step.label}</strong>
                              <p>{step.detail}</p>
                              {step.model && (
                                <small>
                                  {step.provider ? `${step.provider} · ` : ""}
                                  {step.model}
                                </small>
                              )}
                              {(typeof step.inputTokens === "number" ||
                                typeof step.outputTokens === "number") && (
                                <p className="trace-usage">
                                  {typeof step.inputTokens === "number"
                                    ? `${step.inputTokens.toLocaleString()} input`
                                    : ""}
                                  {typeof step.inputTokens === "number" &&
                                  typeof step.outputTokens === "number"
                                    ? " · "
                                    : ""}
                                  {typeof step.outputTokens === "number"
                                    ? `${step.outputTokens.toLocaleString()} output`
                                    : ""}{" "}
                                  tokens
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {result && error && (
                  <div className="inline-error" role="alert">
                    <CircleAlert size={16} />
                    <span>{error}</span>
                  </div>
                )}
                <div className="demo-disclosure">
                  <span className="disclosure-dot" />
                  <span>
                    {result?.mode === "live" ||
                    (!result && useService && health?.mode === "live")
                      ? "Connected to NVIDIA Nemotron through your Nebius service."
                      : useService
                        ? "The connected service is in demo mode. No model is called."
                        : "Works on this device · no account or AI calls needed."}
                  </span>
                </div>
              </section>

              {!result && (
                <div className="promise-note">
                  <span className="promise-mark">↳</span>
                  <div>
                    <h3>The day is yours.</h3>
                    <p>
                      Ripple checks the details.
                      <br />
                      You decide what changes.
                    </p>
                  </div>
                  <svg
                    aria-hidden="true"
                    className="promise-scribble"
                    viewBox="0 0 80 45"
                  >
                    <path d="M3 30C24 5 41 4 39 24S12 34 21 17 55 2 75 18M67 9L76 19 63 22" />
                  </svg>
                </div>
              )}
              {selected && !applied && (
                <button className="export-preview" onClick={exportSelected}>
                  <ArrowDownToLine size={14} />
                  Download this preview
                </button>
              )}
              {result?.sources && result.sources.length > 0 && (
                <div className="sources-panel">
                  <span className="eyebrow">RESEARCH TO HELP YOU DECIDE</span>
                  <p className="source-disclaimer">
                    External leads. Availability is unverified.
                  </p>
                  {result.sources.map((source) => (
                    <a
                      href={/^https?:\/\//.test(source.url) ? source.url : "#"}
                      key={source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <strong>
                        {source.title}
                        <ExternalLink size={12} />
                      </strong>
                      <p>{source.snippet}</p>
                      {source.retrievedAt && (
                        <small>
                          Retrieved{" "}
                          {source.retrievedAt.replace("T", " ").slice(0, 16)}{" "}
                          UTC
                        </small>
                      )}
                    </a>
                  ))}
                </div>
              )}
            </aside>
          </div>
          <footer className="workspace-footer">
            <span>Less scrambling. More being there.</span>
            <span>
              Ripple <i />{" "}
              {useService
                ? "Connected workspace"
                : "Your plan stays on this device"}
            </span>
          </footer>
        </main>
      </div>

      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        onChange={(event) => void importPlan(event)}
        hidden
      />
      <div className="sr-only" role="status" aria-live="polite">
        {busy
          ? "Checking possible repairs. Your existing plan is unchanged."
          : result
            ? `${result.summary} ${applied ? "The selected repair has been applied locally." : ""}`
            : ""}
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button
            onClick={() => setToast("")}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {editor && (
        <EventEditor
          plan={editor === "edit" ? plan : null}
          onSave={saveEvent}
          onClose={() => setEditor(null)}
        />
      )}

      {modal === "events" && (
        <Modal
          title="Your events"
          eyebrow="SAVED ON THIS DEVICE"
          onClose={() => setModal(null)}
        >
          <p className="modal-intro">
            Switch between your current event and up to six recent events.
            Download event JSON to keep a backup beyond this browser.
          </p>
          <div className="saved-event-list">
            <div className="saved-event active">
              <div>
                <strong>{plan.name}</strong>
                <span>{plan.date} · Current event</span>
              </div>
              <Check size={18} />
            </div>
            {events
              .filter((item) => item.id !== plan.id)
              .map((item) => (
                <button
                  className="saved-event"
                  key={item.id}
                  onClick={() => saveEvent(item)}
                >
                  <div>
                    <strong>{item.name}</strong>
                    <span>
                      {item.date} · {item.sessions.length} activities
                    </span>
                  </div>
                  <ArrowRight size={18} />
                </button>
              ))}
          </div>
          <button
            className="primary-button"
            onClick={() => {
              setModal(null);
              setEditor("create");
            }}
          >
            <Plus size={16} />
            Create another event
          </button>
        </Modal>
      )}

      {modal === "checks" && (
        <Modal
          title="A little certainty, built in."
          eyebrow="THE GUARDRAILS"
          onClose={() => setModal(null)}
        >
          <p className="modal-intro">
            Every proposed repair must pass these checks before it becomes an
            option.
          </p>
          <div className="check-list">
            {checks.map((check) => (
              <div
                className={`check-row ${!check.passed ? "check-failed" : ""}`}
                key={check.id}
              >
                <span>
                  {check.passed ? <Check size={15} /> : <X size={15} />}
                </span>
                <div>
                  <strong>{check.label}</strong>
                  <p>{check.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="modal-footnote">
            These checks cover the facts in your event plan. Room details and
            people’s availability should be confirmed by the organizer.
          </div>
        </Modal>
      )}

      {modal === "settings" && (
        <Modal
          title="Your plan. Your connection."
          eyebrow="CONNECTION SETTINGS"
          onClose={() => setModal(null)}
        >
          <p className="modal-intro">
            The local planner works with your own events, without an account.
            Connect a Ripple backend to use NVIDIA Nemotron on Nebius Token
            Factory.
          </p>
          <div
            className={`connection-choice ${!useService ? "connection-active" : ""}`}
          >
            <div className="connection-icon">
              <LayoutList size={20} />
            </div>
            <div>
              <strong>Local planner</strong>
              <p>
                Deterministic repairs in this browser. No API key or model call.
              </p>
            </div>
            <button
              className="small-button"
              onClick={() => {
                setUseService(false);
                clearRepair();
                setModal(null);
                setToast(
                  "Using the local planner. Your event plan stays in this browser.",
                );
              }}
            >
              {!useService ? "In use" : "Use local planner"}
            </button>
          </div>
          <div className="settings-service">
            <label htmlFor="service-url">Ripple backend URL</label>
            <p>
              Keys stay on your server. Only this URL is saved in the browser.
            </p>
            <div className="service-input-row">
              <input
                id="service-url"
                type="url"
                value={serviceUrl}
                placeholder="https://your-ripple-service.example"
                onChange={(event) => {
                  setServiceUrl(event.target.value);
                  setHealth(null);
                  setServiceError("");
                }}
              />
              <button
                className="secondary-button"
                onClick={() => void checkService()}
                disabled={checking || !serviceUrl.trim()}
              >
                {checking ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  "Check"
                )}
              </button>
            </div>
            <div className="access-token-field">
              <label htmlFor="access-token">Organizer access token</label>
              <input
                id="access-token"
                type="password"
                autoComplete="off"
                value={accessToken}
                placeholder="Your server’s app token"
                onChange={(event) => setAccessToken(event.target.value)}
              />
              <p>
                Kept in memory for this tab. Enter your Ripple app token, never
                a Nebius or Tavily API key.
              </p>
            </div>
            {serviceError && (
              <div className="inline-error" role="alert">
                <CircleAlert size={15} />
                {serviceError}
              </div>
            )}
            {health && (
              <div className="health-result">
                <span>
                  <Check size={15} />
                  Service reached ·{" "}
                  {health.mode === "live" ? "live mode" : "demo mode"}
                </span>
                <p>
                  {health.mode === "live"
                    ? "Requests send this event plan and its disruption to the connected service. Model credentials remain on that service."
                    : "This service reports demo mode. Connecting it will not call an AI model."}
                </p>
                <button
                  className="primary-button"
                  disabled={health.mode === "live" && !accessToken.trim()}
                  onClick={() => {
                    setUseService(true);
                    clearRepair();
                    setModal(null);
                    setToast(
                      `Connected to the ${health.mode === "live" ? "live" : "demo"} service.`,
                    );
                  }}
                >
                  Use this service
                  <ArrowRight size={16} />
                </button>
                {health.mode === "live" && !accessToken.trim() && (
                  <p className="token-required">
                    Enter the organizer token to connect to live mode.
                  </p>
                )}
              </div>
            )}
          </div>
          <a
            className="documentation-link"
            href="https://github.com/aaravsinhaofficial/ripple#readme"
            target="_blank"
            rel="noreferrer"
          >
            Backend setup and deployment guide
            <ArrowUpRight size={14} />
          </a>
        </Modal>
      )}

      {modal === "about" && (
        <Modal
          title="A ripple doesn’t have to become a wave."
          eyebrow="A LITTLE ABOUT RIPPLE"
          onClose={() => setModal(null)}
        >
          <p className="modal-intro">
            For the volunteer organizer, workshop host, and person holding the
            whole day in their head. Ripple helps repair a running plan when
            something changes. It supports one event day with one activity at a
            time, even when the group moves between rooms.
          </p>
          <div className="about-steps">
            <div>
              <span>01</span>
              <h3>Tell it what changed.</h3>
              <p>
                A delayed speaker, a lost room, a session that needs more time.
              </p>
            </div>
            <div>
              <span>02</span>
              <h3>See a checked way forward.</h3>
              <p>
                Compare repairs that respect the people, spaces, and fixed
                moments in your plan.
              </p>
            </div>
            <div>
              <span>03</span>
              <h3>Bring everyone along.</h3>
              <p>
                Apply the plan locally and take targeted handoff drafts to your
                team.
              </p>
            </div>
          </div>
          <div className="architecture-note">
            <Sparkles size={20} />
            <div>
              <strong>Open models. Practical work.</strong>
              <p>
                The live backend uses NVIDIA Nemotron on Nebius Token Factory.
                The local planner runs a bounded schedule search and the same
                kinds of constraint checks; it does not call a model. Search
                results, when provided by the live service, remain suggestions
                for a person to verify.
              </p>
            </div>
          </div>
          <a
            className="documentation-link"
            href="https://github.com/aaravsinhaofficial/ripple"
            target="_blank"
            rel="noreferrer"
          >
            Explore the open-source project
            <ArrowUpRight size={14} />
          </a>
        </Modal>
      )}

      {modal === "reset" && (
        <Modal
          title="A fresh start for the day?"
          eyebrow="RESET THE LOCAL WORKSPACE"
          onClose={() => setModal(null)}
        >
          <p className="modal-intro">
            This replaces the current event with the Fieldnotes sample and
            clears the sample’s change log. Your current event will be kept in
            Your events. Download event JSON if you want to keep it.
          </p>
          <div className="reset-actions">
            <button
              className="secondary-button"
              onClick={() =>
                download(
                  `ripple-${plan.id}.json`,
                  JSON.stringify(plan, null, 2),
                  "application/json",
                )
              }
            >
              <ArrowDownToLine size={15} />
              Export current event
            </button>
            <button
              className="primary-button"
              onClick={() => {
                saveEvent(clonePlan(SAMPLE_PLAN));
                setHistory([]);
                clearRepair();
                setDisruption("");
                setRoomFilter("all");
                setView("schedule");
                setModal(null);
                setToast("The original Fieldnotes day is ready again.");
              }}
            >
              Reset to sample
              <RotateCcw size={15} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default App;
