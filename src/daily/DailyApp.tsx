import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Coffee,
  Download,
  FileText,
  History,
  LayoutDashboard,
  ListTodo,
  LockKeyhole,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Timer,
  Upload,
  WandSparkles,
  Waves,
  X,
} from "lucide-react";
import type { Commitment, DailyTask, DayPlan, Workspace } from "./types";
import { planDay, validateDayPlan } from "./planner";
import { captureLines } from "./capture";
import {
  createWorkspace,
  sampleWorkspace,
  completeTask,
  localDate,
  addDays,
  loadWorkspace,
  saveWorkspace,
  parseWorkspace,
} from "./storage";
import { exportPlanText, exportPlanCalendar, exportBackup } from "./export";
import TaskEditor from "./TaskEditor";
import Preferences from "./Preferences";
import CommitmentEditor from "./CommitmentEditor";
import DailyModal from "./DailyModal";
import {
  assist,
  presetServiceUrl,
  verifyConnection,
  type AssistResult,
  type Connection,
} from "./assist";
import "./daily.css";

type Snapshot = {
  workspace: Workspace;
  plan: DayPlan | null;
  signature: string;
  label: string;
  at: string;
};
type Preview = {
  workspace: Workspace;
  plan: DayPlan;
  label: string;
  baseSignature: string;
};
const PLAN_KEY = "ripple-daily-approved-v1";
const HISTORY_KEY = "ripple-daily-history-v1";
const fmt = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const mins = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
const duration = (m: number) =>
  m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
