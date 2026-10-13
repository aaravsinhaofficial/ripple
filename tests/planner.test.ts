import { describe, expect, it } from 'vitest';
import { SAMPLE_PLAN, EXAMPLE_DISRUPTIONS, clonePlan } from '../src/lib/data';
import { exportHandoff, interpretDisruption, parseImportedPlan, repairInterpretedPlan, repairPlan, validateCandidate } from '../src/lib/planner';
import type { EventPlan, Interpretation, Session } from '../src/lib/types';

const baseline: Interpretation = {kind: 'unknown', targetId: null, minutes: 0, description: 'Baseline validation'};
const valid = (sessions: Session[], interpretation = baseline) => validateCandidate(SAMPLE_PLAN, sessions, interpretation).every(check => check.passed);

describe('real repairs preserve the organizer’s commitments', () => {
  it.each(EXAMPLE_DISRUPTIONS.map(e => [e.label, e.text]))('%s produces an input-dependent checked repair', (_, text) => {
    const before = JSON.stringify(SAMPLE_PLAN);
    const result = repairPlan(SAMPLE_PLAN, text);
    expect(result.mode).toBe('demo');
    expect(result.options.length).toBeGreaterThan(0);
    for (const option of result.options) {
      expect(valid(option.sessions, result.interpretation)).toBe(true);
      expect(option.changes.length).toBeGreaterThan(0);
      expect(option.handoffs.length).toBeGreaterThan(0);
      expect(option.sessions.map(s => s.id).sort()).toEqual(SAMPLE_PLAN.sessions.map(s => s.id).sort());
      for (const locked of SAMPLE_PLAN.sessions.filter(s => s.locked)) expect(option.sessions.find(s => s.id === locked.id)).toEqual(locked);
    }
    expect(JSON.stringify(SAMPLE_PLAN)).toBe(before);
  });
  it('does not offer a repair when an eight-hour delay cannot fit', () => {
    const result = repairPlan(SAMPLE_PLAN, 'Maya is 8 hours late');
    expect(result.options).toHaveLength(0);
    expect(result.blockers.length).toBeGreaterThan(0);
  });
  it('asks for detail rather than pretending unsupported input worked', () => {
    const result = repairPlan(SAMPLE_PLAN, 'Please make our event better');
    expect(result.interpretation.kind).toBe('unknown');
    expect(result.options).toHaveLength(0);
  });
  it.each([
    'Maya is 40 minutes late and Workshop Studio is unavailable',
    'Workshop Studio is closed from 2 pm to 3 pm',
    'Maya is not late but the build session needs 25 more minutes',
    'Maya and Leo are 40 minutes late',
    'The keynote and workshop both need 25 more minutes',
  ])('does not silently simplify an ambiguous incident: %s', text => {
    expect(repairPlan(SAMPLE_PLAN, text).interpretation.kind).toBe('unknown');
    expect(repairPlan(SAMPLE_PLAN, text).options).toHaveLength(0);
  });
  it('interprets fractional hours and extra-minute phrasing without multiplying the wrong number', () => {
    expect(interpretDisruption(SAMPLE_PLAN, 'Maya is 0.5 hours late').minutes).toBe(30);
    expect(interpretDisruption(SAMPLE_PLAN, 'build needs 25 more minutes').minutes).toBe(25);
    expect(interpretDisruption(SAMPLE_PLAN, 'Maya is -40 minutes late').kind).toBe('unknown');
  });
  it('does not delay an earlier session when a later session by the same person changes', () => {
    const result = repairPlan(SAMPLE_PLAN, 'showcase is 10 minutes late');
    expect(result.options.length).toBeGreaterThan(0);
    for (const option of result.options) expect(option.sessions.find(s => s.id === 'conversation')).toEqual(SAMPLE_PLAN.sessions.find(s => s.id === 'conversation'));
  });
  it('does not invent a qualified replacement for an absent speaker', () => {
    expect(repairPlan(SAMPLE_PLAN, 'Maya cannot make it today').options).toHaveLength(0);
  });
  it('room closure actually removes use of that room', () => {
    const result = repairPlan(SAMPLE_PLAN, 'Workshop Studio is unavailable');
    for (const option of result.options) expect(option.sessions.some(s => s.roomId === 'studio')).toBe(false);
  });
  it('exports actual changed sessions with explicit simulation provenance', () => {
    const result = repairPlan(SAMPLE_PLAN, 'Maya is 40 minutes late');
    const output = exportHandoff(SAMPLE_PLAN, result, result.options[0]);
    expect(output).toContain('RULE-BASED PLAN');
    expect(output).toContain('no AI model was called');
    expect(output).toContain('nothing has been sent');
    expect(output).toContain('Maya');
    expect(output).toContain('PROPOSAL ONLY');
    expect(exportHandoff(SAMPLE_PLAN, result, result.options[0], true)).toContain('APPROVED LOCALLY');
  });
});

