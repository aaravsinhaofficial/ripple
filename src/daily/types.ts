export type ISODate = string
export type TaskPriority = 'high' | 'normal' | 'low'
export type TaskRecurrence = 'none' | 'daily' | 'weekdays' | 'weekly'

export type ImportProvider = 'ics' | 'csv' | 'notes' | 'json' | 'google-calendar' | 'google-tasks' | 'notion' | 'todoist' | 'granola' | 'otter' | 'github' | 'linear' | 'outlook'

export interface ImportedSource {
  provider: ImportProvider
  label: string
  namespace: string
  externalId: string
  fingerprint: string
  importedAt: string
  url?: string
  sourceDate?: ISODate
}

export interface DailyTask {
  id: string
  title: string
  minutes: number
  priority: TaskPriority
  project: string
  notes: string
  status: 'todo' | 'done'
  dueDate?: ISODate
  dueTime?: number
  earliestDate?: ISODate
  dependsOn: string[]
  splittable: boolean
  recurrence: TaskRecurrence
  seriesId?: string
  createdAt: string
  completedAt?: string
  source?: ImportedSource
}

export interface Commitment {
  id: string
  title: string
  date: ISODate
  start: number
  end: number
  notes: string
  source?: ImportedSource
}

export interface DaySettings {
  date: ISODate
  timezone: string
  start: number
  end: number
  planFrom: number
  breakMinutes: number
  focusMinutes: number
}

export interface Workspace {
  version: 1
  tasks: DailyTask[]
  commitments: Commitment[]
  settings: DaySettings
}

export interface PlanBlock {
  id: string
  kind: 'task' | 'commitment' | 'break'
  taskId?: string
  commitmentId?: string
  title: string
  start: number
  end: number
  part?: number
  parts?: number
}

export type OverflowCode = 'capacity' | 'deadline' | 'dependency' | 'future' | 'invalid'
export interface UnscheduledTask {
  taskId: string
  remainingMinutes: number
  reason: string
  code: OverflowCode
}

export interface DailyCheck {
  id: string
  label: string
  passed: boolean
  detail: string
}

export interface DayPlan {
  date: ISODate
  blocks: PlanBlock[]
  overflow: UnscheduledTask[]
  checks: DailyCheck[]
  summary: string
  scheduledMinutes: number
  availableMinutes: number
  completedTaskIds: string[]
  warnings: string[]
}
