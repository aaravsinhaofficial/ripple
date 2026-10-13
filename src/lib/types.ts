export type SessionKind = 'session' | 'break' | 'fixed'

export interface Session {
  id: string
  title: string
  start: number
  duration: number
  roomId: string
  ownerId: string
  attendees: number
  kind: SessionKind
  locked: boolean
  notes: string
  requiredEquipment: string[]
  setupMinutes?: number
}

export interface Room {
  id: string
  name: string
  capacity: number
  equipment: string[]
}

export interface Person {
  id: string
  name: string
  role: string
  initials: string
  color: string
  availableFrom?: number
  availableUntil?: number
}

export interface EventPlan {
  id: string
  name: string
  date: string
  timezone: string
  venue: string
  start: number
  end: number
  asOf?: number
  sessions: Session[]
  rooms: Room[]
  people: Person[]
}

export interface Interpretation {
  kind: 'delay' | 'room' | 'duration' | 'absence' | 'unknown'
  targetId: string | null
  minutes: number
  description: string
}

export interface PlanChange {
  sessionId: string
  field: 'start' | 'roomId' | 'duration' | 'ownerId'
  before: string
  after: string
  reason: string
}

export interface ConstraintCheck {
  id: string
  label: string
  passed: boolean
  detail: string
}

export interface Handoff { personId: string; title: string; message: string }

export interface RepairOption {
  id: string
  title: string
  description: string
  sessions: Session[]
  changes: PlanChange[]
  checks: ConstraintCheck[]
  handoffs: Handoff[]
  score: number
  tradeoff: string
}

export interface TraceStep {
  id: string
  label: string
  detail: string
  status: 'complete' | 'running' | 'pending'
  model?: string
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  provider?: string
}

export interface Source { title: string; url: string; snippet: string; retrievedAt?: string }

export interface RepairResult {
  id: string
  mode: 'demo' | 'live'
  summary: string
  interpretation: Interpretation
  options: RepairOption[]
  blockers: string[]
  trace: TraceStep[]
  sources?: Source[]
}

export interface RepairRequest { plan: EventPlan; disruption: string; confirmedChange?: Interpretation }