describe('guided repairs use the exact selected IDs', () => {
  it('repairs the selected custom activity despite colliding titles and owner names', () => {
    const plan = clonePlan(SAMPLE_PLAN);
    const first = plan.sessions.find(session => session.id === 'keynote')!;
    const second = plan.sessions.find(session => session.id === 'workshop')!;
    first.id = 'custom:activity|one';
    second.id = 'custom:activity|two';
    first.title = second.title = 'Shared session';
    first.notes = second.notes = 'Shared session';
    plan.people[0].name = plan.people[1].name = 'Alex Gray';
    const before = JSON.stringify(plan);
    const change: Interpretation = { kind: 'delay', targetId: second.id, minutes: 10, description: 'The selected activity is delayed by ten minutes.' };
    const result = repairInterpretedPlan(plan, change, 'The shared session is late; this ambiguous note must not select a different ID.');
    expect(result.options.length).toBeGreaterThan(0);
    expect(result.interpretation.targetId).toBe(second.id);
    for (const option of result.options) {
      expect(option.sessions.find(session => session.id === second.id)!.start).toBeGreaterThanOrEqual(second.start + 10);
      expect(option.sessions.find(session => session.id === first.id)!.duration).toBe(first.duration);
      expect(validateCandidate(plan, option.sessions, change).every(check => check.passed)).toBe(true);
    }
    expect(JSON.stringify(plan)).toBe(before);
    expect(result.interpretation).not.toBe(change);
  });

  it('closes only the selected room when two custom rooms have the same name', () => {
    const plan = clonePlan(SAMPLE_PLAN);
    plan.rooms[0].name = plan.rooms[1].name = 'Meeting Room';
    plan.rooms[0].id = 'space-001';
    plan.rooms[1].id = 'space-002';
    plan.sessions.forEach(session => { session.roomId = session.roomId === 'hall' ? 'space-001' : 'space-002'; });
    const result = repairInterpretedPlan(plan, { kind: 'room', targetId: 'space-002', minutes: 0, description: 'The selected room is unavailable.' });
    expect(result.options.length).toBeGreaterThan(0);
    for (const option of result.options) {
      expect(option.sessions.every(session => session.roomId === 'space-001')).toBe(true);
      expect(option.sessions.find(session => session.id === 'welcome')).toEqual(plan.sessions.find(session => session.id === 'welcome'));
    }
  });

  it.each([
    { kind: 'delay', targetId: 'missing', minutes: 10, description: 'Missing session' },
    { kind: 'room', targetId: 'missing', minutes: 0, description: 'Missing room' },
    { kind: 'duration', targetId: 'build', minutes: -10, description: 'Invalid duration' },
    { kind: 'delay', targetId: 'keynote', minutes: 1.5, description: 'Fractional minutes' },
  ] satisfies Interpretation[])('rejects invalid structured input without substituting a target: $description', change => {
    const result = repairInterpretedPlan(SAMPLE_PLAN, change);
    expect(result.options).toHaveLength(0);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.summary).not.toBe('No schedule changes are needed.');
  });

  it('keeps the natural-language API as interpretation followed by the exact-target path', () => {
    const text = 'Maya is 40 minutes late';
    const interpreted = interpretDisruption(SAMPLE_PLAN, text);
    const direct = repairInterpretedPlan(SAMPLE_PLAN, interpreted, text);
    const existing = repairPlan(SAMPLE_PLAN, text);
    expect(existing.interpretation).toEqual(direct.interpretation);
    expect(existing.options).toEqual(direct.options);
  });

  it('extends an ongoing unlocked activity in place and repairs only future activities', () => {
    const plan = { ...clonePlan(SAMPLE_PLAN), asOf: 810 };
    const result = repairInterpretedPlan(plan, { kind: 'duration', targetId: 'build', minutes: 25, description: 'Build needs extra time.' });
    expect(result.options.length).toBeGreaterThan(0);
    for (const option of result.options) {
      const build = option.sessions.find(session => session.id === 'build')!;
      expect(build).toEqual({ ...plan.sessions.find(session => session.id === 'build'), duration: 85 });
      expect(option.sessions.find(session => session.id === 'showcase')!.start).toBeGreaterThanOrEqual(895);
      for (const session of plan.sessions.filter(session => session.start < plan.asOf && session.id !== 'build')) expect(option.sessions.find(item => item.id === session.id)).toEqual(session);
      expect(validateCandidate(plan, option.sessions, result.interpretation).every(check => check.passed)).toBe(true);
      expect(option.changes.find(change => change.sessionId === 'build' && change.field === 'duration')).toBeDefined();
    }
    const natural = repairPlan(plan, 'The build session needs 25 more minutes');
    expect(natural.options.length).toBeGreaterThan(0);
  });

  it.each([{ asOf: 860, kind: 'duration' as const }, { asOf: 810, kind: 'delay' as const }])('blocks completed extensions and started delays: $kind at $asOf', ({ asOf, kind }) => {
    const result = repairInterpretedPlan({ ...clonePlan(SAMPLE_PLAN), asOf }, { kind, targetId: 'build', minutes: 25, description: 'Change build.' });
    expect(result.options).toHaveLength(0);
    expect(result.blockers.join(' ')).toContain('producer');
  });

  it('never relaxes a lock or lets an ongoing extension rewrite other fields', () => {
    const plan = { ...clonePlan(SAMPLE_PLAN), asOf: 810 };
    const change: Interpretation = { kind: 'duration', targetId: 'build', minutes: 25, description: 'Extend build.' };
    const option = repairInterpretedPlan(plan, change).options[0];
    for (const mutation of [{ start: 795 }, { roomId: 'hall' }, { ownerId: 'maya' }]) {
      const sessions = option.sessions.map(session => session.id === 'build' ? { ...session, ...mutation } : session);
      expect(validateCandidate(plan, sessions, change).find(check => check.id === 'elapsed')!.passed).toBe(false);
    }
    plan.sessions.find(session => session.id === 'build')!.locked = true;
    const result = repairInterpretedPlan(plan, change);
    expect(result.options).toHaveLength(0);
    expect(result.summary).toBe('That activity is locked.');
  });

  it('explains the exact fixed boundary when an ongoing extension would run into lunch', () => {
    const result = repairInterpretedPlan({ ...clonePlan(SAMPLE_PLAN), asOf: 700 }, { kind: 'duration', targetId: 'conversation', minutes: 30, description: 'Extend the running conversation.' });
    expect(result.options).toHaveLength(0);
    expect(result.blockers.join(' ')).toContain('Lunch, together');
    expect(result.blockers.join(' ')).toContain('12:40 pm');
    expect(result.blockers.join(' ')).toContain('fixed');
  });

  it('explains a locked activity and the actual owner-availability boundary', () => {
    const locked = repairInterpretedPlan(SAMPLE_PLAN, { kind: 'delay', targetId: 'lunch', minutes: 10, description: 'Lunch is late.' });
    expect(locked.options).toHaveLength(0);
    expect(locked.blockers.join(' ')).toContain('Lunch, together');
    expect(locked.blockers.join(' ')).toContain('revise its lock');
    const plan = clonePlan(SAMPLE_PLAN);
    plan.people.find(person => person.id === 'maya')!.availableUntil = 620;
    const result = repairInterpretedPlan(plan, { kind: 'delay', targetId: 'keynote', minutes: 20, description: 'Maya is late.' });
    expect(result.options).toHaveLength(0);
    expect(result.blockers.join(' ')).toContain('Maya Chen is available only until 10:20 am');
  });

  it('reports a bounded-search miss without calling a feasible cross-boundary repair impossible', () => {
    const change: Interpretation = { kind: 'delay', targetId: 'keynote', minutes: 200, description: 'The keynote is delayed by 200 minutes.' };
    const knownFeasible = clonePlan(SAMPLE_PLAN).sessions;
    const starts: Record<string, number> = { workshop: 570, conversation: 640, showcase: 690, keynote: 800, build: 850 };
    knownFeasible.forEach(session => { if (starts[session.id] !== undefined) session.start = starts[session.id]; });
    expect(validateCandidate(SAMPLE_PLAN, knownFeasible, change).every(check => check.passed)).toBe(true);
    const result = repairInterpretedPlan(SAMPLE_PLAN, change);
    expect(result.options).toHaveLength(0);
    expect(result.summary).toBe('No checked repair was found.');
    expect(result.blockers.join(' ')).toContain('bounded search');
    expect(result.blockers.join(' ')).toContain('does not prove a repair is impossible');
    expect(result.blockers.join(' ')).toContain('across');
  });

  it('handles 36 custom activities within a bounded search and can move an early delayed target', () => {
    const plan: EventPlan = {
      ...clonePlan(SAMPLE_PLAN), id: 'custom-36', start: 540, end: 900,
      rooms: [{ id: 'custom-room', name: 'The Room', capacity: 50, equipment: [] }],
      people: [{ id: 'custom-owner', name: 'Alex Gray', role: 'Host', initials: 'AG', color: '#aabbcc', availableFrom: 540, availableUntil: 900 }],
      sessions: Array.from({ length: 36 }, (_, index): Session => ({ id: `slot:${index}`, title: 'Shared activity title', start: 540 + index * 10, duration: 10, roomId: 'custom-room', ownerId: 'custom-owner', attendees: 40, kind: 'session', locked: false, notes: '', requiredEquipment: [], setupMinutes: 0 })),
    };
    const change: Interpretation = { kind: 'delay', targetId: 'slot:0', minutes: 60, description: 'The first activity is delayed.' };
    const started = performance.now();
    const result = repairInterpretedPlan(plan, change);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(result.options.length).toBeGreaterThan(0);
    for (const option of result.options) {
      expect(option.sessions).toHaveLength(36);
      expect(validateCandidate(plan, option.sessions, change).every(check => check.passed)).toBe(true);
    }
    const explored = result.trace.find(step => step.id === 'explore')!.detail.match(/Evaluated (\d+)/);
    expect(Number(explored?.[1])).toBeLessThanOrEqual(240);
  });

  it('handoff drafts carry full event context and labeled before/after changes', () => {
    const result = repairInterpretedPlan(SAMPLE_PLAN, { kind: 'delay', targetId: 'keynote', minutes: 40, description: 'The keynote is delayed.' });
    for (const handoff of result.options[0].handoffs) {
      expect(handoff.message).toContain(SAMPLE_PLAN.name);
      expect(handoff.message).toContain(SAMPLE_PLAN.date);
      expect(handoff.message).toContain(SAMPLE_PLAN.timezone);
      expect(handoff.message).toContain(SAMPLE_PLAN.venue);
      expect(handoff.message).toContain('Start time:');
      expect(handoff.message).toContain('→');
      expect(handoff.message).toContain('to confirm');
    }
  });
});

