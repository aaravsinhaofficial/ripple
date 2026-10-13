import ICAL from "ical.js";
import { captureLines } from "./capture";
import { addDays, parseWorkspace, validDate } from "./storage";
import type {
  Commitment,
  DailyTask,
  ImportedSource,
  ImportProvider,
  TaskPriority,
  Workspace,
} from "./types";

export type { ImportProvider } from "./types";
export const IMPORT_MAX_BYTES = 1_000_000;
export const IMPORT_MAX_ITEMS = 200;

export interface ImportSource {
  provider: ImportProvider;
  label: string;
  namespace: string;
}
interface ImportBase {
  externalId: string;
  title: string;
  notes: string;
  url?: string;
  sourceDate?: string;
}
export interface ImportTask extends ImportBase {
  kind: "task";
  minutes: number;
  priority: TaskPriority;
  project: string;
  status: "todo" | "done";
  dueDate?: string;
  dueTime?: number;
  earliestDate?: string;
}
export interface ImportCommitment extends ImportBase {
  kind: "commitment";
  date: string;
  start: number;
  end: number;
  allDay?: boolean;
}
export type ImportItem = ImportTask | ImportCommitment;
export interface ImportSkipped {
  title: string;
  reason: string;
}
export interface ImportBatch {
  version: 1;
  source: ImportSource;
  items: ImportItem[];
  skipped: ImportSkipped[];
  warnings: string[];
}
export interface ImportDiff {
  field: string;
  before: string;
  after: string;
}
export interface ImportPreviewRow {
  key: string;
  status: "added" | "duplicate" | "changed" | "skipped";
  title: string;
  item?: ImportItem;
  existingId?: string;
  localEdited: boolean;
  selected: boolean;
  diffs: ImportDiff[];
  reason?: string;
}
export interface ImportPreview {
  source: ImportSource;
  rows: ImportPreviewRow[];
  warnings: string[];
  counts: Record<ImportPreviewRow["status"], number>;
  baseSignature: string;
  batch: ImportBatch;
}
export interface ImportChoices {
  add: string[];
  replace: string[];
}
export type CSVField =
  | "title"
  | "minutes"
  | "priority"
  | "project"
  | "notes"
  | "dueDate"
  | "dueTime"
  | "earliestDate"
  | "status"
  | "externalId"
  | "url";
export type CSVMapping = Partial<Record<CSVField, string>> & { title: string };
export interface CSVOptions {
  mapping: CSVMapping;
  sourceLabel?: string;
  namespace?: string;
  defaultMinutes?: number;
  dateFormat?: "iso" | "mdy" | "dmy";
}
export interface NotesOptions {
  provider?: ImportProvider;
  sourceLabel?: string;
  namespace?: string;
  sourceUrl?: string;
  sourceDate?: string;
  defaultMinutes?: number;
  date?: string;
}
export interface ICSOptions {
  timezone: string;
  /** First and last workspace calendar dates to include, both inclusive; maximum 31 days. */
  from: string;
  to: string;
  sourceLabel?: string;
  namespace?: string;
  allDay: "skip" | "block";
  attendeeEmail?: string;
}

const PROVIDERS: ImportProvider[] = [
  "ics",
  "csv",
  "notes",
  "json",
  "google-calendar",
  "google-tasks",
  "notion",
  "todoist",
  "granola",
  "otter",
  "github",
  "linear",
  "outlook",
];
const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const isText = (v: unknown, max: number, empty = false): v is string =>
  typeof v === "string" && v.length <= max && (empty || !!v.trim());
