import { describe, expect, it } from 'vitest';
import { parseScripture, splitBySensitivity, validateAnswers, type FieldDefinition } from '@/server/modules/forms/answers';

const field = (key: string, type: FieldDefinition['type'], extra: Partial<FieldDefinition> = {}): FieldDefinition => ({
  key,
  type,
  label: key,
  helpText: null,
  required: false,
  sensitivity: 'standard',
  config: {},
  ...extra,
});

const FIELDS: FieldDefinition[] = [
  field('reflection', 'reflection', { required: true }),
  field('prayed', 'yes_no', { required: true }),
  field('scripture', 'scripture_ref'),
  field('mood', 'single_choice', { config: { options: [{ key: 'good', label: 'Good' }, { key: 'hard', label: 'Hard' }] } }),
  field('areas', 'multi_choice', { config: { options: [{ key: 'family', label: 'Family' }, { key: 'work', label: 'Work' }] } }),
  field('minutes', 'number', { config: { min: 0, max: 600 } }),
  field('request', 'prayer_request', { sensitivity: 'restricted' }),
  field('private', 'long_text', { sensitivity: 'confidential', config: { maxLength: 20 } }),
];

describe('answer validation', () => {
  it('accepts a complete journal and normalises values', () => {
    const outcome = validateAnswers(FIELDS, {
      reflection: '  God is faithful.\r\nAmen ',
      prayed: 'yes',
      scripture: 'John 3:16-21',
      mood: 'good',
      areas: ['family', 'family', 'work'],
      minutes: '15',
      request: 'For my mother',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.answers.reflection).toEqual({ t: 'text', v: 'God is faithful.\nAmen' });
    expect(outcome.answers.prayed).toEqual({ t: 'bool', v: true });
    expect(outcome.answers.areas).toEqual({ t: 'choices', v: ['family', 'work'] });
    expect(outcome.answers.minutes).toEqual({ t: 'number', v: 15 });
  });

  it('reports required, invalid and over-long answers per field', () => {
    const outcome = validateAnswers(FIELDS, { reflection: '   ', mood: 'unknown', minutes: '999', private: 'x'.repeat(21) });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(Object.keys(outcome.fieldErrors).sort()).toEqual(['minutes', 'mood', 'prayed', 'private', 'reflection']);
  });

  it('rejects answers to questions that are not on the form', () => {
    const outcome = validateAnswers(FIELDS, { reflection: 'ok', prayed: false, removed_question: 'x' });
    expect(outcome).toMatchObject({ ok: false, fieldErrors: { _: expect.any(Array) } });
  });

  it('splits answers by sensitivity tier', () => {
    const outcome = validateAnswers(FIELDS, { reflection: 'ok', prayed: false, request: 'help', private: 'secret' });
    if (!outcome.ok) throw new Error('expected valid');
    const sets = splitBySensitivity(FIELDS, outcome.answers);
    expect(Object.keys(sets.standard!)).toEqual(['reflection', 'prayed']);
    expect(Object.keys(sets.restricted!)).toEqual(['request']);
    expect(Object.keys(sets.confidential!)).toEqual(['private']);
  });
});

describe('scripture references', () => {
  it('parses common formats and keeps free text', () => {
    expect(parseScripture('John 3:16–21').v).toMatchObject({ book: 'John', chapter: 3, verseStart: 16, verseEnd: 21 });
    expect(parseScripture('1 Corinthians 13').v).toMatchObject({ book: '1 Corinthians', chapter: 13 });
    expect(parseScripture('Awit 23:1').v).toMatchObject({ book: 'Awit', chapter: 23, verseStart: 1 });
    expect(parseScripture('the sermon notes').v).toEqual({ raw: 'the sermon notes' });
  });
});
