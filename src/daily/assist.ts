import { validDate } from "./storage";
import type { DailyTask } from "./types";
import type { Source, TraceStep } from "../lib/types";
export interface AssistResult {
  mode: "demo" | "live";
  summary: string;
  tasks: {
    title: string;
    minutes: number;
    priority: "high" | "normal" | "low";
    project: string;
    notes: string;
    dueDate?: string | null;
    dependsOnIndices?: number[];
  }[];
  steps: { title: string; detail: string; sourceUrls: string[] }[];
  sources: Source[];
  trace: TraceStep[];
}
export interface Connection {
  url: string;
  token: string;
}
export function safeEndpoint(raw: string): string {
  const url = new URL(raw.trim());
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw new Error("Use an HTTPS service URL, or HTTP on localhost.");
  return url.href.replace(/\/$/, "");
}
export function presetServiceUrl(
  raw: unknown = import.meta.env.VITE_RIPPLE_API_URL,
): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  try {
    return safeEndpoint(raw);
  } catch {
    return "";
  }
}
export async function verifyConnection(
  draft: Connection,
  signal?: AbortSignal,
): Promise<{ connection: Connection; mode: "demo" | "live" }> {
  const connection = {
    url: safeEndpoint(draft.url),
    token: draft.token.trim(),
  };
  const timeout = AbortSignal.timeout(10000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(`${connection.url}/health`, {
    method: "GET",
    cache: "no-store",
    signal: requestSignal,
  });
  if (!response.ok)
    throw new Error("That service did not respond successfully.");
  const health = await response.json().catch(() => null);
  if (!health || !["demo", "live"].includes(health.mode))
    throw new Error("This does not look like a Ripple service.");
  if (health.mode === "live" && health.configured?.nebius !== true)
    throw new Error(
      "This service is not ready for AI yet. Contact its owner and try again later.",
    );
  if (health.requiresAuth === true || health.mode === "live") {
    if (!connection.token)
      throw new Error("Enter the access code shared by the service owner.");
    const sessionResponse = await fetch(`${connection.url}/api/session`, {
      method: "GET",
      headers: { Authorization: `Bearer ${connection.token}` },
      cache: "no-store",
      signal: requestSignal,
    });
    const session = await sessionResponse.json().catch(() => null);
    if (!sessionResponse.ok) {
      if (sessionResponse.status === 401 || sessionResponse.status === 403)
        throw new Error(
          "That access code was not accepted. Check it and try again.",
        );
      throw new Error(
        typeof session?.error?.message === "string"
          ? session.error.message
          : typeof session?.detail === "string"
            ? session.detail
            : "Could not verify access to this service. Please try again.",
      );
    }
    if (session?.status !== "ok" || session.mode !== health.mode)
      throw new Error(
        "The service returned an invalid connection check. Please try again.",
      );
  }
  return { connection, mode: health.mode };
}
export async function assist(
  connection: Connection,
  action: "capture" | "breakdown" | "research",
  text: string,
  date: string,
  task?: DailyTask,
  signal?: AbortSignal,
): Promise<AssistResult> {
  const response = await fetch(
    `${safeEndpoint(connection.url)}/api/daily/assist`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(connection.token
          ? { Authorization: `Bearer ${connection.token}` }
          : {}),
      },
      body: JSON.stringify({
        action,
        text,
        date,
        ...(task
          ? {
              task: {
                title: task.title,
                minutes: task.minutes,
                notes: task.notes,
              },
            }
          : {}),
        useWeb: action === "research",
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(120000)])
        : AbortSignal.timeout(120000),
    },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      data?.error?.message ||
        (typeof data?.detail === "string"
          ? data.detail
          : "The assistant could not finish. Your tasks have not changed."),
    );
  if (
    !data ||
    !["demo", "live"].includes(data.mode) ||
    typeof data.summary !== "string" ||
    !Array.isArray(data.tasks) ||
    !Array.isArray(data.steps) ||
    !Array.isArray(data.sources) ||
    !Array.isArray(data.trace) ||
    data.tasks.length > 12 ||
    data.steps.length > 6 ||
    data.sources.length > 4 ||
    data.trace.length > 4
  )
    throw new Error(
      "The assistant returned an invalid draft. Nothing was added.",
    );
  for (const task of data.tasks) {
    if (
      typeof task.title !== "string" ||
      !task.title.trim() ||
      task.title.length > 200 ||
      !Number.isInteger(task.minutes) ||
      task.minutes < 1 ||
      task.minutes > 720 ||
      !["high", "normal", "low"].includes(task.priority) ||
      typeof task.project !== "string" ||
      task.project.length > 80 ||
      typeof task.notes !== "string" ||
      task.notes.length > 2000 ||
      (task.dueDate != null && !validDate(task.dueDate))
    )
      throw new Error("A suggested task was invalid. Nothing was added.");
  }
  const visiting = new Set<number>(),
    visited = new Set<number>();
  const visit = (i: number) => {
    if (visiting.has(i))
      throw new Error(
        "Suggested task dependencies contain a loop. Nothing was added.",
      );
    if (visited.has(i)) return;
    visiting.add(i);
    const deps = data.tasks[i].dependsOnIndices || [];
    if (
      !Array.isArray(deps) ||
      new Set(deps).size !== deps.length ||
      deps.some(
        (n: unknown) =>
          typeof n !== "number" ||
          !Number.isInteger(n) ||
          n < 0 ||
          n >= data.tasks.length ||
          n === i,
      )
    )
      throw new Error(
        "A suggested prerequisite is invalid. Nothing was added.",
      );
    deps.forEach(visit);
    visiting.delete(i);
    visited.add(i);
  };
  data.tasks.forEach((_: unknown, i: number) => visit(i));
  if (
    (action === "capture" && (!data.tasks.length || data.steps.length)) ||
    (action !== "capture" && data.tasks.length)
  )
    throw new Error("The assistant returned the wrong kind of draft.");
  const sources = new Set<string>();
  for (const source of data.sources) {
    if (
      typeof source.title !== "string" ||
      typeof source.url !== "string" ||
      typeof source.snippet !== "string"
    )
      throw new Error("Invalid source data.");
    const u = new URL(source.url);
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
      throw new Error("Invalid source link.");
    sources.add(source.url);
  }
  for (const step of data.steps) {
    if (
      typeof step.title !== "string" ||
      !step.title.trim() ||
      step.title.length > 160 ||
      typeof step.detail !== "string" ||
      !step.detail.trim() ||
      step.detail.length > 1400 ||
      !Array.isArray(step.sourceUrls) ||
      step.sourceUrls.some(
        (url: unknown) => typeof url !== "string" || !sources.has(url),
      )
    )
      throw new Error("A research step cited a source that was not retrieved.");
  }
  return data;
}