const isInteger = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const allowedKeys = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).every((k) => keys.includes(k));
function checkSize(text: string) {
  if (new TextEncoder().encode(text).length > IMPORT_MAX_BYTES)
    throw new Error(
      "Import a file smaller than 1 MB. Export a shorter date range or fewer items.",
    );
}
function safeSourceUrl(value: unknown): value is string {
  if (!isText(value, 2000)) return false;
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
function digest(text: string): string {
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}
function source(
  provider: ImportProvider,
  label: string,
  namespace?: string,
): ImportSource {
  return { provider, label, namespace: namespace || label };
}
function emptyBatch(origin: ImportSource): ImportBatch {
  return { version: 1, source: origin, items: [], skipped: [], warnings: [] };
}
function warn(batch: ImportBatch, message: string) {
  if (!batch.warnings.includes(message)) batch.warnings.push(message);
}
function validateItem(value: unknown): ImportItem {
  if (
    !isObject(value) ||
    !isText(value.externalId, 500) ||
    !isText(value.title, 200) ||
    !isText(value.notes, 2000, true) ||
    (value.url !== undefined && !safeSourceUrl(value.url)) ||
    (value.sourceDate !== undefined && !validDate(value.sourceDate))
  )
    throw new Error(
      "Each imported item needs a stable ID, a title (up to 200 characters), notes (up to 2,000 characters), and a valid source URL/date when supplied.",
    );
  const common = ["kind", "externalId", "title", "notes", "url", "sourceDate"];
  if (value.kind === "task") {
    if (
      !allowedKeys(value, [
        ...common,
        "minutes",
        "priority",
        "project",
        "status",
        "dueDate",
        "dueTime",
        "earliestDate",
      ]) ||
      !isInteger(value.minutes, 1, 720) ||
      !["high", "normal", "low"].includes(value.priority as string) ||
      !isText(value.project, 80, true) ||
      !["todo", "done"].includes(value.status as string) ||
      (value.dueDate !== undefined && !validDate(value.dueDate)) ||
      (value.dueTime !== undefined &&
        (!value.dueDate || !isInteger(value.dueTime, 0, 1440))) ||
      (value.earliestDate !== undefined && !validDate(value.earliestDate))
    )
      throw new Error(
        `Check “${value.title}”: tasks need 1–720 whole minutes, a valid priority/status and real ISO dates. A due time needs a due date.`,
      );
  } else if (value.kind === "commitment") {
    if (
      !allowedKeys(value, [...common, "date", "start", "end", "allDay"]) ||
      !validDate(value.date) ||
      !isInteger(value.start, 0, 1439) ||
      !isInteger(value.end, 1, 1440) ||
      value.start >= value.end ||
      (value.allDay !== undefined && typeof value.allDay !== "boolean") ||
      (value.allDay && (value.start !== 0 || value.end !== 1440))
    )
      throw new Error(
        `Check “${value.title}”: fixed commitments need a real date and an end after their start on the same day.`,
      );
  } else
    throw new Error("An imported item must be a task or fixed commitment.");
  return structuredClone(value) as unknown as ImportItem;
}

/** A portable connector envelope, separate from a full workspace backup. Unknown fields fail closed. */
export function parseConnectorPack(input: unknown): ImportBatch {
  if (typeof input === "string") {
    checkSize(input);
    try {
      input = JSON.parse(input);
    } catch {
      throw new Error("The connector pack must contain valid JSON.");
    }
  }
  if (
    !isObject(input) ||
    !allowedKeys(input, [
      "version",
      "source",
      "items",
      "skipped",
      "warnings",
    ]) ||
    input.version !== 1 ||
    !isObject(input.source) ||
    !allowedKeys(input.source, ["provider", "label", "namespace"]) ||
    !PROVIDERS.includes(input.source.provider as ImportProvider) ||
    !isText(input.source.label, 200) ||
    !isText(input.source.namespace, 200) ||
    !Array.isArray(input.items) ||
    input.items.length > IMPORT_MAX_ITEMS
  )
    throw new Error(
      "Use a version 1 connector pack with a named source, namespace and at most 200 items.",
    );
  checkSize(JSON.stringify(input));
  const skipped = input.skipped ?? [],
    warnings = input.warnings ?? [];
  if (
    !Array.isArray(skipped) ||
    skipped.length > 1000 ||
    skipped.some(
      (v) =>
        !isObject(v) ||
        !allowedKeys(v, ["title", "reason"]) ||
        !isText(v.title, 200) ||
        !isText(v.reason, 500),
    ) ||
    !Array.isArray(warnings) ||
    warnings.length > 100 ||
    warnings.some((v) => !isText(v, 500))
  )
    throw new Error(
      "Connector warnings and skipped-item reasons must be short text lists.",
    );
  return {
    version: 1,
    source: structuredClone(input.source) as unknown as ImportSource,
    items: input.items.map(validateItem),
    skipped: structuredClone(skipped) as ImportSkipped[],
    warnings: [...warnings] as string[],
  };
}

const identity = (
  origin: ImportSource | ImportedSource,
  item: ImportItem | ImportedSource,
) =>
  JSON.stringify([
    origin.provider,
    origin.namespace,
    "kind" in item ? item.kind : "",
    item.externalId,
  ]);
function content(item: ImportItem): Record<string, unknown> {
  const common = {
    title: item.title,
    notes: item.notes,
    url: item.url ?? "",
    sourceDate: item.sourceDate ?? "",
  };
  return item.kind === "task"
    ? {
        ...common,
        minutes: item.minutes,
        priority: item.priority,
        project: item.project,
        status: item.status,
        dueDate: item.dueDate ?? "",
        dueTime: item.dueTime ?? "",
        earliestDate: item.earliestDate ?? "",
      }
    : { ...common, date: item.date, start: item.start, end: item.end };
}
function storedItem(item: DailyTask | Commitment): ImportItem {
  const common = {
    externalId: item.source!.externalId,
    title: item.title,
    notes: item.notes,
    ...(item.source!.url ? { url: item.source!.url } : {}),
    ...(item.source!.sourceDate ? { sourceDate: item.source!.sourceDate } : {}),
  };
  return "minutes" in item
    ? {
        ...common,
        kind: "task",
        minutes: item.minutes,
        priority: item.priority,
        project: item.project,
        status: item.status,
        ...(item.dueDate ? { dueDate: item.dueDate } : {}),
        ...(item.dueTime !== undefined ? { dueTime: item.dueTime } : {}),
        ...(item.earliestDate ? { earliestDate: item.earliestDate } : {}),
      }
    : {
        ...common,
        kind: "commitment",
        date: item.date,
        start: item.start,
        end: item.end,
      };
}
function fingerprint(item: ImportItem) {
  return digest(JSON.stringify(content(item)));
}

export function previewImport(
  input: Workspace,
  raw: ImportBatch,
): ImportPreview {
  const workspace = parseWorkspace(input),
    batch = parseConnectorPack(raw);
  const rows: ImportPreviewRow[] = [],
    seen = new Map<string, string>();
  const existing = new Map<string, DailyTask | Commitment>();
  for (const item of [...workspace.tasks, ...workspace.commitments])
    if (item.source) {
      const key = JSON.stringify([
        item.source.provider,
        item.source.namespace,
        "minutes" in item ? "task" : "commitment",
        item.source.externalId,
      ]);
      if (existing.has(key))
        throw new Error(
          "Two local items point to the same source record. Remove one duplicate task or event before importing again.",
        );
      existing.set(key, item);
    }
  for (const item of batch.items) {
    const id = identity(batch.source, item),
      key = `import-${digest(id)}`,
      nextFingerprint = fingerprint(item);
    if (seen.has(id)) {
      rows.push({
        key: `${key}-repeat-${rows.length}`,
        status: "skipped",
        title: item.title,
        localEdited: false,
        selected: false,
        diffs: [],
        reason:
          seen.get(id) === nextFingerprint
            ? "Repeated source item in this import."
            : "Conflicting copies of the same source item; review the source export.",
      });
      if (seen.get(id) !== nextFingerprint) {
        const earlier = rows.find((row) => row.key === key)!;
        earlier.status = "skipped";
        earlier.selected = false;
        earlier.reason =
          "Conflicting copies of the same source item; review the source export.";
      }
      continue;
    }
    seen.set(id, nextFingerprint);
    const before = existing.get(id);
    if (!before) {
      rows.push({
        key,
        status: "added",
        title: item.title,
        item,
        localEdited: false,
        selected: true,
        diffs: [],
      });
      continue;
    }
    const old = storedItem(before),
      duplicate = before.source!.fingerprint === nextFingerprint;
    const a = content(old),
      b = content(item);
    const diffs = Object.keys(b)
      .filter((field) => a[field] !== b[field])
      .map((field) => ({
        field,
        before: String(a[field] ?? ""),
        after: String(b[field] ?? ""),
      }));
    rows.push({
      key,
      status: duplicate ? "duplicate" : "changed",
      title: item.title,
      item,
      existingId: before.id,
      localEdited: fingerprint(old) !== before.source!.fingerprint,
      selected: false,
      diffs,
      ...(duplicate
        ? { reason: "Already imported. Local edits and completion are kept." }
        : before && "status" in before && before.status === "done"
          ? { reason: "Source changed. Replacing keeps this task completed." }
          : {}),
    });
  }
  batch.skipped.forEach((item, index) =>
    rows.push({
      key: `skipped-${index}`,
      status: "skipped",
      title: item.title,
      reason: item.reason,
      localEdited: false,
      selected: false,
      diffs: [],
    }),
  );
  const counts = { added: 0, duplicate: 0, changed: 0, skipped: 0 };
  rows.forEach((row) => counts[row.status]++);
  const warnings = [...batch.warnings];
  if (
    workspace.tasks.length +
      rows.filter((row) => row.status === "added" && row.item?.kind === "task")
        .length >
    200
  )
    warnings.push(
      `There is room for ${200 - workspace.tasks.length} more tasks. Select fewer new tasks before importing.`,
    );
  if (
    workspace.commitments.length +
      rows.filter(
        (row) => row.status === "added" && row.item?.kind === "commitment",
      ).length >
    50
  )
    warnings.push(
      `There is room for ${50 - workspace.commitments.length} more fixed commitments. Select fewer events or a shorter date range.`,
    );
  return {
    source: batch.source,
    rows,
    warnings,
    counts,
    baseSignature: JSON.stringify(workspace),
    batch,
  };
}

/** Apply only explicit selections to an unchanged workspace; validation happens before anything is returned. */
export function applyImport(
  input: Workspace,
  preview: ImportPreview,
  choices: ImportChoices,
  now = new Date(),
): Workspace {
  const workspace = parseWorkspace(input);
  if (JSON.stringify(workspace) !== preview.baseSignature)
    throw new Error(
      "Your workspace changed after this preview. Refresh the import preview before applying it.",
    );
  const fresh = previewImport(workspace, preview.batch);
  if (
    !choices ||
    !Array.isArray(choices.add) ||
    !Array.isArray(choices.replace) ||
    [...choices.add, ...choices.replace].some(
      (key) => typeof key !== "string",
    ) ||
    new Set([...choices.add, ...choices.replace]).size !==
      choices.add.length + choices.replace.length
  )
    throw new Error(
      "Select each import item once as a new item or an explicit replacement.",
    );
  for (const [action, keys] of [
    ["added", choices.add],
    ["changed", choices.replace],
  ] as const)
    for (const key of keys) {
      const row = fresh.rows.find((item) => item.key === key);
      if (!row || row.status !== action || !row.item)
        throw new Error(
          "An import selection is no longer valid. Refresh the preview.",
        );
      const item = row.item;
      const metadata: ImportedSource = {
        ...fresh.source,
        externalId: item.externalId,
        fingerprint: fingerprint(item),
        importedAt: now.toISOString(),
        ...(item.url ? { url: item.url } : {}),
        ...(item.sourceDate ? { sourceDate: item.sourceDate } : {}),
      };
      const id =
        row.existingId ??
        `${item.kind === "task" ? "task" : "meeting"}-${crypto.randomUUID()}`;
      if (item.kind === "task") {
        const before = workspace.tasks.find((task) => task.id === id);
        const task: DailyTask = {
          ...(before ?? {}),
          id,
          title: item.title,
          notes: item.notes,
          minutes: item.minutes,
          priority: item.priority,
          project: item.project,
          status: before?.status === "done" ? "done" : item.status,
          dependsOn: before?.dependsOn ?? [],
          splittable: before?.splittable ?? true,
          recurrence: before?.recurrence ?? "none",
          createdAt: before?.createdAt ?? now.toISOString(),
          source: metadata,
        };
        for (const field of ["dueDate", "dueTime", "earliestDate"] as const) {
          delete task[field];
          if (item[field] !== undefined)
            Object.assign(task, { [field]: item[field] });
        }
        if (task.status === "done")
          task.completedAt = before?.completedAt ?? now.toISOString();
        if (before)
          workspace.tasks = workspace.tasks.map((existing) =>
            existing.id === id ? task : existing,
          );
        else workspace.tasks.push(task);
      } else {
        const commitment: Commitment = {
          id,
          title: item.title,
          notes: item.notes,
          date: item.date,
          start: item.start,
          end: item.end,
          source: metadata,
        };
        if (row.existingId)
          workspace.commitments = workspace.commitments.map((existing) =>
            existing.id === id ? commitment : existing,
          );
        else workspace.commitments.push(commitment);
      }
    }
  return parseWorkspace(workspace);
}

/** RFC 4180 quoting, including embedded newlines; comma, tab and semicolon exports. */
function csvTable(input: string): { headers: string[]; rows: string[][] } {
  checkSize(input);
  const text = input.replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/, 1)[0];
  const counts = new Map([",", "\t", ";"].map((separator) => [separator, 0]));
  let inQuotes = false;
  for (let i = 0; i < first.length; i++) {
    if (first[i] === '"') {
      if (inQuotes && first[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && counts.has(first[i]))
      counts.set(first[i], counts.get(first[i])! + 1);
  }
  const delimiter = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const table: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const cellDone = () => {
    row.push(cell);
    cell = "";
    closed = false;
  };
  const rowDone = () => {
    cellDone();
    if (row.some((value) => value.trim())) table.push(row);
    row = [];
    if (table.length > 1001)
      throw new Error("Import up to 1,000 source rows at a time.");
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === delimiter) cellDone();
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      rowDone();
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (closed && char.trim())
      throw new Error(
        "A quoted CSV cell has text after its closing quote. Export the file again.",
      );
    else if (!closed) {
      if (char === '"')
        throw new Error(
          "Quote the whole CSV cell when it contains quotation marks.",
        );
      cell += char;
    }
  }
  if (quoted)
    throw new Error(
      "A CSV quotation mark was not closed. Export the file again.",
    );
  if (cell || row.length || closed) rowDone();
  if (!table.length)
    throw new Error(
      "The CSV is empty. Include a header row and at least one task.",
    );
  const headers = table.shift()!.map((value) => value.trim());
  if (
    headers.length > 100 ||
    headers.some((value) => !value || value.length > 100) ||
    new Set(headers.map((value) => value.toLowerCase())).size !== headers.length
  )
    throw new Error(
      "CSV columns need distinct, non-empty names (up to 100 columns).",
    );
  if (table.some((values) => values.length !== headers.length))
    throw new Error(
      "Every CSV row must have the same number of cells as its header. Use quotes around commas inside a cell.",
    );
  return { headers, rows: table };
}
const CSV_ALIASES: Record<CSVField, string[]> = {
  title: ["title", "name", "task", "task name", "content", "summary"],
  minutes: [
    "minutes",
    "estimate",
    "estimated minutes",
    "duration",
    "time needed",
  ],
  priority: ["priority"],
  project: ["project", "project name", "area"],
  notes: ["notes", "description", "details"],
  dueDate: ["due date", "due", "deadline", "date"],
  dueTime: ["due time", "deadline time"],
  earliestDate: ["earliest date", "start date"],
  status: ["status", "completed", "done"],
  externalId: ["id", "task id", "external id", "page id"],
  url: ["url", "link", "source url", "task url"],
};
export function inspectTaskCSV(text: string): {
  headers: string[];
  mapping: CSVMapping;
  rows: number;
} {
  const table = csvTable(text),
    mapping: CSVMapping = { title: "" };
  for (const [field, aliases] of Object.entries(CSV_ALIASES)) {
    const column = aliases
      .map((alias) =>
        table.headers.find(
          (header) => header.toLowerCase().replace(/_/g, " ") === alias,
        ),
      )
      .find(Boolean);
    if (column) mapping[field as CSVField] = column;
  }
  return { headers: table.headers, mapping, rows: table.rows.length };
}
function estimate(
  raw: string,
  fallback: number,
): { minutes: number; estimated: boolean } {
  if (!raw.trim()) {
    if (!isInteger(fallback, 1, 720))
      throw new Error("Choose a default estimate from 1–720 minutes.");
    return { minutes: fallback, estimated: true };
  }
  const value = raw.trim().toLowerCase();
  let minutes: number;
  if (/^\d+(?:\.\d+)?$/.test(value)) minutes = Number(value);
  else {
    const match =
      /^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)(?:\s*(\d+)\s*(?:m|min|mins|minutes?))?|(\d+)\s*(?:m|min|mins|minutes?))$/.exec(
        value,
      );
    if (!match) throw new Error("Use an estimate such as 30, 30m or 1h 15m.");
    minutes = match[1]
      ? Number(match[1]) * 60 + Number(match[2] ?? 0)
      : Number(match[3]);
  }
  if (!isInteger(minutes, 1, 720))
    throw new Error("Use 1–720 whole estimated minutes.");
  return { minutes, estimated: false };
}
function importDate(raw: string, format: CSVOptions["dateFormat"]): string {
  if (validDate(raw)) return raw;
  const numbers = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  let converted = "";
  if (numbers && (format === "mdy" || format === "dmy"))
    converted = `${numbers[3]}-${Number(numbers[format === "mdy" ? 1 : 2])
      .toString()
      .padStart(2, "0")}-${Number(numbers[format === "mdy" ? 2 : 1])
      .toString()
      .padStart(2, "0")}`;
  const words =
    /^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}),? (\d{4})$/i.exec(
      raw,
    );
  if (words)
    converted = `${words[3]}-${String(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(words[1].slice(0, 3).toLowerCase()) + 1).padStart(2, "0")}-${words[2].padStart(2, "0")}`;
  if (!validDate(converted))
    throw new Error(
      `“${raw}” is not an unambiguous date. Use YYYY-MM-DD or choose the matching numeric date format.`,
    );
  return converted;
}
function importClock(raw: string): number {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(raw);
  const minute = match ? Number(match[1]) * 60 + Number(match[2]) : -1;
  if (!isInteger(minute, 0, 1440))
    throw new Error("Use a due time from 00:00 through 24:00.");
  return minute;
}
export function parseTaskCSV(text: string, options: CSVOptions): ImportBatch {
  const { headers, rows } = csvTable(text);
  if (!options?.mapping?.title || !headers.includes(options.mapping.title))
    throw new Error("Choose which CSV column contains the task title.");
  for (const [field, header] of Object.entries(options.mapping))
    if (!(field in CSV_ALIASES) || (header && !headers.includes(header)))
      throw new Error("Choose an existing CSV column for each mapped field.");
  const todoist =
    headers.some((header) => header.toUpperCase() === "TYPE") &&
    headers.some((header) => header.toUpperCase() === "CONTENT");
  const batch = emptyBatch(
    source(
      todoist ? "todoist" : "csv",
      options.sourceLabel || "Task CSV",
      options.namespace,
    ),
  );
  const typeIndex = headers.findIndex(
    (header) => header.toUpperCase() === "TYPE",
  );
  const unitIndex = headers.findIndex(
    (header) => header.toUpperCase().replace(/_/g, " ") === "DURATION UNIT",
  );
  rows.forEach((row, index) => {
    const get = (field: CSVField) =>
      options.mapping[field]
        ? row[headers.indexOf(options.mapping[field]!)].trim()
        : "";
    const title = get("title") || `CSV row ${index + 2}`;
    try {
      if (
        todoist &&
        typeIndex >= 0 &&
        row[typeIndex].trim().toLowerCase() !== "task"
      ) {
        batch.skipped.push({
          title: title.slice(0, 200),
          reason: "A Todoist section or note is not a task.",
        });
        return;
      }
      if (!get("title")) throw new Error("Choose a non-empty task title.");
      const statusRaw = get("status").toLowerCase();
      if (
        ["canceled", "cancelled", "deleted", "archived"].includes(statusRaw)
      ) {
        batch.skipped.push({
          title: title.slice(0, 200),
          reason: "The source task is canceled or archived.",
        });
        return;
      }
      const completed = [
        "done",
        "completed",
        "complete",
        "finished",
        "true",
        "1",
        "x",
        "checked",
      ].includes(statusRaw);
      if (
        statusRaw &&
        !completed &&
        ![
          "todo",
          "to do",
          "not started",
          "in progress",
          "doing",
          "open",
          "backlog",
          "false",
          "0",
          "unchecked",
        ].includes(statusRaw)
      )
        throw new Error(
          `Unrecognized status “${get("status")}”. Map a completion column or leave Status unmapped.`,
        );
      let rawDuration = get("minutes");
      if (todoist && rawDuration && unitIndex >= 0) {
        const unit = row[unitIndex].trim().toLowerCase();
        if (/^hours?$/.test(unit)) rawDuration += "h";
        else if (unit && !/^minutes?$/.test(unit))
          throw new Error(
            `Unsupported duration unit “${unit}”. Use minutes or hours.`,
          );
      }
      const amount = estimate(rawDuration, options.defaultMinutes ?? 30);
      const rawPriority = get("priority").toLowerCase();
      let priority: TaskPriority = "normal";
      if (["high", "urgent", "p1", "1"].includes(rawPriority))
        priority = "high";
      else if (["low", "p4", "4"].includes(rawPriority)) priority = "low";
      else if (
        rawPriority &&
        !["normal", "medium", "p2", "p3", "2", "3"].includes(rawPriority)
      )
        throw new Error("Use High, Normal or Low priority (or P1–P4).");
      const url = get("url"),
        project = get("project");
      const item: ImportTask = {
        kind: "task",
        externalId:
          get("externalId") ||
          (url
            ? `url:${url}`
            : `task:${digest(JSON.stringify([get("title"), project]))}`),
        title: get("title"),
        notes: get("notes"),
        minutes: amount.minutes,
        priority,
        project,
        status: completed ? "done" : "todo",
      };
      if (url) item.url = url;
      if (amount.estimated)
        item.notes = [
          item.notes,
          `Duration estimate: ${amount.minutes} minutes; no duration was supplied by the source.`,
        ]
          .filter(Boolean)
          .join("\n\n");
      if (get("dueDate"))
        item.dueDate = importDate(get("dueDate"), options.dateFormat);
      if (get("dueTime")) item.dueTime = importClock(get("dueTime"));
      if (get("earliestDate"))
        item.earliestDate = importDate(get("earliestDate"), options.dateFormat);
      batch.items.push(validateItem(item));
      if (!get("externalId") && !url)
        warn(
          batch,
          "Rows without source IDs or URLs are matched by title and project. Renamed tasks appear as new items; review before adding them.",
        );
    } catch (error) {
      batch.skipped.push({
        title: title.slice(0, 200),
        reason:
          `Row ${index + 2}: ${error instanceof Error ? error.message : "Invalid row."}`.slice(
            0,
            500,
          ),
      });
    }
  });
  if (batch.items.length > IMPORT_MAX_ITEMS)
    throw new Error("Import up to 200 tasks at a time. Export fewer CSV rows.");
  return parseConnectorPack(batch);
}