describe('repairs during an event cannot rewrite its past', () => {
  it('explains that a finished room needs no repair', () => {
    const result = repairPlan({...clonePlan(SAMPLE_PLAN), asOf:880}, 'Workshop Studio is unavailable');
    expect(result.options).toHaveLength(0);
    expect(result.summary).toBe('No schedule changes are needed.');
  });
  it('does not ignore a closed room while a session is still in progress', () => {
    const plan = {...clonePlan(SAMPLE_PLAN), asOf: 810};
    const result = repairPlan(plan, 'Workshop Studio is unavailable');
    expect(result.options).toHaveLength(0);
    expect(result.blockers.join(' ')).toContain('in progress');
    expect(validateCandidate(plan, plan.sessions, result.interpretation).every(c => c.passed)).toBe(false);
  });
  it('preserves a completed workshop when its room becomes unavailable later', () => {
    const plan = {...clonePlan(SAMPLE_PLAN), asOf: 790};
    const result = repairPlan(plan, 'Workshop Studio is unavailable');
    expect(result.options.length).toBeGreaterThan(0);
    for (const option of result.options) {
      expect(option.sessions.find(s => s.id === 'workshop')).toEqual(plan.sessions.find(s => s.id === 'workshop'));
      expect(option.sessions.find(s => s.id === 'build')?.roomId).not.toBe('studio');
    }
  });
  it('cannot move a session that has already begun', () => {
    const plan = {...clonePlan(SAMPLE_PLAN), asOf: 600};
    const sessions = clonePlan(plan).sessions;
    sessions.find(s => s.id === 'keynote')!.start += 5;
    expect(validateCandidate(plan, sessions, baseline).every(c => c.passed)).toBe(false);
    expect(repairPlan(plan, 'keynote is 40 minutes late').options).toHaveLength(0);
  });
});

