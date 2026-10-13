import { describe, expect, it } from 'vitest';
import { buildServerSchema, collectChangeDecisionGroups } from '../src';
import { ReviewSession } from './session';
import { samples } from './samples';

const schema = buildServerSchema();
const canonical = (value: unknown) => schema.nodeFromJSON(value).toJSON();

describe('demo review sessions', () => {
  for (const sample of samples) {
    it(`${sample.label}: accepting all reproduces the proposed document`, () => {
      const session = new ReviewSession(sample.original, sample.proposed);
      expect(session.groups.length).toBeGreaterThan(0);
      session.decideAll('accept');
      expect(session.document).toEqual(canonical(sample.proposed));
      expect(session.groups).toHaveLength(0);
    });
    it(`${sample.label}: rejecting all restores the original document`, () => {
      const session = new ReviewSession(sample.original, sample.proposed);
      session.decideAll('reject');
      expect(session.document).toEqual(canonical(sample.original));
    });
  }
  it('decides one entire group while preserving other pending groups', () => {
    const session = new ReviewSession(samples[0].original, samples[0].proposed);
    const before = session.groups.map(group => group.key);
    session.decideGroup(before[0], 'accept');
    expect(session.groups.map(group => group.key)).toEqual(before.slice(1));
    expect(collectChangeDecisionGroups(schema.nodeFromJSON(session.document))).toHaveLength(before.length - 1);
  });
  it('supports mixed decisions and undo without changing source drafts', () => {
    const original = structuredClone(samples[0].original);
    const proposed = structuredClone(samples[0].proposed);
    const session = new ReviewSession(original, proposed);
    const initial = structuredClone(session.document);
    session.decideGroup(session.groups[0].key, 'accept');
    const afterAccept = structuredClone(session.document);
    session.decideGroup(session.groups[0].key, 'reject');
    session.undo();
    expect(session.document).toEqual(afterAccept);
    session.undo();
    expect(session.document).toEqual(initial);
    expect(session.canUndo).toBe(false);
    expect(original).toEqual(samples[0].original);
    expect(proposed).toEqual(samples[0].proposed);
  });
  it('rejects stale groups without changing the current document', () => {
    const session = new ReviewSession(samples[0].original, samples[0].proposed);
    const key = session.groups[0].key;
    session.decideGroup(key, 'accept');
    const before = structuredClone(session.document);
    expect(() => session.decideGroup(key, 'reject')).toThrow('no longer pending');
    expect(session.document).toEqual(before);
  });
  it('compares identical documents as a completed review', () => {
    const session = new ReviewSession(samples[0].original, samples[0].original);
    expect(session.groups).toHaveLength(0);
    expect(session.document).toEqual(canonical(samples[0].original));
    expect(session.canUndo).toBe(false);
  });
  it('surfaces invalid input instead of dropping it', () => {
    expect(() => new ReviewSession(samples[0].original, { type: 'unknown' })).toThrow();
  });
});