/** Extract only explicit actions, never ordinary meeting transcript prose. */
export function parseActionNotes(
  text: string,
  options: NotesOptions = {},
): ImportBatch {
  checkSize(text);
  const batch = emptyBatch(
    source(
      options.provider || "notes",
      options.sourceLabel || "Action notes",
      options.namespace,
    ),
  );
  if (options.sourceUrl && !safeSourceUrl(options.sourceUrl))
    throw new Error(
      "Use a valid HTTP or HTTPS document link without embedded credentials.",
    );
  if (options.sourceDate && !validDate(options.sourceDate))
    throw new Error("Use YYYY-MM-DD for the source document date.");
  if (!isInteger(options.defaultMinutes ?? 30, 1, 720))
    throw new Error("Choose a default estimate from 1–720 minutes.");
  let actionSection = false,
    sectionDepth = 0,
    fenced = false;
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length > 5000)
    throw new Error("Import up to 5,000 lines of notes at a time.");
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !line) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    const plainHeading =
      /^\*{0,2}(action items?|next steps?|to[ -]?do|tasks?|follow[ -]?ups?)\*{0,2}:?$/i.exec(
        line,
      );
    if (heading || plainHeading) {
      const depth = heading ? heading[1].length : 1,
        title = heading ? heading[2].replace(/[*_]/g, "") : plainHeading![1];
      if (
        /^(action items?|next steps?|to[ -]?do|tasks?|follow[ -]?ups?)$/i.test(
          title.trim(),
        )
      ) {
        actionSection = true;
        sectionDepth = depth;
      } else if (depth <= sectionDepth) actionSection = false;
      continue;
    }
    const checkbox = /^(?:[-*+]\s+)?\[([ xX])\]\s+(.+)$/.exec(line);
    const explicit =
      /^(?:[-*+]\s+)?(?:TODO|ACTION(?: ITEM)?|NEXT STEP):\s*(.+)$/i.exec(line);
    const bullet = /^(?:[-*+•]\s+|\d+[.)]\s+)(.+)$/.exec(line);
    if (actionSection && !checkbox && !explicit && !bullet) {
      actionSection = false;
      continue;
    }
    if (checkbox && checkbox[1].toLowerCase() === "x") {
      batch.skipped.push({
        title: checkbox[2].slice(0, 200),
        reason: "This action is already checked off in the source.",
      });
      continue;
    }
    const action =
      checkbox?.[2] ??
      explicit?.[1] ??
      (actionSection ? bullet?.[1] : undefined);
    if (!action) continue;
    try {
      const explicitId =
        /\s*<!--\s*(?:id|block-id):\s*([^<>]{1,200}?)\s*-->\s*$/.exec(action);
      const original = (
        explicitId ? action.slice(0, explicitId.index) : action
      ).trim();
      const plain = original
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1");
      const task = captureLines(
        plain,
        options.date ?? options.sourceDate ?? "2000-01-01",
      )[0];
      const hasEstimate =
        /(?:^|\s|\()\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)(?=\s|$|\))/i.test(
          plain,
        );
      const minutes = hasEstimate
        ? task.minutes
        : (options.defaultMinutes ?? 30);
      const notes = [
        `Original action: ${original}`,
        !hasEstimate
          ? `Duration estimate: ${minutes} minutes; no duration was supplied by the source.`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const item: ImportTask = {
        kind: "task",
        externalId: explicitId?.[1].trim() || `action:${digest(original)}`,
        title: task.title,
        notes,
        minutes,
        priority: task.priority,
        project: task.project,
        status: "todo",
        ...(task.dueDate ? { dueDate: task.dueDate } : {}),
        ...(task.dueTime !== undefined ? { dueTime: task.dueTime } : {}),
        ...(options.sourceUrl ? { url: options.sourceUrl } : {}),
        ...(options.sourceDate ? { sourceDate: options.sourceDate } : {}),
      };
      if (
        /\bdue:(today|tomorrow)\b/i.test(plain) &&
        !options.date &&
        !options.sourceDate
      )
        throw new Error(
          "Choose a reference date before importing an action with a relative deadline.",
        );
      batch.items.push(validateItem(item));
      if (task.recurrence !== "none")
        warn(
          batch,
          "Recurrence instructions remain in the original action notes. Set repeating behavior in task details after importing.",
        );
      if (!explicitId)
        warn(
          batch,
          "Actions without stable source IDs are matched by their original text. An edited action appears as new; review it before adding.",
        );
    } catch (error) {
      batch.skipped.push({
        title: action.slice(0, 200),
        reason:
          `Line ${index + 1}: ${error instanceof Error ? error.message : "Invalid action."}`.slice(
            0,
            500,
          ),
      });
    }
    if (batch.items.length > IMPORT_MAX_ITEMS)
      throw new Error(
        "Import up to 200 action items at a time. Use a shorter notes excerpt.",
      );
  }
  if (!batch.items.length)
    warn(
      batch,
      "No unfinished explicit action items were found. Use unchecked boxes, TODO: lines, or bullets beneath an Action items heading.",
    );
  if (batch.skipped.length > 1000) {
    batch.skipped = batch.skipped.slice(0, 1000);
    warn(
      batch,
      "Only the first 1,000 skipped actions are listed. Use a shorter excerpt to inspect every skipped item.",
    );
  }
  return parseConnectorPack(batch);
}

