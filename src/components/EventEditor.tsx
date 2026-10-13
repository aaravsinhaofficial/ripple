import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  DoorOpen,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  addActivity,
  basicIssues,
  buildEditorPlan,
  createEventDraft,
  editorId,
  EditorValidationError,
  materializeResources,
} from "../lib/editor";
import type {
  ActivityDraft,
  EditorIssue,
  EventDraft,
  PersonDraft,
  SpaceDraft,
} from "../lib/editor";
import type { EventPlan } from "../lib/types";
import "./event-editor.css";

export interface EventEditorProps {
  plan: EventPlan | null;
  onSave: (plan: EventPlan) => void;
  onClose: () => void;
}

const zones = [
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];
const matchingName = (left: string, right: string) =>
  left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();

export default function EventEditor({
  plan,
  onSave,
  onClose,
}: EventEditorProps) {
  const [draft, setDraft] = useState<EventDraft>(() => createEventDraft(plan));
  const baseline = useRef(JSON.stringify(draft));
  const [step, setStep] = useState<"basics" | "agenda">("basics");
  const [issues, setIssues] = useState<EditorIssue[]>([]);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [discardWarning, setDiscardWarning] = useState(false);
  const [removed, setRemoved] = useState<{
    activity: ActivityDraft;
    index: number;
  } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const saved = useRef(false);
  const listId = useId();
  const dirty = useMemo(
    () => JSON.stringify(draft) !== baseline.current,
    [draft],
  );
  const title = plan
    ? "A few details make a better plan."
    : "Make the day your own.";

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLInputElement>("#event-name")?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!saved.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (discardWarning) keepEditing.current?.focus();
  }, [discardWarning]);

  const update = (fn: (previous: EventDraft) => EventDraft) => {
    setDraft(fn);
    setIssues([]);
    setDiscardWarning(false);
  };
  const field = (
    key: "name" | "date" | "venue" | "timezone" | "start" | "end" | "asOf",
    value: string,
  ) => update((previous) => ({ ...previous, [key]: value }));
  const editActivity = (id: string, patch: Partial<ActivityDraft>) =>
    update((previous) => ({
      ...previous,
      activities: previous.activities.map((activity) =>
        activity.source.id === id ? { ...activity, ...patch } : activity,
      ),
    }));
  const ensureResources = () =>
    setDraft((previous) => materializeResources(previous));
  const close = () => {
    if (dirty && !saved.current) setDiscardWarning(true);
    else onClose();
  };

  const editSpace = (id: string, patch: Partial<Omit<SpaceDraft, "source">>) =>
    update((previous) => {
      const current = previous.spaces.find((space) => space.source.id === id)!;
      return {
        ...previous,
        spaces: previous.spaces.map((space) =>
          space.source.id === id ? { ...space, ...patch } : space,
        ),
        activities:
          patch.name === undefined
            ? previous.activities
            : previous.activities.map((activity) =>
                matchingName(activity.room, current.name)
                  ? { ...activity, room: patch.name! }
                  : activity,
              ),
      };
    });

  const editPerson = (
    id: string,
    patch: Partial<Omit<PersonDraft, "source">>,
  ) =>
    update((previous) => {
      const current = previous.people.find(
        (person) => person.source.id === id,
      )!;
      return {
        ...previous,
        people: previous.people.map((person) =>
          person.source.id === id ? { ...person, ...patch } : person,
        ),
        activities:
          patch.name === undefined
            ? previous.activities
            : previous.activities.map((activity) =>
                matchingName(activity.owner, current.name)
                  ? { ...activity, owner: patch.name! }
                  : activity,
              ),
      };
    });

  const focusField = (issue: EditorIssue) => {
    setStep(issue.section === "basics" ? "basics" : "agenda");
    if (issue.section === "resources") setResourcesOpen(true);
    const activity = draft.activities.find((item) =>
      issue.field.startsWith(`activity-${item.source.id}-`),
    );
    if (activity && /-(setup|equipment|notes|kind)$/.test(issue.field))
      setExpanded((previous) => [
        ...new Set([...previous, activity.source.id]),
      ]);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const element = document.getElementById(issue.field);
        element?.scrollIntoView({ block: "center", behavior: "smooth" });
        element?.focus();
      }),
    );
  };

  const showIssues = (next: EditorIssue[]) => {
    setIssues(next);
    if (next[0]) focusField(next[0]);
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (step === "basics") {
      const next = basicIssues(draft);
      if (!plan) {
        const main = draft.spaces[0];
        if (!main.name.trim())
          next.push({
            field: "event-main-space",
            message: "Give the main space a name.",
            section: "basics",
          });
        if (
          !/^\d+$/.test(main.capacity) ||
          Number(main.capacity) < 1 ||
          Number(main.capacity) > 100000
        )
          next.push({
            field: "event-main-capacity",
            message: "Confirm how many people the main space can hold.",
            section: "basics",
          });
      }
      if (next.length) {
        showIssues(next);
        return;
      }
      setIssues([]);
      setStep("agenda");
      requestAnimationFrame(() =>
        document
          .getElementById(`activity-${draft.activities[0]?.source.id}-title`)
          ?.focus(),
      );
      return;
    }
    const candidate = materializeResources(draft);
    setDraft(candidate);
    try {
      const validated = buildEditorPlan(candidate);
      onSave(validated);
      saved.current = true;
    } catch (error) {
      saved.current = false;
      showIssues(
        error instanceof EditorValidationError
          ? error.issues
          : [
              {
                field: "editor-error-summary",
                message:
                  error instanceof Error
                    ? error.message
                    : "The event could not be saved. Your previous plan is unchanged.",
                section: "agenda",
              },
            ],
      );
    }
  };

  const inputProps = (id: string) => ({
    id,
    "aria-invalid": issues.some((issue) => issue.field === id) || undefined,
    "aria-describedby": issues.some((issue) => issue.field === id)
      ? `${id}-error`
      : undefined,
  });
  const inlineError = (id: string) => {
    const issue = issues.find((item) => item.field === id);
    return issue ? (
      <span className="ree-field-error" id={`${id}-error`}>
        {issue.message}
      </span>
    ) : null;
  };
  const control = (
    id: string,
    label: string,
    input: ReactNode,
    extraClass = "",
  ) => (
    <div className={`ree-field ${extraClass}`}>
      <label htmlFor={id}>{label}</label>
      {input}
      {inlineError(id)}
    </div>
  );
  const timeType = (value: string) => (value === "24:00" ? "text" : "time");

  return (
    <div
      className="ree-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="ree-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ree-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
          if (event.key === "Tab") {
            const focusable = Array.from(
              dialog.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
              ) ?? [],
            ).filter((element) => element.getClientRects().length > 0);
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
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
        <header className="ree-header">
          <div>
            <span className="ree-eyebrow">YOUR DAY, YOUR DETAILS</span>
            <h2 id="ree-title">{title}</h2>
            <p>
              A single-track day: one shared agenda, with no overlapping
              activities.
            </p>
          </div>
          <button
            type="button"
            className="ree-icon-button"
            aria-label="Close event editor"
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>

        <nav className="ree-steps" aria-label="Event editor steps">
          <button
            type="button"
            aria-current={step === "basics" ? "step" : undefined}
            onClick={() => {
              setStep("basics");
              setIssues([]);
            }}
          >
            <span>1</span>Event details
          </button>
          <div />
          <button
            type="button"
            aria-current={step === "agenda" ? "step" : undefined}
            onClick={() => {
              setStep("agenda");
              setIssues([]);
            }}
          >
            <span>2</span>Agenda
          </button>
        </nav>

        {discardWarning && (
          <div className="ree-discard" role="alert">
            <CircleAlert size={20} />
            <div>
              <strong>Keep your changes?</strong>
              <p>
                Your edits haven’t been saved. Closing now leaves the current
                event unchanged.
              </p>
              <div>
                <button
                  ref={keepEditing}
                  type="button"
                  className="ree-button ree-button-primary"
                  onClick={() => {
                    setDiscardWarning(false);
                    requestAnimationFrame(() =>
                      dialog.current
                        ?.querySelector<HTMLInputElement>(".ree-body input")
                        ?.focus(),
                    );
                  }}
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  className="ree-button"
                  onClick={() => {
                    saved.current = true;
                    onClose();
                  }}
                >
                  Discard changes
                </button>
              </div>
            </div>
          </div>
        )}

        <form noValidate onSubmit={save} className="ree-form">
          <div className="ree-body">
            {issues.length > 0 && (
              <div
                className="ree-errors"
                role="alert"
                tabIndex={-1}
                id="editor-error-summary"
              >
                <div>
                  <CircleAlert size={18} />
                  <strong>
                    {issues.length === 1
                      ? "One detail needs attention."
                      : "A few details need attention."}
                  </strong>
                </div>
                <p>The current event has not changed.</p>
                <ul>
                  {issues.slice(0, 6).map((issue, index) => (
                    <li key={`${issue.field}-${index}`}>
                      <button type="button" onClick={() => focusField(issue)}>
                        {issue.message}
                      </button>
                    </li>
                  ))}
                </ul>
                {issues.length > 6 && (
                  <p>
                    And {issues.length - 6} more. Fix these first, then save
                    again.
                  </p>
                )}
              </div>
            )}

            {step === "basics" && (
              <section className="ree-basics" aria-label="Event details">
                <div className="ree-section-title">
                  <h3>Start with the essentials.</h3>
                  <p>
                    Give your day a name, a place, and a little room to unfold.
                  </p>
                </div>
                <div className="ree-grid">
                  {control(
                    "event-name",
                    "Event name",
                    <input
                      {...inputProps("event-name")}
                      value={draft.name}
                      onChange={(event) => field("name", event.target.value)}
                      placeholder="e.g. Neighborhood Skills Exchange"
                      maxLength={200}
                      autoComplete="off"
                      required
                    />,
                    "ree-span-two",
                  )}
                  {control(
                    "event-venue",
                    "Venue",
                    <input
                      {...inputProps("event-venue")}
                      value={draft.venue}
                      onChange={(event) => field("venue", event.target.value)}
                      placeholder="e.g. Civic Studio"
                      maxLength={200}
                      required
                    />,
                    "ree-span-two",
                  )}
                  {control(
                    "event-date",
                    "Date",
                    <input
                      {...inputProps("event-date")}
                      type="date"
                      value={draft.date}
                      onChange={(event) => field("date", event.target.value)}
                      required
                    />,
                  )}
                  {control(
                    "event-timezone",
                    "Time zone",
                    <>
                      <input
                        {...inputProps("event-timezone")}
                        list={`${listId}-zones`}
                        value={draft.timezone}
                        onChange={(event) =>
                          field("timezone", event.target.value)
                        }
                        placeholder="America/Chicago"
                        required
                      />
                      <datalist id={`${listId}-zones`}>
                        {zones.map((zone) => (
                          <option value={zone} key={zone} />
                        ))}
                      </datalist>
                    </>,
                  )}
                  {control(
                    "event-start",
                    "Day starts",
                    <input
                      {...inputProps("event-start")}
                      type={timeType(draft.start)}
                      value={draft.start}
                      onChange={(event) => field("start", event.target.value)}
                      required
                    />,
                  )}
                  {control(
                    "event-end",
                    "Day ends",
                    <input
                      {...inputProps("event-end")}
                      type={timeType(draft.end)}
                      value={draft.end}
                      onChange={(event) => field("end", event.target.value)}
                      required
                    />,
                  )}
                  {!plan && (
                    <>
                      <div className="ree-field-divider ree-span-two">
                        <DoorOpen size={16} />
                        <span>
                          Your first space. You can add more in the agenda.
                        </span>
                      </div>
                      {control(
                        "event-main-space",
                        "Main space",
                        <input
                          {...inputProps("event-main-space")}
                          value={draft.spaces[0].name}
                          onChange={(event) =>
                            editSpace(draft.spaces[0].source.id, {
                              name: event.target.value,
                            })
                          }
                          maxLength={150}
                          required
                        />,
                      )}
                      {control(
                        "event-main-capacity",
                        "Capacity",
                        <>
                          <input
                            {...inputProps("event-main-capacity")}
                            type="number"
                            min="1"
                            max="100000"
                            step="1"
                            value={draft.spaces[0].capacity}
                            onChange={(event) =>
                              editSpace(draft.spaces[0].source.id, {
                                capacity: event.target.value,
                              })
                            }
                            required
                          />
                          <span className="ree-hint">
                            People this space can safely hold.
                          </span>
                        </>,
                      )}
                    </>
                  )}
                  {plan &&
                    control(
                      "event-asof",
                      "Repair from (optional)",
                      <>
                        <input
                          {...inputProps("event-asof")}
                          type={timeType(draft.asOf)}
                          value={draft.asOf}
                          onChange={(event) =>
                            field("asOf", event.target.value)
                          }
                        />
                        <span className="ree-hint">
                          When repairing later, activities before this time stay
                          fixed. Leave blank to start at opening.
                        </span>
                      </>,
                      "ree-span-two",
                    )}
                </div>
              </section>
            )}

            {step === "agenda" && (
              <section aria-label="Event agenda">
                <div className="ree-section-title ree-agenda-title">
                  <div>
                    <h3>What’s happening, and when?</h3>
                    <p>
                      Start simple. Add timing rules only where you need them.
                    </p>
                  </div>
                  <span>
                    {draft.activities.length}{" "}
                    {draft.activities.length === 1 ? "activity" : "activities"}
                  </span>
                </div>
                <datalist id={`${listId}-people`}>
                  {draft.people.map((person) => (
                    <option key={person.source.id} value={person.name} />
                  ))}
                </datalist>
                <datalist id={`${listId}-spaces`}>
                  {draft.spaces.map((space) => (
                    <option key={space.source.id} value={space.name} />
                  ))}
                </datalist>
                <div className="ree-activities">
                  {draft.activities.map((activity, index) => {
                    const id = activity.source.id;
                    const key = (part: string) => `activity-${id}-${part}`;
                    const open = expanded.includes(id);
                    return (
                      <fieldset className="ree-activity" key={id}>
                        <legend>Activity {index + 1}</legend>
                        <div className="ree-activity-top">
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <button
                            type="button"
                            className="ree-icon-button"
                            aria-label={`Remove activity ${index + 1}`}
                            disabled={draft.activities.length === 1}
                            title={
                              draft.activities.length === 1
                                ? "Keep at least one activity in the event."
                                : "Remove this activity from the draft"
                            }
                            onClick={() => {
                              setRemoved({ activity, index });
                              update((previous) => ({
                                ...previous,
                                activities: previous.activities.filter(
                                  (item) => item.source.id !== id,
                                ),
                              }));
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="ree-grid ree-activity-grid">
                          {control(
                            key("title"),
                            "Title",
                            <input
                              {...inputProps(key("title"))}
                              value={activity.title}
                              onChange={(event) =>
                                editActivity(id, { title: event.target.value })
                              }
                              placeholder="e.g. Opening circle"
                              maxLength={200}
                              required
                            />,
                            "ree-span-two",
                          )}
                          {control(
                            key("start"),
                            "Start time",
                            <input
                              {...inputProps(key("start"))}
                              type={timeType(activity.start)}
                              value={activity.start}
                              onChange={(event) =>
                                editActivity(id, { start: event.target.value })
                              }
                              required
                            />,
                          )}
                          {control(
                            key("duration"),
                            "Duration (minutes)",
                            <input
                              {...inputProps(key("duration"))}
                              type="number"
                              min="1"
                              max="720"
                              step="1"
                              value={activity.duration}
                              onChange={(event) =>
                                editActivity(id, {
                                  duration: event.target.value,
                                })
                              }
                              required
                            />,
                          )}
                          {control(
                            key("owner"),
                            "Owner",
                            <input
                              {...inputProps(key("owner"))}
                              list={`${listId}-people`}
                              value={activity.owner}
                              onChange={(event) =>
                                editActivity(id, { owner: event.target.value })
                              }
                              onBlur={ensureResources}
                              placeholder="Person responsible"
                              maxLength={150}
                              required
                            />,
                          )}
                          {control(
                            key("room"),
                            "Space",
                            <input
                              {...inputProps(key("room"))}
                              list={`${listId}-spaces`}
                              value={activity.room}
                              onChange={(event) =>
                                editActivity(id, { room: event.target.value })
                              }
                              onBlur={ensureResources}
                              placeholder="Choose or name a space"
                              maxLength={150}
                              required
                            />,
                          )}
                          {control(
                            key("attendees"),
                            "Attendees",
                            <input
                              {...inputProps(key("attendees"))}
                              type="number"
                              min="0"
                              max="100000"
                              step="1"
                              value={activity.attendees}
                              onChange={(event) =>
                                editActivity(id, {
                                  attendees: event.target.value,
                                })
                              }
                              required
                            />,
                          )}
                          <div className="ree-lock-field">
                            <label>
                              <input
                                type="checkbox"
                                checked={activity.locked}
                                onChange={(event) =>
                                  editActivity(id, {
                                    locked: event.target.checked,
                                  })
                                }
                              />
                              <span>
                                Keep this time fixed
                                <small>Repairs won’t move this activity.</small>
                              </span>
                            </label>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="ree-details-toggle"
                          aria-expanded={open}
                          aria-controls={`${id}-requirements`}
                          onClick={() =>
                            setExpanded((previous) =>
                              open
                                ? previous.filter((item) => item !== id)
                                : [...previous, id],
                            )
                          }
                        >
                          <Clock3 size={14} />
                          Timing & requirements
                          <ChevronDown
                            size={15}
                            className={open ? "ree-chevron-open" : ""}
                          />
                        </button>
                        {open && (
                          <div
                            id={`${id}-requirements`}
                            className="ree-advanced ree-grid"
                          >
                            {control(
                              key("setup"),
                              "Changeover before (minutes)",
                              <>
                                <input
                                  {...inputProps(key("setup"))}
                                  type="number"
                                  min="0"
                                  max="120"
                                  step="1"
                                  value={activity.setup}
                                  onChange={(event) =>
                                    editActivity(id, {
                                      setup: event.target.value,
                                    })
                                  }
                                  placeholder="0"
                                />
                                <span className="ree-hint">
                                  Time to move people or prepare the space.
                                </span>
                              </>,
                            )}
                            {control(
                              key("kind"),
                              "Display as",
                              <select
                                {...inputProps(key("kind"))}
                                value={activity.kind}
                                onChange={(event) =>
                                  editActivity(id, {
                                    kind: event.target
                                      .value as ActivityDraft["kind"],
                                  })
                                }
                              >
                                <option value="session">Activity</option>
                                <option value="break">Break</option>
                                <option value="fixed">Fixed moment</option>
                              </select>,
                            )}
                            {control(
                              key("equipment"),
                              "Equipment needed",
                              <>
                                <input
                                  {...inputProps(key("equipment"))}
                                  value={activity.equipment}
                                  onChange={(event) =>
                                    editActivity(id, {
                                      equipment: event.target.value,
                                    })
                                  }
                                  placeholder="e.g. screen, microphone"
                                />
                                <span className="ree-hint">
                                  Separate items with commas. Use the same names
                                  as the space’s equipment.
                                </span>
                              </>,
                              "ree-span-two",
                            )}
                            {control(
                              key("notes"),
                              "Notes",
                              <textarea
                                {...inputProps(key("notes"))}
                                value={activity.notes}
                                onChange={(event) =>
                                  editActivity(id, {
                                    notes: event.target.value,
                                  })
                                }
                                placeholder="Anything the activity owner should know"
                                maxLength={2000}
                                rows={2}
                              />,
                              "ree-span-two",
                            )}
                          </div>
                        )}
                      </fieldset>
                    );
                  })}
                </div>
                {removed && (
                  <div className="ree-undo" role="status">
                    <span>
                      Removed {removed.activity.title || "an activity"} from the
                      draft.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        update((previous) => {
                          const activities = [...previous.activities];
                          activities.splice(
                            Math.min(removed.index, activities.length),
                            0,
                            removed.activity,
                          );
                          return { ...previous, activities };
                        });
                        setRemoved(null);
                      }}
                    >
                      Undo
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className="ree-add-activity"
                  id="add-activity"
                  disabled={draft.activities.length >= 36}
                  onClick={() => {
                    const activity = addActivity(draft);
                    update((previous) => ({
                      ...previous,
                      activities: [...previous.activities, activity],
                    }));
                    requestAnimationFrame(() => {
                      const element = document.getElementById(
                        `activity-${activity.source.id}-title`,
                      );
                      element?.scrollIntoView({
                        block: "center",
                        behavior: "smooth",
                      });
                      element?.focus();
                    });
                  }}
                >
                  <Plus size={17} />
                  Add activity<span>{draft.activities.length}/36</span>
                </button>

                <section className="ree-resources">
                  <button
                    type="button"
                    id="resource-heading"
                    className="ree-resources-toggle"
                    aria-expanded={resourcesOpen}
                    aria-controls="ree-resource-content"
                    onClick={() => {
                      ensureResources();
                      setResourcesOpen(!resourcesOpen);
                    }}
                  >
                    <Users size={19} />
                    <span>
                      <strong>People & spaces</strong>
                      <small>
                        Room capacity, equipment, and people’s availability
                      </small>
                    </span>
                    <ChevronDown
                      size={18}
                      className={resourcesOpen ? "ree-chevron-open" : ""}
                    />
                  </button>
                  {resourcesOpen && (
                    <div
                      id="ree-resource-content"
                      className="ree-resource-content"
                    >
                      <p className="ree-resource-intro">
                        Type a new owner or space in the agenda to add it here.
                        Confirm every space’s capacity. Blank availability means
                        the person is available for the event day.
                      </p>
                      <h4>
                        <DoorOpen size={16} />
                        Spaces
                      </h4>
                      <div className="ree-resource-list">
                        {draft.spaces.map((space, index) => (
                          <fieldset
                            key={space.source.id}
                            className="ree-resource-card"
                          >
                            <legend>
                              {space.name || `New space ${index + 1}`}
                            </legend>
                            <div className="ree-grid">
                              {control(
                                `room-${space.source.id}-name`,
                                "Space name",
                                <input
                                  {...inputProps(
                                    `room-${space.source.id}-name`,
                                  )}
                                  value={space.name}
                                  onChange={(event) =>
                                    editSpace(space.source.id, {
                                      name: event.target.value,
                                    })
                                  }
                                  maxLength={150}
                                  required
                                />,
                              )}
                              {control(
                                `room-${space.source.id}-capacity`,
                                "Capacity",
                                <input
                                  {...inputProps(
                                    `room-${space.source.id}-capacity`,
                                  )}
                                  type="number"
                                  min="1"
                                  max="100000"
                                  step="1"
                                  value={space.capacity}
                                  onChange={(event) =>
                                    editSpace(space.source.id, {
                                      capacity: event.target.value,
                                    })
                                  }
                                  placeholder="Confirm capacity"
                                  required
                                />,
                              )}
                              {control(
                                `room-${space.source.id}-equipment`,
                                "Available equipment",
                                <input
                                  {...inputProps(
                                    `room-${space.source.id}-equipment`,
                                  )}
                                  value={space.equipment}
                                  onChange={(event) =>
                                    editSpace(space.source.id, {
                                      equipment: event.target.value,
                                    })
                                  }
                                  placeholder="e.g. screen, wifi, tables"
                                />,
                                "ree-span-two",
                              )}
                            </div>
                            {!draft.activities.some((activity) =>
                              matchingName(activity.room, space.name),
                            ) && (
                              <button
                                type="button"
                                className="ree-remove-unused"
                                onClick={() =>
                                  update((previous) => ({
                                    ...previous,
                                    spaces: previous.spaces.filter(
                                      (item) =>
                                        item.source.id !== space.source.id,
                                    ),
                                  }))
                                }
                              >
                                <Trash2 size={13} />
                                Remove unused space
                              </button>
                            )}
                          </fieldset>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="ree-small-action"
                        disabled={draft.spaces.length >= 12}
                        onClick={() => {
                          const source = {
                            id: editorId("room"),
                            name: "",
                            capacity: 0,
                            equipment: [],
                          };
                          update((previous) => ({
                            ...previous,
                            spaces: [
                              ...previous.spaces,
                              { source, name: "", capacity: "", equipment: "" },
                            ],
                          }));
                          requestAnimationFrame(() =>
                            document
                              .getElementById(`room-${source.id}-name`)
                              ?.focus(),
                          );
                        }}
                      >
                        <Plus size={15} />
                        Add a spare space
                      </button>
                      <h4 className="ree-people-heading">
                        <Users size={16} />
                        People
                      </h4>
                      <div className="ree-resource-list">
                        {draft.people.map((person, index) => (
                          <fieldset
                            key={person.source.id}
                            className="ree-resource-card"
                          >
                            <legend>
                              {person.name || `Person ${index + 1}`}
                            </legend>
                            <div className="ree-grid">
                              {control(
                                `person-${person.source.id}-name`,
                                "Name",
                                <input
                                  {...inputProps(
                                    `person-${person.source.id}-name`,
                                  )}
                                  value={person.name}
                                  onChange={(event) =>
                                    editPerson(person.source.id, {
                                      name: event.target.value,
                                    })
                                  }
                                  maxLength={150}
                                  required
                                />,
                              )}
                              {control(
                                `person-${person.source.id}-role`,
                                "Role",
                                <input
                                  {...inputProps(
                                    `person-${person.source.id}-role`,
                                  )}
                                  value={person.role}
                                  onChange={(event) =>
                                    editPerson(person.source.id, {
                                      role: event.target.value,
                                    })
                                  }
                                  maxLength={150}
                                />,
                              )}
                              {control(
                                `person-${person.source.id}-from`,
                                "Available from",
                                <input
                                  {...inputProps(
                                    `person-${person.source.id}-from`,
                                  )}
                                  type={timeType(person.from)}
                                  value={person.from}
                                  onChange={(event) =>
                                    editPerson(person.source.id, {
                                      from: event.target.value,
                                    })
                                  }
                                />,
                              )}
                              {control(
                                `person-${person.source.id}-until`,
                                "Available until",
                                <input
                                  {...inputProps(
                                    `person-${person.source.id}-until`,
                                  )}
                                  type={timeType(person.until)}
                                  value={person.until}
                                  onChange={(event) =>
                                    editPerson(person.source.id, {
                                      until: event.target.value,
                                    })
                                  }
                                />,
                              )}
                            </div>
                            {!draft.activities.some((activity) =>
                              matchingName(activity.owner, person.name),
                            ) && (
                              <button
                                type="button"
                                className="ree-remove-unused"
                                onClick={() =>
                                  update((previous) => ({
                                    ...previous,
                                    people: previous.people.filter(
                                      (item) =>
                                        item.source.id !== person.source.id,
                                    ),
                                  }))
                                }
                              >
                                <Trash2 size={13} />
                                Remove unused person
                              </button>
                            )}
                          </fieldset>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              </section>
            )}
          </div>
          <footer className="ree-footer">
            <div>
              <span>
                {dirty ? (
                  <>
                    <span className="ree-unsaved-dot" />
                    Unsaved changes
                  </>
                ) : (
                  <>
                    <Check size={13} />
                    {plan
                      ? "Editing a copy of your plan"
                      : "Your event starts here"}
                  </>
                )}
              </span>
              <small>
                {step === "agenda"
                  ? "Save checks times, capacity, equipment, and availability."
                  : "Nothing changes in your workspace until you save."}
              </small>
            </div>
            <div className="ree-footer-actions">
              {step === "agenda" ? (
                <button
                  className="ree-button"
                  type="button"
                  onClick={() => setStep("basics")}
                >
                  <ArrowLeft size={16} />
                  Back
                </button>
              ) : (
                <button className="ree-button" type="button" onClick={close}>
                  Cancel
                </button>
              )}
              <button className="ree-button ree-button-primary" type="submit">
                {step === "basics" ? (
                  <>
                    Build the agenda
                    <ArrowRight size={16} />
                  </>
                ) : (
                  <>
                    Save event
                    <Check size={16} />
                  </>
                )}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}