const dateLabel = (
  s: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
  },
) => new Date(`${s}T12:00:00`).toLocaleDateString(undefined, options);
const signature = (w: Workspace) => JSON.stringify(w);
let initialStorageProblem = "";
let unreadableBackup: string | null = null;
function localMinute(timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  return (
    Number(parts.find((p) => p.type === "hour")?.value) * 60 +
    Number(parts.find((p) => p.type === "minute")?.value)
  );
}
function freshWorkspace() {
  const workspace = createWorkspace();
  workspace.settings.planFrom = Math.max(
    workspace.settings.start,
    Math.min(
      workspace.settings.end,
      Math.ceil(localMinute(workspace.settings.timezone) / 5) * 5,
    ),
  );
  return workspace;
}
function initialWorkspace() {
  try {
    return loadWorkspace() || freshWorkspace();
  } catch {
    initialStorageProblem =
      "The saved workspace could not be read. Download its original data before replacing it, or restore a valid backup.";
    try {
      unreadableBackup = localStorage.getItem("ripple-daily-workspace-v1");
    } catch {}
    return freshWorkspace();
  }
}
function validSavedPlan(plan: unknown, sig: unknown): plan is DayPlan {
  try {
    if (!plan || typeof sig !== "string") return false;
    const p = plan as DayPlan;
    if (
      !Array.isArray(p.warnings) ||
      p.warnings.some((w) => typeof w !== "string") ||
      typeof p.summary !== "string" ||
      !Array.isArray(p.checks) ||
      p.checks.some(
        (c) =>
          !c ||
          typeof c.id !== "string" ||
          typeof c.label !== "string" ||
          typeof c.detail !== "string" ||
          typeof c.passed !== "boolean",
      )
    )
      return false;
    return validateDayPlan(parseWorkspace(JSON.parse(sig)), p).every(
      (c) => c.passed,
    );
  } catch {
    return false;
  }
}
function readApproved() {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    const item = raw ? JSON.parse(raw) : null;
    return item && validSavedPlan(item.plan, item.signature) ? item : null;
  } catch {
    return null;
  }
}
function readHistory(): Snapshot[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(raw)
      ? raw.slice(0, 15).flatMap((item) => {
          try {
            const workspace = parseWorkspace(item.workspace);
            if (
              typeof item.label !== "string" ||
              typeof item.at !== "string" ||
              !Number.isFinite(Date.parse(item.at))
            )
              return [];
            return [
              {
                ...item,
                workspace,
                signature:
                  typeof item.signature === "string" ? item.signature : "",
                plan: validSavedPlan(item.plan, item.signature)
                  ? item.plan
                  : null,
              },
            ];
          } catch {
            return [];
          }
        })
      : [];
  } catch {
    return [];
  }
}
function download(name: string, text: string, type = "text/plain") {
  const a = document.createElement("a");
  const url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
function taskSlot(plan: DayPlan | null, id: string) {
  return (
    plan?.blocks
      .filter((b) => b.taskId === id)
      .map((b) => `${fmt(b.start)}–${fmt(b.end)}`)
      .join(", ") || "Not scheduled"
  );
}
function getDiff(before: DayPlan | null, after: DayPlan, w: Workspace) {
  return w.tasks
    .filter((t) => t.status === "todo")
    .map((t) => ({
      task: t,
      before: taskSlot(before, t.id),
      after: taskSlot(after, t.id),
    }))
    .filter((t) => t.before !== t.after);
}
function defaultTask(title: string, minutes = 30): DailyTask {
  return {
    id: crypto.randomUUID(),
    title,
    minutes,
    priority: "normal",
    project: "",
    notes: "",
    status: "todo",
    dependsOn: [],
    splittable: true,
    recurrence: "none",
    createdAt: new Date().toISOString(),
  };
}

export default function DailyApp() {
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace);
  const [initial] = useState(readApproved);
  const [approved, setApproved] = useState<DayPlan | null>(() => {
    const p = initial?.plan;
    return p &&
      Array.isArray(p.blocks) &&
      Array.isArray(p.overflow) &&
      Array.isArray(p.checks)
      ? p
      : null;
  });
  const [approvedSignature, setApprovedSignature] = useState<string>(
    initial?.signature || "",
  );
  const [history, setHistory] = useState<Snapshot[]>(readHistory);
  const [storageError, setStorageError] = useState(initialStorageProblem);
  const initialWorkspaceSignature = useRef(signature(workspace));
  const [view, setView] = useState<"today" | "tasks" | "done">("today");
  const [project, setProject] = useState("");
  const [query, setQuery] = useState("");
  const [quick, setQuick] = useState("");
  const [quickMinutes, setQuickMinutes] = useState(30);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<DailyTask | "new" | null>(null);
  const [meeting, setMeeting] = useState<Commitment | "new" | null>(null);
  const [modal, setModal] = useState<
    | "capture"
    | "settings"
    | "recover"
    | "history"
    | "connect"
    | "help"
    | "export"
    | null
  >(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [capture, setCapture] = useState("");
  const [draft, setDraft] = useState<DailyTask[]>([]);
  const [recovery, setRecovery] = useState<
    "lost" | "longer" | "urgent" | "early"
  >("lost");
  const [recoveryMinutes, setRecoveryMinutes] = useState(30);
  const [recoveryFrom, setRecoveryFrom] = useState(workspace.settings.planFrom);
  const [recoveryTask, setRecoveryTask] = useState("");
  const [urgentTitle, setUrgentTitle] = useState("");
  const [earlyEnd, setEarlyEnd] = useState(workspace.settings.end - 60);
  const [connection, setConnection] = useState<Connection>({
    url: "",
    token: "",
  });
  const [connectionDraft, setConnectionDraft] = useState<Connection>(() => ({
    url: presetServiceUrl(),
    token: "",
  }));
  const [connectionStatus, setConnectionStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const assistController = useRef<AbortController | null>(null);
  const connectionController = useRef<AbortController | null>(null);
  const [assistResult, setAssistResult] = useState<AssistResult | null>(null);
  const [assistTask, setAssistTask] = useState<DailyTask | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusRemaining, setFocusRemaining] = useState(25 * 60);
  const [focusEnds, setFocusEnds] = useState<number | null>(null);
  const importRef = useRef<HTMLInputElement>(null),
    searchRef = useRef<HTMLInputElement>(null),
    quickRef = useRef<HTMLInputElement>(null);
  const currentSignature = signature(workspace);
  const fresh = !!approved && approvedSignature === currentSignature;
  const plan = approved?.date === workspace.settings.date ? approved : null;
  const todo = workspace.tasks.filter((t) => t.status === "todo");
  const projects = [
    ...new Set(workspace.tasks.map((t) => t.project).filter(Boolean)),
  ];
  const taskMap = new Map(workspace.tasks.map((t) => [t.id, t]));
  const filtered = workspace.tasks.filter(
    (t) =>
      (view === "done" ? t.status === "done" : t.status === "todo") &&
      (view !== "today" ||
        !t.earliestDate ||
        t.earliestDate <= workspace.settings.date) &&
      (!project || t.project === project) &&
      (!query ||
        `${t.title} ${t.project} ${t.notes}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const dayMeetings = workspace.commitments
    .filter((c) => c.date === workspace.settings.date)
    .sort((a, b) => a.start - b.start);
  const doneToday = workspace.tasks.filter(
    (t) =>
      t.status === "done" &&
      t.completedAt &&
      localDate(new Date(t.completedAt), workspace.settings.timezone) ===
        workspace.settings.date,
  );
  const openEligible = todo.filter(
    (t) => !t.earliestDate || t.earliestDate <= workspace.settings.date,
  );
  const focusTask = focusId ? taskMap.get(focusId) : undefined;
  const selectedToday =
    workspace.settings.date ===
    localDate(new Date(), workspace.settings.timezone);

  useEffect(() => {
    if (
      initialStorageProblem &&
      signature(workspace) === initialWorkspaceSignature.current
    )
      return;
    try {
      saveWorkspace(workspace);
      setStorageError(
        unreadableBackup
          ? "Your new work is saved. The unreadable original is still available to download in this tab."
          : "",
      );
    } catch {
      setStorageError(
        "Browser storage is unavailable or full. Your open work still works—download a backup before closing.",
      );
    }
  }, [workspace]);
  useEffect(() => {
    try {
      localStorage.setItem(
        PLAN_KEY,
        JSON.stringify({ plan: approved, signature: approvedSignature }),
      );
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      setStorageError(
        "Browser storage is unavailable or full. Download a backup before closing.",
      );
    }
  }, [approved, approvedSignature, history]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => () => connectionController.current?.abort(), []);
  useEffect(() => {
    if (focusEnds === null) return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((focusEnds - Date.now()) / 1000));
      setFocusRemaining(remaining);
      if (remaining === 0) {
        setFocusEnds(null);
        setToast(
          "Focus block finished. Mark the task done only if the work is finished.",
        );
      }
    };
    update();
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, [focusEnds]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        document.querySelector("dialog[open]") ||
        (e.target instanceof HTMLElement &&
          ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName))
      )
        return;
      if (e.key === "n") {
        e.preventDefault();
        setEditor("new");
      }
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "p") {
        e.preventDefault();
        makePreview(workspace, "Plan my day");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [workspace]);

  function checkpoint(label: string) {
    setHistory((h) =>
      [
        {
          workspace: structuredClone(workspace),
          plan: approved,
          signature: approvedSignature,
          label,
          at: new Date().toISOString(),
        },
        ...h,
      ].slice(0, 15),
    );
  }
  function update(next: Workspace, label: string) {
    try {
      const checked = parseWorkspace(next);
      checkpoint(label);
      setWorkspace(checked);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please check those details.");
      throw e;
    }
  }
  function saveTask(task: DailyTask) {
    const exists = workspace.tasks.some((t) => t.id === task.id);
    try {
      update(
        {
          ...workspace,
          tasks: exists
            ? workspace.tasks.map((t) => (t.id === task.id ? task : t))
            : [...workspace.tasks, task],
        },
        exists ? "Edit task" : "Add task",
      );
      setEditor(null);
      setToast(
        exists ? "Task updated. Refresh your plan when ready." : "Task added.",
      );
    } catch (e) {
      throw e;
    }
  }
  function addQuick(e: React.FormEvent) {
    e.preventDefault();
    if (!quick.trim()) return;
    const task = defaultTask(quick.trim(), quickMinutes);
    task.project = project;
    try {
      saveTask(task);
      setQuick("");
      quickRef.current?.focus();
    } catch {}
  }
  function toggleDone(task: DailyTask) {
    try {
      if (task.status === "done") {
        update(
          {
            ...workspace,
            tasks: workspace.tasks.map((t) =>
              t.id === task.id
                ? { ...t, status: "todo", completedAt: undefined }
                : t,
            ),
          },
          "Reopen task",
        );
        setToast("Task reopened.");
      } else {
        update(completeTask(workspace, task.id), "Complete task");
        setToast(
          task.recurrence === "none"
            ? "Done. Nice progress."
            : "Done. The next repeat is in your tasks.",
        );
        if (focusId === task.id) {
          setFocusId(null);
          setFocusEnds(null);
        }
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not change task status.",
      );
    }
  }
  function makePreview(next: Workspace, label: string) {
    try {
      const checked = parseWorkspace(next);
      const result = planDay(checked);
      const checks = validateDayPlan(checked, result);
      if (checks.some((c) => !c.passed))
        throw new Error(
          checks
            .filter((c) => !c.passed)
            .map((c) => c.detail)
            .join(" "),
        );
      setPreview({
        workspace: checked,
        plan: { ...result, checks },
        label,
        baseSignature: currentSignature,
      });
      setModal(null);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not build a checked plan.",
      );
    }
  }
  function applyPreview() {
    if (!preview) return;
    if (preview.baseSignature !== currentSignature) {
      setPreview(null);
      setError(
        "Your tasks changed after this preview. Build a fresh plan before applying it.",
      );
      return;
    }
    checkpoint(preview.label);
    setWorkspace(preview.workspace);
    setApproved(preview.plan);
    setApprovedSignature(signature(preview.workspace));
    setPreview(null);
    setView("today");
    setProject("");
    setToast("Plan applied. Your task finish time stays protected.");
  }
  function recover() {
    let next = structuredClone(workspace);
    if (recovery === "lost") {
      if (
        !Number.isInteger(recoveryFrom) ||
        recoveryFrom < next.settings.planFrom ||
        recoveryFrom > next.settings.end
      ) {
        setError(
          "Choose an unavailable-from time between the current planning start and finish.",
        );
        return;
      }
      next.settings.planFrom = Math.min(
        next.settings.end,
        recoveryFrom + recoveryMinutes,
      );
    }
    if (recovery === "longer") {
      if (!recoveryTask) {
        setError("Choose the task that needs more time.");
        return;
      }
      next.tasks = next.tasks.map((t) =>
        t.id === recoveryTask
          ? { ...t, minutes: t.minutes + recoveryMinutes }
          : t,
      );
    }
    if (recovery === "urgent") {
      if (!urgentTitle.trim()) {
        setError("Give the urgent task a name.");
        return;
      }
      next.tasks.push({
        ...defaultTask(urgentTitle.trim(), recoveryMinutes),
        priority: "high",
        dueDate: next.settings.date,
      });
    }
    if (recovery === "early") {
      next.settings.end = earlyEnd;
      next.settings.planFrom = Math.min(next.settings.planFrom, earlyEnd);
    }
    makePreview(
      next,
      recovery === "lost"
        ? `Recover ${recoveryMinutes} lost minutes`
        : recovery === "longer"
          ? "Allow more task time"
          : recovery === "urgent"
            ? "Make room for urgent work"
            : "Finish earlier",
    );
  }
  function setDate(date: string) {
    try {
      update(
        {
          ...workspace,
          settings: {
            ...workspace.settings,
            date,
            planFrom: workspace.settings.start,
          },
        },
        "Change planning day",
      );
      setToast("Unfinished tasks carry forward. Plan this day when ready.");
    } catch {}
  }
  function startFocus(task: DailyTask) {
    setFocusId(task.id);
    setFocusRemaining(
      Math.min(workspace.settings.focusMinutes, task.minutes) * 60,
    );
    setFocusEnds(null);
  }
  function prepareCapture() {
    try {
      const tasks = captureLines(capture, workspace.settings.date);
      if (!tasks.length)
        throw new Error("Add at least one task, one per line.");
      setDraft(tasks);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read those tasks.");
    }
  }
  function addDraft() {
    try {
      update(
        { ...workspace, tasks: [...workspace.tasks, ...draft] },
        "Add captured tasks",
      );
      setDraft([]);
      setCapture("");
      setAssistResult(null);
      setModal(null);
      setToast(
        `${draft.length} ${draft.length === 1 ? "task" : "tasks"} added. You can adjust estimates anytime.`,
      );
    } catch {}
  }
  async function askAssistant(
    action: "capture" | "breakdown" | "research",
    task?: DailyTask,
  ) {
    assistController.current?.abort();
    const controller = new AbortController();
    assistController.current = controller;
    setBusy(true);
    setError("");
    setAssistResult(null);
    try {
      const result = await assist(
        connection,
        action,
        action === "capture" ? capture : task?.title || "",
        workspace.settings.date,
        task,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setAssistResult(result);
      if (action === "capture") {
        const ids = result.tasks.map(() => crypto.randomUUID());
        setDraft(
          result.tasks.map((t, i) => ({
            ...defaultTask(t.title, t.minutes),
            id: ids[i],
            priority: t.priority,
            project: t.project,
            notes: t.notes,
            ...(t.dueDate ? { dueDate: t.dueDate } : {}),
            dependsOn: (t.dependsOnIndices || []).map((index) => ids[index]),
          })),
        );
      } else setAssistTask(task || null);
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(
        e instanceof Error ? e.message : "The assistant is unavailable.",
      );
    } finally {
      if (assistController.current === controller) setBusy(false);
    }
  }
  async function testConnection() {
    connectionController.current?.abort();
    const controller = new AbortController();
    connectionController.current = controller;
    setBusy(true);
    setConnectionStatus("");
    try {
      const checked = await verifyConnection(connectionDraft, controller.signal);
      if (controller.signal.aborted) return;
      setConnection(checked.connection);
      setConnectionDraft(checked.connection);
      setConnectionStatus(
        checked.mode === "live"
          ? "Connected to live AI. Requests run only when you choose an assistant action."
          : "Connected to a rules service. No AI model calls will be made.",
      );
    } catch (e) {
      if (controller.signal.aborted) return;
      setConnectionStatus(
        e instanceof Error ? e.message : "Could not connect.",
      );
    } finally {
      if (connectionController.current === controller) setBusy(false);
    }
  }
  function exportFile(kind: "text" | "calendar" | "backup") {
    try {
      if (kind === "backup") {
        download(
          `ripple-backup-${workspace.settings.date}.json`,
          exportBackup(workspace),
          "application/json",
        );
        return;
      }
      if (!plan || !fresh)
        throw new Error(
          "Apply an up-to-date plan before exporting a schedule. Your task backup is always available.",
        );
      download(
        `ripple-${workspace.settings.date}.${kind === "calendar" ? "ics" : "txt"}`,
        kind === "calendar"
          ? exportPlanCalendar(workspace, plan)
          : exportPlanText(workspace, plan),
        kind === "calendar" ? "text/calendar" : "text/plain",
      );
      setToast(
        kind === "calendar"
          ? "Calendar file downloaded. Import it into your calendar."
          : "Day plan downloaded.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The export could not finish.");
    }
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 1000000) throw new Error("Keep backups under 1 MB.");
      const imported = parseWorkspace(JSON.parse(await file.text()));
      update(imported, "Import backup");
      setApproved(null);
      setApprovedSignature("");
      setToast("Backup restored. Build a new plan from these tasks.");
      setModal(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This backup could not be read.",
      );
    }
    if (importRef.current) importRef.current.value = "";
  }
  const empty =
    workspace.tasks.length === 0 && workspace.commitments.length === 0;
  const openRecovery = () => {
    setRecoveryFrom(
      selectedToday
        ? Math.min(
            workspace.settings.end,
            Math.max(
              workspace.settings.planFrom,
              Math.ceil(localMinute(workspace.settings.timezone) / 5) * 5,
            ),
          )
        : workspace.settings.planFrom,
    );
    setRecoveryTask(openEligible[0]?.id || "");
    setEarlyEnd(
      Math.max(workspace.settings.start + 15, workspace.settings.end - 60),
    );
    setError("");
    setModal("recover");
  };

  return (
    <div className="d-app">
      <aside className="d-sidebar">
        <a className="d-brand" href="./">
          <span className="d-brand-mark">
            <Waves size={24} />
          </span>
          ripple<span className="d-beta">BETA</span>
        </a>
        <div className="d-space-label">YOUR PERSONAL WORKSPACE</div>
        <nav aria-label="Workspace">
          <button
            className={`d-nav ${view === "today" && !project ? "active" : ""}`}
            onClick={() => {
              setView("today");
              setProject("");
            }}
          >
            <LayoutDashboard size={18} />
            My day<span>{openEligible.length}</span>
          </button>
          <button
            className={`d-nav ${view === "tasks" && !project ? "active" : ""}`}
            onClick={() => {
              setView("tasks");
              setProject("");
            }}
          >
            <ListTodo size={18} />
            All tasks<span>{todo.length}</span>
          </button>
          <button
            className={`d-nav ${view === "done" ? "active" : ""}`}
            onClick={() => {
              setView("done");
              setProject("");
            }}
          >
            <CheckCheck size={18} />
            Completed
          </button>
        </nav>
        <div className="d-side-section">
          <span>PROJECTS</span>
          <button
            className="d-icon"
            aria-label="Add a task with a project"
            onClick={() => setEditor("new")}
          >
            <Plus size={15} />
          </button>
        </div>
        {projects.length ? (
          projects.map((p, i) => (
            <button
              className={`d-nav d-project-nav ${project === p ? "active" : ""}`}
              onClick={() => {
                setProject(p);
                setView("tasks");
              }}
              key={p}
            >
              <i
                style={{
                  background: ["#8c86bc", "#8aa58e", "#c59d76", "#92aabd"][
                    i % 4
                  ],
                }}
              />
              {p}
              <span>{todo.filter((t) => t.project === p).length}</span>
            </button>
          ))
        ) : (
          <p className="d-side-hint">
            Organize tasks into projects when you need a little more structure.
          </p>
        )}
        <div className="d-side-bottom">
          <div className="d-local-note">
            <span className="d-live-dot" />
            {storageError ? "Backup recommended" : "Saved on this device"}
            <p>
              Your work stays in your browser.
              <br />
              No account needed.
            </p>
          </div>
          <button className="d-nav" onClick={() => setModal("history")}>
            <History size={17} />
            History & undo
          </button>
          <button className="d-nav" onClick={() => setModal("settings")}>
            <Settings2 size={17} />
            Preferences
          </button>
          <button className="d-nav" onClick={() => setModal("help")}>
            <CircleHelp size={17} />A little guidance
          </button>
        </div>
      </aside>
      <main className="d-main">
        <header className="d-topbar">
          <div className="d-breadcrumb">
            Workspace <span>/</span>{" "}
            {project ||
              (view === "today"
                ? "My day"
                : view === "done"
                  ? "Completed"
                  : "All tasks")}
          </div>
          <div className="d-top-actions">
            <label className="d-search">
              <Search size={15} />
              <input
                ref={searchRef}
                aria-label="Search tasks"
                placeholder="Find a task…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (e.target.value) setView("tasks");
                }}
              />
              <kbd>/</kbd>
            </label>
            <button
              className="d-icon"
              aria-label="Export and backup"
              onClick={() => setModal("export")}
            >
              <ArrowDownToLine size={19} />
            </button>
            <button
              className="d-avatar"
              aria-label="Open preferences"
              onClick={() => setModal("settings")}
            >
              Y
            </button>
          </div>
        </header>
        <div className="d-content">
          <div className="d-mobile-nav">
            <button
              onClick={() => {
                setView("today");
                setProject("");
              }}
              className={view === "today" ? "active" : ""}
            >
              My day
            </button>
            <button
              onClick={() => {
                setView("tasks");
                setProject("");
              }}
              className={view === "tasks" ? "active" : ""}
            >
              Tasks
            </button>
            <button
              onClick={() => setView("done")}
              className={view === "done" ? "active" : ""}
            >
              Done
            </button>
            <button aria-label="History" onClick={() => setModal("history")}>
              <History size={16} />
            </button>
          </div>
          {storageError && (
            <div className="d-alert" role="alert">
              {storageError}
              <button
                onClick={() =>
                  unreadableBackup
                    ? download(
                        "ripple-original-data.json",
                        unreadableBackup,
                        "application/json",
                      )
                    : exportFile("backup")
                }
              >
                {unreadableBackup
                  ? "Download original data"
                  : "Download backup"}
              </button>
            </div>
          )}
          {error &&
            !modal &&
            !preview &&
            !editor &&
            !meeting &&
            !assistTask && (
              <div className="d-error" role="alert">
                {error}
                <button
                  className="d-icon"
                  aria-label="Dismiss error"
                  onClick={() => setError("")}
                >
                  <X size={16} />
                </button>
              </div>
            )}
          <section className="d-page-heading">
            <div>
              <div className="d-eyebrow">
                <span className="d-sun">✳</span> A LITTLE CLARITY GOES A LONG
                WAY
              </div>
              <h1>
                {project ||
                  (view === "done"
                    ? "Look how far you’ve come."
                    : view === "tasks"
                      ? "A place for everything."
                      : empty
                        ? "Make today workable."
                        : "Your day, with room to breathe.")}
              </h1>
              <p>
                {view === "done"
                  ? "Small wins add up. Every task here was marked complete by you."
                  : view === "tasks"
                    ? "Capture it here. Make room for it when you’re ready."
                    : "A realistic plan. A clear next step. Space for life to happen."}
              </p>
            </div>
            <button
              className="d-button d-secondary"
              onClick={() => {
                setCapture("");
                setDraft([]);
                setAssistResult(null);
                setModal("capture");
              }}
            >
              <Sparkles size={16} />
              Quick capture
            </button>
          </section>
          {empty && (
            <section className="d-welcome">
              <div className="d-welcome-text">
                <span className="d-pill">START SMALL</span>
                <h2>What’s on your mind?</h2>
                <p>
                  Add a few tasks and how long they might take. Ripple finds a
                  place for them around your fixed commitments.
                </p>
                <div className="d-welcome-steps">
                  <span>
                    <b>1</b>Add your tasks
                  </span>
                  <span>
                    <b>2</b>Set your hours
                  </span>
                  <span>
                    <b>3</b>Review your day
                  </span>
                </div>
              </div>
              <div className="d-welcome-actions">
                <button
                  className="d-button d-primary"
                  onClick={() => setEditor("new")}
                >
                  <Plus size={17} />
                  Add my first task
                </button>
                <button
                  className="d-text-button"
                  onClick={() => {
                    update(
                      sampleWorkspace(workspace.settings.date),
                      "Load sample day",
                    );
                    setToast(
                      "Sample day loaded. Edit or remove anything to make it yours.",
                    );
                  }}
                >
                  Try a sample day <ArrowRight size={15} />
                </button>
                <span>No setup marathon. No account.</span>
              </div>
            </section>
          )}
          <section className="d-daybar">
            <div className="d-day-picker">
              <button
                className="d-icon"
                aria-label="Previous day"
                onClick={() => setDate(addDays(workspace.settings.date, -1))}
              >
                <ChevronLeft size={17} />
              </button>
              <label>
                <CalendarDays size={17} />
                <input
                  aria-label="Planning date"
                  type="date"
                  value={workspace.settings.date}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                />
              </label>
              <button
                className="d-icon"
                aria-label="Next day"
                onClick={() => setDate(addDays(workspace.settings.date, 1))}
              >
                <ChevronRight size={17} />
              </button>
              {!selectedToday && (
                <button
                  className="d-text-button"
                  onClick={() =>
                    setDate(localDate(new Date(), workspace.settings.timezone))
                  }
                >
                  Today
                </button>
              )}
            </div>
            <div className="d-daybar-right">
              <button className="d-hours" onClick={() => setModal("settings")}>
                <Clock3 size={15} />
                {fmt(workspace.settings.planFrom)}–{fmt(workspace.settings.end)}
                <Settings2 size={13} />
              </button>
              <span className="d-divider" />
              <button
                className="d-text-button"
                onClick={() => setMeeting("new")}
              >
                <Plus size={15} />
                Fixed time
              </button>
            </div>
          </section>
          <button
            className="d-button d-primary d-mobile-plan"
            onClick={() =>
              makePreview(workspace, plan ? "Refresh plan" : "Plan my day")
            }
          >
            <WandSparkles size={16} />
            Review this day
            <ArrowRight size={16} />
          </button>
          <div className="d-workspace-grid">
            <section className="d-task-column">
              <div className="d-section-heading">
                <h2>
                  {view === "done"
                    ? "Completed tasks"
                    : project || "Your tasks"}{" "}
                  <span>{filtered.length}</span>
                </h2>
                <button
                  className="d-icon"
                  aria-label="Add task with details"
                  onClick={() => setEditor("new")}
                >
                  <Plus size={19} />
                </button>
              </div>
              {view !== "done" && (
                <form className="d-quick-add" onSubmit={addQuick}>
                  <Plus size={18} />
                  <input
                    ref={quickRef}
                    aria-label="New task"
                    value={quick}
                    maxLength={200}
                    onChange={(e) => setQuick(e.target.value)}
                    placeholder="Something you need to do…"
                    required
                  />
                  <select
                    aria-label="Task estimate"
                    value={quickMinutes}
                    onChange={(e) => setQuickMinutes(Number(e.target.value))}
                  >
                    {[15, 30, 45, 60, 90, 120].map((m) => (
                      <option key={m} value={m}>
                        {duration(m)}
                      </option>
                    ))}
                  </select>
                  <button
                    className="d-icon"
                    type="submit"
                    aria-label="Add quick task"
                  >
                    <ArrowRight size={18} />
                  </button>
                </form>
              )}
              <div className="d-task-list">
                {filtered.length ? (
                  filtered.map((task) => (
                    <article
                      className={`d-task ${task.status === "done" ? "d-task-done" : ""}`}
                      key={task.id}
                    >
                      <button
                        className={`d-check ${task.status === "done" ? "checked" : ""}`}
                        aria-label={`${task.status === "done" ? "Reopen" : "Complete"} ${task.title}`}
                        onClick={() => toggleDone(task)}
                      >
                        {task.status === "done" && <Check size={13} />}
                      </button>
                      <button
                        className="d-task-info"
                        onClick={() => setEditor(task)}
                      >
                        <span className="d-task-title">{task.title}</span>
                        <span className="d-task-meta">
                          {task.project && (
                            <span className="d-project-chip">
                              {task.project}
                            </span>
                          )}
                          {task.priority === "high" && (
                            <span className="d-priority">High priority</span>
                          )}
                          {task.dueDate && (
                            <span
                              className={
                                task.dueDate < workspace.settings.date &&
                                task.status !== "done"
                                  ? "d-overdue"
                                  : ""
                              }
                            >
                              Due{" "}
                              {task.dueDate === workspace.settings.date
                                ? "today"
                                : dateLabel(task.dueDate, {
                                    month: "short",
                                    day: "numeric",
                                  })}
                            </span>
                          )}
                          {task.earliestDate &&
                            task.earliestDate > workspace.settings.date && (
                              <span>
                                From{" "}
                                {dateLabel(task.earliestDate, {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            )}
                          {task.dependsOn.length > 0 && (
                            <span>
                              {task.dependsOn.length} prerequisite
                              {task.dependsOn.length > 1 ? "s" : ""}
                            </span>
                          )}
                          {task.recurrence !== "none" && (
                            <span>↻ {task.recurrence}</span>
                          )}
                        </span>
                      </button>
                      <span className="d-task-estimate">
                        {duration(task.minutes)}
                      </span>
                      {task.status === "todo" && (
                        <button
                          className="d-icon d-focus-trigger"
                          aria-label={`Focus on ${task.title}`}
                          onClick={() => startFocus(task)}
                        >
                          <Play size={14} />
                        </button>
                      )}
                      <button
                        className="d-icon d-task-menu"
                        aria-label={`Edit ${task.title}`}
                        onClick={() => setEditor(task)}
                      >
                        <MoreHorizontal size={17} />
                      </button>
                    </article>
                  ))
                ) : (
                  <div className="d-empty-tasks">
                    <ListTodo size={26} />
                    <p>
                      {query
                        ? "No matching tasks."
                        : view === "done"
                          ? "Your finished work will collect here."
                          : "Your mind doesn’t have to hold it all."}
                    </p>
                    <span>
                      {view === "done"
                        ? "Check off a task when you finish it."
                        : "Add a task above, or paste a whole list with Quick capture."}
                    </span>
                  </div>
                )}
              </div>
              {view !== "done" && (
                <div className="d-task-footer">
                  <span>
                    {duration(filtered.reduce((n, t) => n + t.minutes, 0))}{" "}
                    estimated work
                  </span>
                  <button
                    className="d-text-button"
                    onClick={() => setEditor("new")}
                  >
                    Add details <ArrowUpRight size={13} />
                  </button>
                </div>
              )}
              <div className="d-section-heading d-commitments-heading">
                <h2>
                  Fixed commitments <span>{dayMeetings.length}</span>
                </h2>
                <button
                  className="d-icon"
                  aria-label="Add fixed commitment"
                  onClick={() => setMeeting("new")}
                >
                  <Plus size={17} />
                </button>
              </div>
              {dayMeetings.length ? (
                dayMeetings.map((c) => (
                  <button
                    className="d-commitment"
                    key={c.id}
                    onClick={() => setMeeting(c)}
                  >
                    <span className="d-commitment-icon">
                      <LockKeyhole size={15} />
                    </span>
                    <span>
                      <b>{c.title}</b>
                      <small>
                        {fmt(c.start)}–{fmt(c.end)}
                      </small>
                    </span>
                    <MoreHorizontal size={17} />
                  </button>
                ))
              ) : (
                <button
                  className="d-add-fixed"
                  onClick={() => setMeeting("new")}
                >
                  <CalendarDays size={19} />
                  <span>
                    Add a meeting, class, or appointment
                    <small>Ripple will plan around it.</small>
                  </span>
                  <Plus size={17} />
                </button>
              )}
              <div className="d-tip">
                <Coffee size={19} />
                <p>
                  <strong>Estimates are a starting point.</strong> Leave room
                  for breaks. If something takes longer, your plan can change
                  with you.
                </p>
              </div>
            </section>
            <section className="d-plan-column">
              <div className="d-plan-top">
                <div>
                  <span className="d-eyebrow">THE SHAPE OF YOUR DAY</span>
                  <h2>
                    {plan ? "Your workable plan" : "Let’s make some room."}
                  </h2>
                </div>
                {plan && (
                  <span className={`d-status ${fresh ? "" : "stale"}`}>
                    <i />
                    {fresh ? "Up to date" : "Needs refresh"}
                  </span>
                )}
              </div>
              <div className="d-plan-summary">
                <div>
                  <strong>
                    {plan
                      ? duration(plan.scheduledMinutes)
                      : duration(
                          openEligible.reduce((n, t) => n + t.minutes, 0),
                        )}
                  </strong>
                  <span>{plan ? "planned work" : "on your list"}</span>
                </div>
                <div>
                  <strong>
                    {plan
                      ? duration(plan.availableMinutes)
                      : duration(
                          Math.max(
                            0,
                            workspace.settings.end -
                              workspace.settings.planFrom,
                          ),
                        )}
                  </strong>
                  <span>{plan ? "available for work" : "planning window"}</span>
                </div>
                <div>
                  <strong>{doneToday.length}</strong>
                  <span>done today</span>
                </div>
              </div>
              <div className="d-plan-actions">
                <button
                  className="d-button d-primary"
                  onClick={() =>
                    makePreview(
                      workspace,
                      plan ? "Refresh plan" : "Plan my day",
                    )
                  }
                >
                  <WandSparkles size={16} />
                  {plan ? "Refresh plan" : "Plan my day"}
                  <ArrowRight size={16} />
                </button>
                <button className="d-button d-secondary" onClick={openRecovery}>
                  <RotateCcw size={15} />
                  Day changed?
                </button>
              </div>
              {plan && !fresh && (
                <p className="d-stale-note">
                  Your tasks or hours changed. Review a fresh plan before
                  following or exporting it.
                </p>
              )}
              {plan ? (
                <>
                  <div
                    className="d-timeline"
                    tabIndex={0}
                    role="region"
                    aria-label="Day timeline"
                  >
                    {plan.blocks.map((block, index) => (
                      <div
                        className={`d-timeline-row ${block.kind}`}
                        key={`${block.id}-${index}`}
                      >
                        <div className="d-time">
                          <span>{fmt(block.start)}</span>
                          <small>{fmt(block.end)}</small>
                        </div>
                        <div
                          className={`d-block ${block.taskId && taskMap.get(block.taskId)?.status === "done" ? "done" : ""}`}
                        >
                          <div className="d-block-top">
                            <span>
                              {block.kind === "commitment" ? (
                                <LockKeyhole size={12} />
                              ) : block.kind === "break" ? (
                                <Coffee size={13} />
                              ) : (
                                <span className="d-block-dot" />
                              )}
                              {block.kind === "commitment"
                                ? "FIXED"
                                : block.kind === "break"
                                  ? "ROOM TO BREATHE"
                                  : taskMap.get(block.taskId || "")?.project ||
                                    "FOCUS TIME"}
                            </span>
                            <small>{duration(block.end - block.start)}</small>
                          </div>
                          <b>{block.title}</b>
                          {block.parts && block.parts > 1 && (
                            <small>
                              Part {block.part} of {block.parts}
                            </small>
                          )}
                          {block.taskId && taskMap.has(block.taskId) && (
                            <div className="d-block-controls">
                              {taskMap.get(block.taskId)!.status === "done" ? (
                                <span>
                                  <Check size={13} />
                                  Finished
                                </span>
                              ) : (
                                <>
                                  <button
                                    onClick={() =>
                                      startFocus(taskMap.get(block.taskId!)!)
                                    }
                                  >
                                    <Play size={12} />
                                    Focus
                                  </button>
                                  <button
                                    onClick={() =>
                                      toggleDone(taskMap.get(block.taskId!)!)
                                    }
                                  >
                                    <Check size={13} />
                                    Finish task
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {!plan.blocks.length && (
                      <p className="d-empty-plan">
                        No blocks in this plan. Check the work below, or add
                        your first task.
                      </p>
                    )}
                    <div className="d-finish-line">
                      <span>{fmt(workspace.settings.end)}</span>
                      <div />
                      <span>Close the laptop. Keep your evening.</span>
                      <span>✳</span>
                    </div>
                  </div>
                  {plan.overflow.length > 0 && (
                    <div className="d-overflow">
                      <h3>
                        Needs another place <span>{plan.overflow.length}</span>
                      </h3>
                      <p>
                        Still on your list. Nothing was shortened or marked
                        done.
                      </p>
                      {plan.overflow.map((item) => (
                        <div className="d-overflow-task" key={item.taskId}>
                          <div>
                            <strong>
                              {taskMap.get(item.taskId)?.title || "Task"}
                            </strong>
                            <span>
                              {duration(item.remainingMinutes)} remaining ·{" "}
                              {item.reason}
                            </span>
                          </div>
                          <button
                            className="d-text-button"
                            onClick={() => {
                              const t = taskMap.get(item.taskId);
                              if (t) setEditor(t);
                            }}
                          >
                            Adjust
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {plan.warnings?.length > 0 && (
                    <div className="d-warnings">
                      {plan.warnings.map((warning, i) => (
                        <p key={i}>{warning}</p>
                      ))}
                    </div>
                  )}
                  <div className="d-plan-proof">
                    <ShieldCheck size={15} />
                    <span>
                      {fresh
                        ? `${plan.checks.filter((c) => c.passed).length} checks passed · Task hours protected`
                        : "Last approved plan · Refresh to check your changes"}
                    </span>
                    <button
                      className="d-text-button"
                      onClick={() => setModal("export")}
                    >
                      Export <ArrowUpRight size={13} />
                    </button>
                  </div>
                </>
              ) : (
                <div className="d-plan-placeholder">
                  <div className="d-ghost-row">
                    <span>09:00</span>
                    <i />
                  </div>
                  <div className="d-ghost-row">
                    <span>10:00</span>
                    <i />
                  </div>
                  <div className="d-ghost-row">
                    <span>11:00</span>
                    <i />
                  </div>
                  <div className="d-placeholder-copy">
                    <span>
                      <Waves size={25} />
                    </span>
                    <h3>A plan you can actually finish.</h3>
                    <p>
                      Your tasks, fixed commitments, and breaks—all in one
                      realistic day. You review it before anything changes.
                    </p>
                  </div>
                </div>
              )}
            </section>
          </div>
          <footer className="d-footer">
            <span>
              <Waves size={15} />
              Less rearranging. More getting there.
            </span>
            <button
              onClick={() => {
                setConnectionDraft(
                  connection.url
                    ? connection
                    : { url: presetServiceUrl(), token: "" },
                );
                setConnectionStatus("");
                setModal("connect");
              }}
            >
              <Sparkles size={13} />
              {connection.url ? "Assistant connected" : "Optional AI assistant"}
            </button>
          </footer>
        </div>
      </main>
      {toast && (
        <div className="d-toast" role="status">
          <Check size={16} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {focusTask && (
        <div className="d-focus-bar" role="region" aria-label="Focus timer">
          <div>
            <span>ONE THING AT A TIME</span>
            <strong>{focusTask.title}</strong>
          </div>
          <b aria-live="off">
            {String(Math.floor(focusRemaining / 60)).padStart(2, "0")}:
            {String(focusRemaining % 60).padStart(2, "0")}
          </b>
          <button
            className="d-icon"
            aria-label={focusEnds ? "Pause focus timer" : "Start focus timer"}
            onClick={() =>
              focusEnds
                ? setFocusEnds(null)
                : setFocusEnds(Date.now() + focusRemaining * 1000)
            }
          >
            {focusEnds ? <Pause size={19} /> : <Play size={19} />}
          </button>
          <button
            className="d-button d-secondary"
            onClick={() => toggleDone(focusTask)}
          >
            <Check size={15} />
            Finish task
          </button>
          <button
            className="d-icon"
            aria-label="Reset focus timer"
            onClick={() => {
              setFocusRemaining(
                Math.min(workspace.settings.focusMinutes, focusTask.minutes) *
                  60,
              );
              setFocusEnds(null);
            }}
          >
            <RotateCcw size={16} />
          </button>
          <button
            className="d-icon"
            aria-label="Close focus timer"
            onClick={() => {
              setFocusId(null);
              setFocusEnds(null);
            }}
          >
            <X size={18} />
          </button>
          {connection.url && (
            <button
              className="d-focus-help"
              disabled={busy}
              onClick={() => {
                setAssistTask(focusTask);
                setAssistResult(null);
              }}
            >
              Help me start <Sparkles size={13} />
            </button>
          )}
        </div>
      )}
      {editor && (
        <TaskEditor
          task={editor === "new" ? undefined : editor}
          tasks={workspace.tasks}
          date={workspace.settings.date}
          onSave={saveTask}
          onClose={() => {
            setEditor(null);
            setError("");
          }}
          onDelete={
            editor === "new"
              ? undefined
              : () => {
                  try {
                    update(
                      {
                        ...workspace,
                        tasks: workspace.tasks
                          .filter((t) => t.id !== editor.id)
                          .map((t) => ({
                            ...t,
                            dependsOn: t.dependsOn.filter(
                              (id) => id !== editor.id,
                            ),
                          })),
                      },
                      "Delete task",
                    );
                    setEditor(null);
                    setToast("Task removed. History can undo it.");
                  } catch {}
                }
          }
        />
      )}
      {meeting && (
        <CommitmentEditor
          commitment={meeting === "new" ? undefined : meeting}
          date={workspace.settings.date}
          onSave={(c) => {
            try {
              update(
                {
                  ...workspace,
                  commitments: workspace.commitments.some((x) => x.id === c.id)
                    ? workspace.commitments.map((x) => (x.id === c.id ? c : x))
                    : [...workspace.commitments, c],
                },
                "Save fixed commitment",
              );
              setMeeting(null);
            } catch (e) {
              throw e;
            }
          }}
          onClose={() => setMeeting(null)}
          onDelete={
            meeting === "new"
              ? undefined
              : () => {
                  update(
                    {
                      ...workspace,
                      commitments: workspace.commitments.filter(
                        (c) => c.id !== meeting.id,
                      ),
                    },
                    "Delete fixed commitment",
                  );
                  setMeeting(null);
                }
          }
        />
      )}
      {modal === "settings" && (
        <Preferences
          settings={workspace.settings}
          onSave={(settings) => {
            try {
              update({ ...workspace, settings }, "Change preferences");
              setModal(null);
              setToast("Preferences updated. Review a fresh plan when ready.");
            } catch (e) {
              throw e;
            }
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "capture" && (
        <DailyModal
          title="A little less on your mind."
          onClose={() => {
            assistController.current?.abort();
            setBusy(false);
            setModal(null);
            setError("");
          }}
        >
          <p className="d-modal-intro">
            Paste tasks, one per line. Add a time like “Write proposal 45m”.
            Missing estimates start at 30 minutes for you to review.
          </p>
          {!draft.length ? (
            <>
              <textarea
                className="d-capture-input"
                aria-label="Task list to capture"
                rows={7}
                value={capture}
                onChange={(e) => setCapture(e.target.value)}
                maxLength={6000}
                placeholder={
                  "Draft the proposal 45m #Client\nStudy chapter 3 1h #Learning\nBook the dentist 15m"
                }
              />
              <div className="d-modal-actions">
                <button
                  className="d-button d-primary"
                  onClick={prepareCapture}
                  disabled={busy}
                >
                  Review tasks <ArrowRight size={16} />
                </button>
                {connection.url && (
                  <button
                    className="d-button d-secondary"
                    disabled={busy || !capture.trim()}
                    onClick={() => askAssistant("capture")}
                  >
                    <Sparkles size={15} />
                    {busy ? "Reading…" : "Let AI organize it"}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="d-draft-label">
                {draft.length} tasks to review · Estimates are editable
              </p>
              {draft.map((task, index) => (
                <div className="d-capture-draft" key={task.id}>
                  <div className="d-draft-row">
                    <input
                      aria-label={`Captured task ${index + 1}`}
                      value={task.title}
                      maxLength={200}
                      onChange={(e) =>
                        setDraft((d) =>
                          d.map((t) =>
                            t.id === task.id
                              ? { ...t, title: e.target.value }
                              : t,
                          ),
                        )
                      }
                    />
                    <label>
                      <input
                        type="number"
                        aria-label={`Minutes for captured task ${index + 1}`}
                        min={1}
                        max={720}
                        value={task.minutes}
                        onChange={(e) =>
                          setDraft((d) =>
                            d.map((t) =>
                              t.id === task.id
                                ? { ...t, minutes: Number(e.target.value) }
                                : t,
                            ),
                          )
                        }
                      />
                      min
                    </label>
                    <button
                      className="d-icon"
                      aria-label={`Remove captured task ${index + 1}`}
                      onClick={() =>
                        setDraft((d) =>
                          d
                            .filter((t) => t.id !== task.id)
                            .map((t) => ({
                              ...t,
                              dependsOn: t.dependsOn.filter(
                                (id) => id !== task.id,
                              ),
                            })),
                        )
                      }
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="d-draft-metadata">
                    <span>
                      {task.priority.charAt(0).toUpperCase() +
                        task.priority.slice(1)}{" "}
                      priority
                    </span>
                    {task.project && <span>Project: {task.project}</span>}
                    <span>
                      {task.dueDate
                        ? `Due ${task.dueDate}${task.dueTime !== undefined ? " at " + fmt(task.dueTime) : ""}`
                        : "No deadline"}
                    </span>
                    {task.recurrence !== "none" && (
                      <span>Repeats {task.recurrence}</span>
                    )}
                    {task.dependsOn.length > 0 && (
                      <span>
                        After:{" "}
                        {task.dependsOn
                          .map(
                            (id) =>
                              draft.find((t) => t.id === id)?.title ||
                              "Missing task",
                          )
                          .join(", ")}
                      </span>
                    )}
                    <span>
                      {task.splittable
                        ? "Shorter blocks allowed"
                        : "One uninterrupted block"}
                    </span>
                  </div>
                  {task.notes && (
                    <details className="d-draft-notes">
                      <summary>Capture notes and estimates</summary>
                      <p>{task.notes}</p>
                    </details>
                  )}
                </div>
              ))}
              {assistResult && (
                <p className="d-assist-provenance">
                  {assistResult.mode === "live"
                    ? "AI draft"
                    : "Rule-based draft"}{" "}
                  · {assistResult.summary}
                </p>
              )}
              <div className="d-modal-actions">
                <button
                  className="d-button d-secondary"
                  onClick={() => setDraft([])}
                >
                  Back
                </button>
                <button className="d-button d-primary" onClick={addDraft}>
                  Add {draft.length} {draft.length === 1 ? "task" : "tasks"}{" "}
                  <Plus size={15} />
                </button>
              </div>
            </>
          )}
          {error && (
            <p className="d-error" role="alert">
              {error}
            </p>
          )}
        </DailyModal>
      )}
      {modal === "recover" && (
        <DailyModal
          title="Life happened. Let’s adjust."
          onClose={() => {
            setModal(null);
            setError("");
          }}
        >
          <p className="d-modal-intro">
            Keep the work you’ve finished. Review what changes before applying a
            new plan.
          </p>
          <div className="d-recovery-options">
            {(
              [
                {
                  id: "lost",
                  title: "I lost some time",
                  description: "Start the remaining work later.",
                  icon: Clock3,
                },
                {
                  id: "longer",
                  title: "This needs longer",
                  description: "Increase the remaining estimate.",
                  icon: Timer,
                },
                {
                  id: "urgent",
                  title: "Something urgent came up",
                  description: "Make room for a new priority.",
                  icon: Sparkles,
                },
                {
                  id: "early",
                  title: "I need to finish earlier",
                  description: "Protect your new stop time.",
                  icon: Coffee,
                },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                className={recovery === item.id ? "selected" : ""}
                onClick={() => setRecovery(item.id)}
              >
                <item.icon size={19} />
                <span>
                  <b>{item.title}</b>
                  <small>{item.description}</small>
                </span>
                {recovery === item.id && <Check size={15} />}
              </button>
            ))}
          </div>
          <div className="d-form-grid">
            {recovery === "lost" && (
              <label className="d-field">
                Unavailable from
                <input
                  type="time"
                  value={fmt(recoveryFrom)}
                  onChange={(e) => setRecoveryFrom(mins(e.target.value))}
                />
              </label>
            )}
            {recovery === "longer" && (
              <label className="d-field">
                Task that needs more time
                <select
                  value={recoveryTask}
                  onChange={(e) => setRecoveryTask(e.target.value)}
                >
                  <option value="">Choose a task</option>
                  {todo.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {recovery === "urgent" && (
              <label className="d-field">
                Urgent task
                <input
                  value={urgentTitle}
                  maxLength={200}
                  onChange={(e) => setUrgentTitle(e.target.value)}
                  placeholder="What needs to get done?"
                />
              </label>
            )}
            {recovery === "early" ? (
              <label className="d-field">
                New finish time
                <input
                  type="time"
                  value={fmt(earlyEnd)}
                  onChange={(e) => setEarlyEnd(mins(e.target.value))}
                />
              </label>
            ) : (
              <label className="d-field">
                {recovery === "longer" ? "Extra minutes" : "Minutes"}
                <input
                  type="number"
                  min={1}
                  max={480}
                  value={recoveryMinutes}
                  onChange={(e) => setRecoveryMinutes(Number(e.target.value))}
                />
              </label>
            )}
          </div>
          <p className="d-small-note">
            Open tasks stay unfinished even if their old time block has passed.
            Mark completed work done before replanning.
          </p>
          {error && (
            <p className="d-error" role="alert">
              {error}
            </p>
          )}
          <div className="d-modal-actions">
            <button
              className="d-button d-primary"
              disabled={
                !Number.isInteger(recoveryMinutes) ||
                recoveryMinutes < 1 ||
                recoveryMinutes > 480
              }
              onClick={recover}
            >
              Review revised plan <ArrowRight size={16} />
            </button>
          </div>
        </DailyModal>
      )}
      {preview && (
        <DailyModal
          title={plan ? "A small reset. A workable day." : "Here’s what fits."}
          wide
          onClose={() => setPreview(null)}
        >
          <p className="d-modal-intro">
            {dateLabel(preview.workspace.settings.date)} ·{" "}
            {fmt(preview.workspace.settings.planFrom)}–
            {fmt(preview.workspace.settings.end)} · {preview.plan.summary}
          </p>
          <div className="d-preview-stats">
            <span>
              <b>{duration(preview.plan.scheduledMinutes)}</b>planned work
            </span>
            <span>
              <b>
                {
                  preview.plan.overflow.filter((t) => t.code !== "future")
                    .length
                }
              </b>
              need another place
            </span>
            <span>
              <b>{fmt(preview.workspace.settings.end)}</b>protected finish
            </span>
          </div>
          {plan ? (
            <div className="d-diff">
              <h3>What changes</h3>
              {getDiff(plan, preview.plan, preview.workspace).length ? (
                getDiff(plan, preview.plan, preview.workspace).map((item) => (
                  <div key={item.task.id}>
                    <b>{item.task.title}</b>
                    <span>
                      {item.before} <ArrowRight size={13} />{" "}
                      <strong>{item.after}</strong>
                    </span>
                  </div>
                ))
              ) : (
                <p>The existing time blocks stay the same.</p>
              )}
            </div>
          ) : (
            <div className="d-preview-blocks">
              {preview.plan.blocks.map((b, i) => (
                <div key={`${b.id}-${i}`}>
                  <span>
                    {fmt(b.start)}–{fmt(b.end)}
                  </span>
                  <strong>{b.title}</strong>
                  {b.kind === "commitment" && <LockKeyhole size={12} />}
                </div>
              ))}
            </div>
          )}
          {preview.plan.overflow.length > 0 && (
            <div className="d-preview-overflow">
              <h3>Still on your list</h3>
              {preview.plan.overflow.map((item) => (
                <p key={item.taskId}>
                  <strong>
                    {
                      preview.workspace.tasks.find((t) => t.id === item.taskId)
                        ?.title
                    }
                  </strong>
                  <span>
                    {duration(item.remainingMinutes)} · {item.reason}
                  </span>
                </p>
              ))}
            </div>
          )}
          {preview.plan.warnings.map((warning, i) => (
            <p className="d-small-note" key={i}>
              {warning}
            </p>
          ))}
          <details className="d-checks">
            <summary>
              <ShieldCheck size={16} />
              {preview.plan.checks.length} planning checks passed
            </summary>
            {preview.plan.checks.map((check) => (
              <p key={check.id}>
                <Check size={13} />
                <span>
                  <b>{check.label}</b>
                  {check.detail}
                </span>
              </p>
            ))}
          </details>
          <div className="d-modal-actions">
            <button
              className="d-button d-secondary"
              onClick={() => setPreview(null)}
            >
              Keep my current plan
            </button>
            <button className="d-button d-primary" onClick={applyPreview}>
              Use this plan <Check size={16} />
            </button>
          </div>
          <p className="d-small-note">
            This updates Ripple only. No calendar changes or messages are sent.
          </p>
        </DailyModal>
      )}
      {modal === "history" && (
        <DailyModal
          title="A little room to undo."
          onClose={() => setModal(null)}
        >
          <p className="d-modal-intro">
            Your last 15 changes on this device. Restoring also restores task
            details and completion states.
          </p>
          {history.length ? (
            history.map((entry, index) => (
              <div className="d-history-row" key={`${entry.at}-${index}`}>
                <div>
                  <strong>{entry.label}</strong>
                  <span>
                    {new Date(entry.at).toLocaleString()} ·{" "}
                    {entry.workspace.tasks.length} tasks
                  </span>
                </div>
                <button
                  className="d-button d-secondary"
                  onClick={() => {
                    const current: Snapshot = {
                      workspace,
                      plan: approved,
                      signature: approvedSignature,
                      label: "Before restore",
                      at: new Date().toISOString(),
                    };
                    setWorkspace(parseWorkspace(entry.workspace));
                    setApproved(entry.plan);
                    setApprovedSignature(entry.signature);
                    setHistory(
                      [current, ...history.filter((_, i) => i !== index)].slice(
                        0,
                        15,
                      ),
                    );
                    setModal(null);
                    setToast("Previous version restored.");
                  }}
                >
                  Restore
                </button>
              </div>
            ))
          ) : (
            <div className="d-empty-tasks">
              <History size={24} />
              <p>Your edits and approved plans will appear here.</p>
            </div>
          )}
        </DailyModal>
      )}
      {modal === "connect" && (
        <DailyModal
          title="A hand with the thinking."
          onClose={() => {
            connectionController.current?.abort();
            setBusy(false);
            setModal(null);
          }}
        >
          <p className="d-modal-intro">
            Your planner works without AI. Use a Ripple service to turn messy
            notes into tasks, break down a difficult task, or find useful sources.
            Enter the service address and access code shared with you.
          </p>
          <label className="d-field">
            Ripple service URL
            <input
              type="url"
              placeholder="https://your-service.example"
              value={connectionDraft.url}
              disabled={busy}
              onChange={(e) =>
                setConnectionDraft({ ...connectionDraft, url: e.target.value })
              }
            />
          </label>
          <label className="d-field">
            Access code
            <input
              type="password"
              autoComplete="off"
              value={connectionDraft.token}
              disabled={busy}
              onChange={(e) =>
                setConnectionDraft({
                  ...connectionDraft,
                  token: e.target.value,
                })
              }
            />
          </label>
          <p className="d-small-note">
            Your access code stays in this tab and clears on reload. Connecting
            checks access only; task text is sent when you request assistance.
          </p>
          {connectionStatus && (
            <p className="d-connection-status" role="status">
              {connectionStatus}
            </p>
          )}
          <div className="d-modal-actions">
            {connection.url && (
              <button
                className="d-button d-secondary"
                onClick={() => {
                  connectionController.current?.abort();
                  setBusy(false);
                  setConnection({ url: "", token: "" });
                  setConnectionDraft({ url: presetServiceUrl(), token: "" });
                  setConnectionStatus("Disconnected.");
                }}
              >
                Disconnect
              </button>
            )}
            <button
              className="d-button d-primary"
              disabled={busy || !connectionDraft.url.trim()}
              onClick={testConnection}
            >
              {busy ? "Checking…" : "Connect service"}
            </button>
          </div>
          <a
            className="d-doc-link"
            href="https://github.com/aaravsinhaofficial/ripple/blob/main/docs/deployment.md"
            target="_blank"
            rel="noreferrer"
          >
            Setup instructions <ArrowUpRight size={14} />
          </a>
        </DailyModal>
      )}
      {assistTask && (
        <DailyModal
          title="Find a way into the work."
          onClose={() => {
            assistController.current?.abort();
            setBusy(false);
            setAssistTask(null);
            setAssistResult(null);
            setError("");
          }}
        >
          <p className="d-modal-intro">{assistTask.title}</p>
          <div className="d-modal-actions">
            <button
              className="d-button d-primary"
              disabled={busy}
              onClick={() => askAssistant("breakdown", assistTask)}
            >
              <Sparkles size={15} />
              {busy ? "Working…" : "Break it into steps"}
            </button>
            <button
              className="d-button d-secondary"
              disabled={busy}
              onClick={() => askAssistant("research", assistTask)}
            >
              <Search size={15} />
              Find useful sources
            </button>
          </div>
          {assistResult && (
            <>
              <p className="d-assist-provenance">
                {assistResult.mode === "live"
                  ? "AI-assisted draft"
                  : "Rule-based draft"}{" "}
                · {assistResult.summary}
              </p>
              <ol className="d-assist-steps">
                {assistResult.steps.map((step, i) => (
                  <li key={i}>
                    <strong>{step.title}</strong>
                    <p>{step.detail}</p>
                    {step.sourceUrls.map((url) => (
                      <a href={url} key={url} target="_blank" rel="noreferrer">
                        {assistResult.sources.find((s) => s.url === url)
                          ?.title || "Source"}{" "}
                        <ArrowUpRight size={11} />
                      </a>
                    ))}
                  </li>
                ))}
              </ol>
              {assistResult.sources.length > 0 && (
                <div className="d-sources">
                  <h3>Sources to review</h3>
                  {assistResult.sources.map((s) => (
                    <a
                      href={s.url}
                      key={s.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <b>
                        {s.title}
                        <ArrowUpRight size={13} />
                      </b>
                      <span>{s.snippet}</span>
                    </a>
                  ))}
                </div>
              )}
              <button
                className="d-button d-secondary"
                onClick={() => {
                  const notes = [
                    assistTask.notes,
                    ...assistResult.steps.map(
                      (s, i) =>
                        `${i + 1}. ${s.title}: ${s.detail}${s.sourceUrls.length ? "\n" + s.sourceUrls.join("\n") : ""}`,
                    ),
                  ]
                    .filter(Boolean)
                    .join("\n\n");
                  if (notes.length > 2000) {
                    setError(
                      "These steps are longer than the task note limit. Download them instead.",
                    );
                    return;
                  }
                  saveTask({ ...assistTask, notes });
                  setAssistTask({ ...assistTask, notes });
                  setToast("Steps saved in the task notes.");
                }}
              >
                Save steps to task notes
              </button>
              <button
                className="d-text-button"
                onClick={() =>
                  download(
                    "ripple-task-brief.txt",
                    [
                      assistTask.title,
                      assistResult.summary,
                      ...assistResult.steps.map(
                        (s, i) =>
                          `${i + 1}. ${s.title}\n${s.detail}\n${s.sourceUrls.join("\n")}`,
                      ),
                    ].join("\n\n"),
                  )
                }
              >
                Download brief
              </button>
            </>
          )}
          {error && (
            <p className="d-error" role="alert">
              {error}
            </p>
          )}
        </DailyModal>
      )}
      {modal === "export" && (
        <DailyModal
          title="Take your work with you."
          onClose={() => setModal(null)}
        >
          <p className="d-modal-intro">
            Your data lives in this browser. Keep a backup to move devices or
            restore it later.
          </p>
          <div className="d-export-list">
            <button onClick={() => exportFile("backup")}>
              <Download size={20} />
              <span>
                <strong>Download workspace backup</strong>
                <small>
                  All tasks, repeats, commitments, and preferences · JSON
                </small>
              </span>
              <ArrowRight size={17} />
            </button>
            <button onClick={() => importRef.current?.click()}>
              <Upload size={20} />
              <span>
                <strong>Restore a backup</strong>
                <small>Replaces the workspace; History can undo it</small>
              </span>
              <ArrowRight size={17} />
            </button>
            <button
              disabled={!plan || !fresh}
              onClick={() => exportFile("text")}
            >
              <FileText size={20} />
              <span>
                <strong>Download day plan</strong>
                <small>Schedule, unfinished work, and context · TXT</small>
              </span>
              <ArrowRight size={17} />
            </button>
            <button
              disabled={!plan || !fresh}
              onClick={() => exportFile("calendar")}
            >
              <CalendarDays size={20} />
              <span>
                <strong>Add to your calendar</strong>
                <small>
                  Download an ICS file to import · No automatic sync
                </small>
              </span>
              <ArrowRight size={17} />
            </button>
          </div>
          {!fresh && (
            <p className="d-small-note">
              Review and apply a current plan to enable schedule exports.
            </p>
          )}
          {error && (
            <p className="d-error" role="alert">
              {error}
            </p>
          )}
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => importFile(e.target.files?.[0])}
          />
        </DailyModal>
      )}
      {modal === "help" && (
        <DailyModal
          title="A calmer way to plan."
          onClose={() => setModal(null)}
        >
          <div className="d-help-steps">
            <div>
              <b>01</b>
              <p>
                <strong>Get it out of your head.</strong>Add a task and an
                estimate, or paste a list into Quick capture. Use task details
                for deadlines, projects, repeats, and prerequisites.
              </p>
            </div>
            <div>
              <b>02</b>
              <p>
                <strong>Give your day some edges.</strong>Set your available
                hours and add fixed meetings. “Plan my day” shows a draft with
                breaks and any work that doesn’t fit.
              </p>
            </div>
            <div>
              <b>03</b>
              <p>
                <strong>Do one thing. Adjust when needed.</strong>Use Focus for
                a timer. Mark work done yourself. “Day changed?” helps you
                recover lost time without hiding unfinished tasks.
              </p>
            </div>
          </div>
          <p className="d-small-note">
            Tasks carry forward until you finish or delete them. Future repeats
            wait for their date. Completing a repeating task creates its next
            occurrence. A plan is a suggestion, and estimates are yours to
            adjust.
          </p>
          <div className="d-shortcuts">
            <span>
              <kbd>N</kbd>New task
            </span>
            <span>
              <kbd>P</kbd>Plan day
            </span>
            <span>
              <kbd>/</kbd>Search
            </span>
          </div>
          <p className="d-small-note">
            Local planning uses scheduling rules. Optional connected AI helps
            with capture and task preparation. It never marks work done or sends
            messages.
          </p>
          <a className="d-doc-link" href="?workspace=events">
            Open the earlier event workspace <ArrowUpRight size={13} />
          </a>
        </DailyModal>
      )}
    </div>
  );
}