type CalendarTime = InstanceType<typeof ICAL.Time>;
type CalendarEvent = InstanceType<typeof ICAL.Event>;
type CalendarComponent = InstanceType<typeof ICAL.Component>;
type WallTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};
const pad = (n: number) => String(n).padStart(2, "0");
const wallDate = (time: Pick<WallTime, "year" | "month" | "day">) =>
  `${String(time.year).padStart(4, "0")}-${pad(time.month)}-${pad(time.day)}`;
const wallStamp = (time: WallTime) =>
  Date.UTC(
    time.year,
    time.month - 1,
    time.day,
    time.hour,
    time.minute,
    time.second,
  );
const dayDistance = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000,
  );
const formatters = new Map<string, Intl.DateTimeFormat>();
function zoneFormatter(timezone: string) {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    if (formatters.size < 100) formatters.set(timezone, formatter);
  }
  return formatter;
}
function wallAt(epoch: number, timezone: string): WallTime {
  const parts = zoneFormatter(timezone).formatToParts(epoch);
  const value = (name: string) =>
    Number(parts.find((part) => part.type === name)!.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}
/** Enumerate the nearby UTC offsets; repeated wall times resolve to their first occurrence (RFC 5545). */
function resolveWall(
  time: WallTime,
  timezone: string,
): { epoch: number; exact: boolean; ambiguous: boolean } {
  const naive = wallStamp(time);
  const offsets = new Set(
    [-172800000, 0, 172800000].map(
      (delta) => wallStamp(wallAt(naive + delta, timezone)) - (naive + delta),
    ),
  );
  const matches = [...offsets]
    .map((offset) => naive - offset)
    .filter((epoch) => wallStamp(wallAt(epoch, timezone)) === naive)
    .sort((a, b) => a - b);
  if (matches.length)
    return { epoch: matches[0], exact: true, ambiguous: matches.length > 1 };
  // The adapter needs an offset to continue iteration; emission rejects a nonexistent wall time.
  return {
    epoch: naive - Math.min(...offsets),
    exact: false,
    ambiguous: false,
  };
}
function midnight(date: string, timezone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const result = resolveWall(
    { year, month, day, hour: 0, minute: 0, second: 0 },
    timezone,
  );
  if (!result.exact)
    throw new Error(
      `Midnight on ${date} does not exist in ${timezone}; choose a different import window.`,
    );
  return result.epoch;
}
function calendarTimeFields(time: CalendarTime): WallTime {
  return {
    year: time.year,
    month: time.month,
    day: time.day,
    hour: time.hour,
    minute: time.minute,
    second: time.second,
  };
}
function normalizedCalendarText(component: CalendarComponent, name: string) {
  const value = component.getFirstPropertyValue(name);
  return value == null ? "" : String(value);
}
function validateRawCalendarTime(raw: unknown) {
  if (typeof raw !== "string") return;
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z?)?$/.test(raw) ||
    !validDate(raw.slice(0, 10))
  )
    throw new Error("The calendar contains an invalid date or time.");
  if (
    raw.length > 10 &&
    (Number(raw.slice(11, 13)) > 23 ||
      Number(raw.slice(14, 16)) > 59 ||
      Number(raw.slice(17, 19)) > 59)
  )
    throw new Error("The calendar contains an invalid clock time.");
}
function shouldSkipEvent(
  event: CalendarEvent,
  attendeeEmail?: string,
): string | undefined {
  if (
    normalizedCalendarText(event.component, "status").toUpperCase() ===
    "CANCELLED"
  )
    return "Canceled calendar event.";
  if (
    normalizedCalendarText(event.component, "transp").toUpperCase() ===
      "TRANSPARENT" ||
    normalizedCalendarText(
      event.component,
      "x-microsoft-cdo-busystatus",
    ).toUpperCase() === "FREE"
  )
    return "This calendar event is marked free; it does not block time.";
  if (attendeeEmail) {
    const email = attendeeEmail
      .trim()
      .toLowerCase()
      .replace(/^mailto:/, "");
    const declined = event.attendees.some(
      (attendee) =>
        String(attendee.getFirstValue())
          .toLowerCase()
          .replace(/^mailto:/, "") === email &&
        String(attendee.getParameter("partstat")).toUpperCase() === "DECLINED",
    );
    if (declined) return "You declined this calendar invitation.";
  }
  return undefined;
}