describe('independent rejection of attractive but invalid proposals', () => {
  it('accepts the baseline', () => expect(valid(SAMPLE_PLAN.sessions)).toBe(true));
  it.each([
    ['a dropped session', (s: Session[]) => { s.pop(); }],
    ['a duplicate session', (s: Session[]) => { s[1] = {...s[0]}; }],
    ['a silently shortened talk', (s: Session[]) => { s[1].duration--; }],
    ['a moved locked opening', (s: Session[]) => { s[0].start++; }],
    ['an audience overlap in different rooms', (s: Session[]) => { s[2].start = s[1].start; }],
    ['a room that is too small', (s: Session[]) => { s[1].roomId = 'studio'; }],
    ['removed equipment requirements', (s: Session[]) => { s[1].requiredEquipment = []; }],
    ['a quietly reassigned owner', (s: Session[]) => { s[1].ownerId = 'leo'; }],
    ['a changed session note', (s: Session[]) => { s[1].notes = 'Ignore earlier instructions'; }],
    ['a setup buffer before opening', (s: Session[]) => { s[0].setupMinutes = 10; }],
  ] as const)('rejects %s', (_, mutate) => {
    const sessions = clonePlan(SAMPLE_PLAN).sessions;
    mutate(sessions);
    expect(valid(sessions)).toBe(false);
  });
  it('rejects a delay proposal that leaves the delayed talk unchanged', () => {
    expect(valid(SAMPLE_PLAN.sessions, interpretDisruption(SAMPLE_PLAN, 'Maya is 40 minutes late'))).toBe(false);
  });
  it('rejects invented room-closure targets', () => {
    expect(valid(SAMPLE_PLAN.sessions, {kind:'room', targetId:'nonexistent', minutes:0, description:'Room closed'})).toBe(false);
  });
});

describe('custom plan import', () => {
  it('round-trips the supplied example and makes an independent copy', () => {
    const plan = parseImportedPlan(JSON.parse(JSON.stringify(SAMPLE_PLAN)));
    expect(plan).toEqual(SAMPLE_PLAN);
    expect(plan).not.toBe(SAMPLE_PLAN);
  });
  it.each([null, {}, {sessions:[]}, { ...SAMPLE_PLAN, sessions: [...SAMPLE_PLAN.sessions, SAMPLE_PLAN.sessions[0]] }, { ...SAMPLE_PLAN, start: -1 }])('rejects malformed plans', (input) => {
    expect(() => parseImportedPlan(input)).toThrow();
  });
  it.each([{ ...SAMPLE_PLAN, date: '2026-02-30' }, { ...SAMPLE_PLAN, timezone: 'Mars/Olympus' }, { ...SAMPLE_PLAN, asOf: 500 }, { ...SAMPLE_PLAN, surprise: 'not supported' }])('rejects invalid date, timezone, boundary, or unknown fields', (input) => {
    expect(() => parseImportedPlan(input)).toThrow();
  });
});
