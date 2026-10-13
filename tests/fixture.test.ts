import { describe, expect, it } from 'vitest';
import { SAMPLE_PLAN, clonePlan } from '../src/lib/data';

describe('the example event is a valid baseline', () => {
  it('contains no conflicting sessions, insufficient rooms, or unknown owners', () => {
    const sessions = [...SAMPLE_PLAN.sessions].sort((a, b) => a.start - b.start);
    expect(new Set(sessions.map(s => s.id)).size).toBe(sessions.length);
    for (const [i, s] of sessions.entries()) {
      const room = SAMPLE_PLAN.rooms.find(r => r.id === s.roomId)!;
      expect(room, `Room for ${s.id}`).toBeDefined();
      expect(SAMPLE_PLAN.people.some(p => p.id === s.ownerId)).toBe(true);
      expect(s.start).toBeGreaterThanOrEqual(SAMPLE_PLAN.start);
      expect(s.start + s.duration).toBeLessThanOrEqual(SAMPLE_PLAN.end);
      expect(room.capacity).toBeGreaterThanOrEqual(s.attendees);
      expect(s.requiredEquipment.every(e => room.equipment.includes(e))).toBe(true);
      if (i > 0) expect(s.start - (s.setupMinutes ?? 0)).toBeGreaterThanOrEqual(sessions[i-1].start + sessions[i-1].duration);
    }
  });
  it('never mutates the seed when a plan is copied', () => {
    const copy = clonePlan(SAMPLE_PLAN);
    copy.sessions[0].title = 'Changed';
    copy.rooms[0].equipment.push('new');
    expect(SAMPLE_PLAN.sessions[0].title).not.toBe('Changed');
    expect(SAMPLE_PLAN.rooms[0].equipment).not.toContain('new');
  });
});