/** Local-only RFC 5545 import. Recurrences are materialized within an explicit, finite date window. */
export function parseICS(text: string, options: ICSOptions): ImportBatch {
  checkSize(text);
  if (
    !options ||
    !validDate(options.from) ||
    !validDate(options.to) ||
    options.to < options.from ||
    dayDistance(options.from, options.to) > 30
  )
    throw new Error("Choose an inclusive calendar import window of 1–31 days.");
  try {
    zoneFormatter(options.timezone);
  } catch {
    throw new Error(
      "Choose a valid workspace timezone before importing a calendar.",
    );
  }
  if (!["skip", "block"].includes(options.allDay))
    throw new Error(
      "Choose whether all-day events should be skipped or block the day.",
    );
  if (!/^\s*BEGIN:VCALENDAR\s*$/im.test(text))
    throw new Error(
      "Choose an iCalendar (.ics) file beginning with BEGIN:VCALENDAR.",
    );
  let root: CalendarComponent;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new Error(
      "This calendar could not be parsed. Export a fresh .ics file from your calendar app.",
    );
  }
  if (root.name !== "vcalendar")
    throw new Error("Choose a complete iCalendar (.ics) calendar export.");
  const components = root.getAllSubcomponents("vevent");
  if (components.length > 1000)
    throw new Error(
      "This calendar contains more than 1,000 event records. Export a smaller calendar or shorter range.",
    );
  const batch = emptyBatch(
    source(
      "ics",
      options.sourceLabel ||
        normalizedCalendarText(root, "x-wr-calname") ||
        "Calendar file",
      options.namespace,
    ),
  );
  const startWindow = midnight(options.from, options.timezone),
    endWindow = midnight(addDays(options.to, 1), options.timezone);
  const zones = new Map<string, InstanceType<typeof ICAL.Timezone>>();
  const wallCache = new Map<
    string,
    { epoch: number; exact: boolean; ambiguous: boolean }
  >();
  const resolve = (time: CalendarTime, timezone: string) => {
    const key = `${timezone}|${time.toString()}`;
    let value = wallCache.get(key);
    if (!value) {
      value = resolveWall(calendarTimeFields(time), timezone);
      if (wallCache.size < 30000) wallCache.set(key, value);
    }
    return value;
  };
  const adapter = (timezone: string) => {
    let zone = zones.get(timezone);
    if (!zone) {
      try {
        zoneFormatter(timezone);
      } catch {
        throw new Error(
          `Timezone “${timezone}” has no usable VTIMEZONE definition. Export the calendar with timezone data.`,
        );
      }
      zone = new ICAL.Timezone({ tzid: timezone });
      zone.utcOffset = (time: CalendarTime) =>
        (wallStamp(calendarTimeFields(time)) - resolve(time, timezone).epoch) /
        1000;
      zones.set(timezone, zone);
    }
    return zone;
  };
  const prepareTimes = (component: CalendarComponent) => {
    for (const name of ["dtstart", "dtend", "recurrence-id", "rdate", "exdate"])
      for (const property of component.getAllProperties(name)) {
        const raw: unknown[] = property.toJSON().slice(3);
        raw.forEach((value) => {
          if (Array.isArray(value))
            value.forEach((part) => {
              if (typeof part === "string" && !part.startsWith("P"))
                validateRawCalendarTime(part);
            });
          else validateRawCalendarTime(value);
        });
        const tzid = property.getParameter("tzid");
        if (tzid && typeof tzid !== "string")
          throw new Error("A calendar date has multiple timezone identifiers.");
        for (const value of property.getValues()) {
          const times =
            value instanceof ICAL.Period
              ? [value.start, value.end].filter(Boolean)
              : [value];
          for (const time of times)
            if (time instanceof ICAL.Time && !time.isDate) {
              if (time.zone === ICAL.Timezone.utcTimezone) continue;
              if (tzid && root.getTimeZoneByID(tzid)) continue;
              const timezone = tzid || options.timezone;
              if (!tzid)
                warn(
                  batch,
                  `Floating calendar times use your workspace timezone (${options.timezone}).`,
                );
              time.zone = adapter(timezone);
            }
        }
      }
  };
  const instant = (time: CalendarTime): number => {
    if (zones.has(time.zone.tzid) && !resolve(time, time.zone.tzid).exact)
      throw new Error(
        `A local time on ${wallDate(time)} does not exist because of a timezone clock change. This occurrence was skipped.`,
      );
    const epoch = time.toUnixTime() * 1000;
    if (!Number.isFinite(epoch))
      throw new Error("The event has an invalid calendar time.");
    return epoch;
  };
  const recurrenceKey = (time: CalendarTime) =>
    time.isDate
      ? time.toString()
      : new Date(time.toUnixTime() * 1000).toISOString().replace(".000Z", "Z");
  const events = new Map<string, CalendarEvent[]>();
  for (const component of components) {
    const title = (
      normalizedCalendarText(component, "summary") || "Untitled calendar event"
    ).slice(0, 200);
    try {
      prepareTimes(component);
      const uid = normalizedCalendarText(component, "uid");
      if (!uid || uid.length > 350)
        throw new Error(
          "The calendar event needs a stable UID of at most 350 characters.",
        );
      if (
        !component.hasProperty("dtstart") &&
        component.hasProperty("recurrence-id") &&
        normalizedCalendarText(component, "status").toUpperCase() ===
          "CANCELLED"
      )
        component.addPropertyWithValue(
          "dtstart",
          component.getFirstPropertyValue("recurrence-id"),
        );
      if (!component.hasProperty("dtstart"))
        throw new Error("The calendar event has no start date.");
      const event = new ICAL.Event(component, {
        exceptions: [],
        strictExceptions: true,
      });
      const group = events.get(uid) || [];
      group.push(event);
      events.set(uid, group);
    } catch (error) {
      batch.skipped.push({
        title,
        reason: (error instanceof Error
          ? error.message
          : "Invalid calendar event."
        ).slice(0, 500),
      });
    }
  }
  let truncated = false,
    totalExpansions = 0,
    expansionLimit = false;
  const emit = (
    event: CalendarEvent,
    start: CalendarTime,
    end: CalendarTime,
    originalId: string,
    uid: string,
  ) => {
    const title = event.summary || "Untitled calendar event";
    const reason =
      shouldSkipEvent(event, options.attendeeEmail) ||
      (normalizedCalendarText(root, "method").toUpperCase() === "CANCEL"
        ? "Canceled calendar invitation."
        : undefined);
    if (reason) {
      batch.skipped.push({ title: title.slice(0, 200), reason });
      return;
    }
    const allDay = start.isDate;
    if (allDay !== end.isDate)
      throw new Error("The event mixes an all-day date and a timed end.");
    if (allDay && options.allDay === "skip") {
      batch.skipped.push({
        title: title.slice(0, 200),
        reason: "All-day event skipped by your import choice.",
      });
      return;
    }
    const url = normalizedCalendarText(event.component, "url");
    let notes = [
      event.description,
      event.location ? `Location: ${event.location}` : "",
      allDay ? "All-day calendar event; blocks this whole day." : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    if (notes.length > 2000) {
      notes = `${notes.slice(0, 1930)}\n\n[Description excerpt; open the source for the full event.]`;
      warn(
        batch,
        "Long calendar descriptions were shortened and labeled as excerpts.",
      );
    }
    const firstDate = allDay
      ? wallDate(start)
      : wallDate(wallAt(instant(start), options.timezone));
    let dates: { date: string; start: number; end: number }[] = [];
    if (allDay) {
      const endDate = wallDate(end);
      if (endDate <= firstDate)
        throw new Error(
          "An all-day event must end after its start; its end date is exclusive.",
        );
      for (
        let date = firstDate > options.from ? firstDate : options.from;
        date < endDate && date <= options.to;
        date = addDays(date, 1)
      )
        dates.push({ date, start: 0, end: 1440 });
    } else {
      const startEpoch = instant(start);
      let endEpoch: number;
      const declaredDuration =
        event.component.getFirstPropertyValue("duration");
      if (declaredDuration instanceof ICAL.Duration) {
        if (declaredDuration.isNegative)
          throw new Error("An event duration must be positive.");
        const anchor = start.clone();
        anchor.day += declaredDuration.weeks * 7 + declaredDuration.days;
        endEpoch =
          instant(anchor) +
          (declaredDuration.hours * 3600 +
            declaredDuration.minutes * 60 +
            declaredDuration.seconds) *
            1000;
      } else if (event.isRecurring() || event.isRecurrenceException()) {
        // DTEND gives a recurring timed event an exact elapsed duration, including across clock changes.
        endEpoch =
          startEpoch + (instant(event.endDate) - instant(event.startDate));
      } else endEpoch = instant(end);
      if (endEpoch <= startEpoch)
        throw new Error(
          "This timed event has no positive duration. No default meeting length was invented.",
        );
      if (endEpoch <= startWindow || startEpoch >= endWindow) return;
      for (
        let date = firstDate > options.from ? firstDate : options.from;
        date <= options.to;
        date = addDays(date, 1)
      ) {
        const dayStart = midnight(date, options.timezone),
          dayEnd = midnight(addDays(date, 1), options.timezone);
        if (endEpoch <= dayStart) break;
        const clippedStart = Math.max(startEpoch, dayStart),
          clippedEnd = Math.min(endEpoch, dayEnd);
        if (clippedEnd <= clippedStart) continue;
        const a = wallAt(clippedStart, options.timezone),
          b = wallAt(clippedEnd, options.timezone);
        if (
          resolveWall(a, options.timezone).ambiguous ||
          resolveWall(b, options.timezone).ambiguous
        )
          throw new Error(
            "An endpoint falls in an ambiguous repeated clock hour. This local-time planner cannot represent both occurrences; review the event in your source calendar.",
          );
        const from = clippedStart === dayStart ? 0 : a.hour * 60 + a.minute;
        const to =
          clippedEnd === dayEnd
            ? 1440
            : b.hour * 60 + b.minute + (b.second ? 1 : 0);
        if (from >= to)
          throw new Error(
            "This event crosses a repeated clock hour and cannot be represented by one local-time block. Review it in the source calendar.",
          );
        if (a.second || b.second)
          warn(
            batch,
            "Calendar seconds were rounded outward to whole minutes so busy time remains protected.",
          );
        dates.push({ date, start: from, end: to });
      }
    }
    for (const segment of dates) {
      if (batch.items.length >= IMPORT_MAX_ITEMS) {
        truncated = true;
        return;
      }
      const item: ImportCommitment = {
        kind: "commitment",
        externalId: `${uid}::${originalId}::${dayDistance(firstDate, segment.date)}`,
        title,
        notes,
        ...segment,
        allDay,
        ...(url ? { url } : {}),
      };
      batch.items.push(validateItem(item));
    }
  };
  for (const [uid, group] of events) {
    if (truncated || expansionLimit) break;
    const versions = new Map<string, CalendarEvent>();
    let ambiguous = false;
    for (const event of group) {
      const key = event.isRecurrenceException()
        ? recurrenceKey(event.recurrenceId)
        : "master";
      const previous = versions.get(key);
      const rank = (item: CalendarEvent) =>
        `${String(item.sequence || 0).padStart(10, "0")}|${normalizedCalendarText(item.component, "last-modified") || normalizedCalendarText(item.component, "dtstamp")}`;
      if (!previous || rank(event) > rank(previous)) versions.set(key, event);
      else if (
        rank(event) === rank(previous) &&
        event.toString() !== previous.toString()
      )
        ambiguous = true;
    }
    if (ambiguous) {
      batch.skipped.push({
        title: group[0].summary || "Calendar event",
        reason:
          "Conflicting versions have the same UID and revision. Export a fresh calendar before importing this series.",
      });
      continue;
    }
    const master = versions.get("master");
    const exceptions = [...versions.values()].filter((event) =>
      event.isRecurrenceException(),
    );
    if (!master) {
      for (const event of exceptions)
        try {
          emit(
            event,
            event.startDate,
            event.endDate,
            recurrenceKey(event.recurrenceId),
            uid,
          );
        } catch (error) {
          batch.skipped.push({
            title: (event.summary || "Calendar event").slice(0, 200),
            reason: (error instanceof Error
              ? error.message
              : "Invalid occurrence."
            ).slice(0, 500),
          });
        }
      continue;
    }
    const title = (master.summary || "Calendar event").slice(0, 200);
    const ignore = shouldSkipEvent(master, options.attendeeEmail);
    if (
      ignore ||
      normalizedCalendarText(root, "method").toUpperCase() === "CANCEL"
    ) {
      batch.skipped.push({
        title,
        reason: ignore || "Canceled calendar invitation.",
      });
      continue;
    }
    if (
      !options.attendeeEmail &&
      master.attendees.some(
        (attendee) =>
          String(attendee.getParameter("partstat")).toUpperCase() ===
          "DECLINED",
      )
    )
      warn(
        batch,
        "Supply your attendee email to filter your declined invitations. A different attendee declining does not cancel your event.",
      );
    const seriesStartIndex = batch.items.length;
    try {
      exceptions.forEach((exception) => master.relateException(exception));
      if (!master.isRecurring()) {
        emit(master, master.startDate, master.endDate, "single", uid);
        continue;
      }
      if (master.component.getAllProperties("rrule").length > 1)
        throw new Error(
          "Multiple recurrence rules in one event are not supported. Export this series as separate events.",
        );
      if (
        master.component
          .getAllProperties("rdate")
          .some((property) =>
            property.getValues().some((value) => value instanceof ICAL.Period),
          )
      )
        throw new Error(
          "RDATE periods with individual durations need separate calendar events. Export this series as individual events.",
        );
      const rule = master.component.getFirstPropertyValue("rrule");
      if (
        rule instanceof ICAL.Recur &&
        ["SECONDLY", "MINUTELY"].includes(rule.freq)
      )
        throw new Error(
          "Recurrences more frequent than hourly are not imported. Export individual events or a less frequent series.",
        );
      const iterator = master.iterator(),
        seen = new Set<string>();
      const backwardShift = Math.max(
        0,
        ...exceptions
          .filter((exception) => exception.modifiesFuture())
          .map((exception) =>
            dayDistance(
              wallDate(exception.startDate),
              wallDate(exception.recurrenceId),
            ),
          ),
      );
      let checked = 0,
        occurrence: CalendarTime | undefined;
      while ((occurrence = iterator.next())) {
        if (++totalExpansions > 20000) {
          expansionLimit = true;
          throw new Error(
            "This calendar needs too many recurrence expansions. Export the selected range as individual events.",
          );
        }
        if (++checked > 10000)
          throw new Error(
            "This recurrence requires more than 10,000 expansions. Export only the selected date range as individual events.",
          );
        // Two days cover timezone offsets and overnight starts; moved exceptions are also handled separately below.
        if (wallDate(occurrence) > addDays(options.to, 2 + backwardShift))
          break;
        if (
          rule instanceof ICAL.Recur &&
          rule.count &&
          !occurrence.isDate &&
          zones.has(occurrence.zone.tzid) &&
          !resolve(occurrence, occurrence.zone.tzid).exact
        )
          throw new Error(
            "A counted recurrence includes a nonexistent clock-change time. Export this series as individual events so its occurrence count is preserved.",
          );
        const occurrenceId = recurrenceKey(occurrence);
        const details = master.getOccurrenceDetails(occurrence);
        seen.add(occurrenceId);
        try {
          emit(
            details.item,
            details.startDate,
            details.endDate,
            occurrenceId,
            uid,
          );
        } catch (error) {
          batch.skipped.push({
            title,
            reason: (error instanceof Error
              ? error.message
              : "Invalid recurring occurrence."
            ).slice(0, 500),
          });
        }
        if (truncated) break;
      }
      for (const exception of exceptions)
        if (
          !seen.has(recurrenceKey(exception.recurrenceId)) &&
          !exception.modifiesFuture()
        ) {
          try {
            emit(
              exception,
              exception.startDate,
              exception.endDate,
              recurrenceKey(exception.recurrenceId),
              uid,
            );
          } catch (error) {
            batch.skipped.push({
              title,
              reason: (error instanceof Error
                ? error.message
                : "Invalid recurrence exception."
              ).slice(0, 500),
            });
          }
        }
    } catch (error) {
      batch.items.splice(seriesStartIndex);
      batch.skipped.push({
        title,
        reason: (error instanceof Error
          ? error.message
          : "Invalid calendar recurrence."
        ).slice(0, 500),
      });
    }
  }
  if (expansionLimit)
    throw new Error(
      "This calendar needs more than 20,000 recurrence expansions. No import was applied. Export the selected range as individual events.",
    );
  if (truncated)
    warn(
      batch,
      "Only the first 200 event segments are shown. This import is incomplete; choose a shorter date window for the complete calendar.",
    );
  if (batch.skipped.length > 1000) {
    batch.skipped = batch.skipped.slice(0, 1000);
    warn(
      batch,
      "Only the first 1,000 skipped occurrences are listed. Choose a shorter source calendar to inspect all skipped records.",
    );
  }
  batch.items.sort((a, b) =>
    a.kind === "commitment" && b.kind === "commitment"
      ? a.date.localeCompare(b.date) ||
        a.start - b.start ||
        a.externalId.localeCompare(b.externalId)
      : 0,
  );
  return parseConnectorPack(batch);
}
