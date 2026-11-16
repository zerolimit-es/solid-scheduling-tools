import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateOccurrences, expandRecurringEvent, getNextOccurrence } from '../src/core/recurrence.js';

const iso = (dates) => dates.map((d) => d.toISOString().slice(0, 16));
const FAR = new Date('2045-01-01T00:00:00Z');

describe('generateOccurrences: basics', () => {
  it('returns the start alone when there is no rule', () => {
    assert.deepEqual(iso(generateOccurrences(new Date('2030-01-07T09:00Z'), null)), ['2030-01-07T09:00']);
  });

  it('repeats daily, weekly, every other week, monthly and yearly', () => {
    const start = new Date('2030-01-07T09:00Z'); // a Monday
    const first3 = (rule) => iso(generateOccurrences(start, rule, { rangeEnd: FAR, maxOccurrences: 3 }));
    assert.deepEqual(first3({ frequency: 'DAILY' }), ['2030-01-07T09:00', '2030-01-08T09:00', '2030-01-09T09:00']);
    assert.deepEqual(first3({ frequency: 'WEEKLY' }), ['2030-01-07T09:00', '2030-01-14T09:00', '2030-01-21T09:00']);
    assert.deepEqual(first3({ frequency: 'WEEKLY', interval: 2 }), ['2030-01-07T09:00', '2030-01-21T09:00', '2030-02-04T09:00']);
    assert.deepEqual(first3({ frequency: 'MONTHLY' }), ['2030-01-07T09:00', '2030-02-07T09:00', '2030-03-07T09:00']);
    assert.deepEqual(first3({ frequency: 'YEARLY' }), ['2030-01-07T09:00', '2031-01-07T09:00', '2032-01-07T09:00']);
  });

  it('repeats on the listed weekdays, starting no earlier than the first occurrence', () => {
    // Starts on a Wednesday; Monday of that week is before the start
    const result = generateOccurrences(new Date('2030-01-09T09:00Z'), { frequency: 'WEEKLY', byDay: ['MO', 'WE', 'FR'] },
      { rangeEnd: FAR, maxOccurrences: 4 });
    assert.deepEqual(iso(result), ['2030-01-09T09:00', '2030-01-11T09:00', '2030-01-14T09:00', '2030-01-16T09:00']);
  });

  it('keeps every-other-week alignment with several weekdays', () => {
    const result = generateOccurrences(new Date('2030-01-07T09:00Z'), { frequency: 'WEEKLY', interval: 2, byDay: ['MO', 'TH'] },
      { rangeEnd: FAR, maxOccurrences: 4 });
    assert.deepEqual(iso(result), ['2030-01-07T09:00', '2030-01-10T09:00', '2030-01-21T09:00', '2030-01-24T09:00']);
  });

  it('supports the nth and the last weekday of the month, and days of the month', () => {
    const start = new Date('2030-01-08T09:00Z'); // second Tuesday of January
    const first3 = (rule) => iso(generateOccurrences(start, rule, { rangeEnd: FAR, maxOccurrences: 3 }));
    assert.deepEqual(first3({ frequency: 'MONTHLY', byDay: ['2TU'] }), ['2030-01-08T09:00', '2030-02-12T09:00', '2030-03-12T09:00']);
    assert.deepEqual(first3({ frequency: 'MONTHLY', byDay: ['-1FR'] }), ['2030-01-25T09:00', '2030-02-22T09:00', '2030-03-29T09:00']);
    assert.deepEqual(first3({ frequency: 'MONTHLY', byMonthDay: [15] }), ['2030-01-15T09:00', '2030-02-15T09:00', '2030-03-15T09:00']);
    assert.deepEqual(first3({ frequency: 'MONTHLY', byMonthDay: [-1] }), ['2030-01-31T09:00', '2030-02-28T09:00', '2030-03-31T09:00']);
  });

  it('stops at UNTIL, inclusive', () => {
    const result = generateOccurrences(new Date('2030-01-07T09:00Z'),
      { frequency: 'DAILY', until: new Date('2030-01-09T09:00Z') }, { rangeEnd: FAR });
    assert.deepEqual(iso(result), ['2030-01-07T09:00', '2030-01-08T09:00', '2030-01-09T09:00']);
  });

  it('accepts a lower-case frequency and ignores an unknown one', () => {
    assert.equal(generateOccurrences(new Date('2030-01-07T09:00Z'), { frequency: 'daily', count: 2 }, { rangeEnd: FAR }).length, 2);
    assert.deepEqual(generateOccurrences(new Date('2030-01-07T09:00Z'), { frequency: 'HOURLY' }, { rangeEnd: FAR }), []);
  });
});

describe('generateOccurrences: COUNT is counted from the first occurrence', () => {
  const start = new Date('2030-01-01T09:00Z');

  it('ends the series after COUNT occurrences, whatever period is viewed', () => {
    const rule = { frequency: 'DAILY', count: 3 };
    assert.equal(generateOccurrences(start, rule, { rangeEnd: FAR }).length, 3);
    assert.deepEqual(generateOccurrences(start, rule, { rangeStart: new Date('2030-01-10T00:00Z'), rangeEnd: FAR }), []);
    assert.deepEqual(iso(generateOccurrences(start, rule, { rangeStart: new Date('2030-01-03T00:00Z'), rangeEnd: FAR })),
      ['2030-01-03T09:00']);
  });

  it('counts a cancelled occurrence: cancelling one does not add another at the end', () => {
    const result = generateOccurrences(start, { frequency: 'DAILY', count: 3 },
      { rangeEnd: FAR, excludedDates: [new Date('2030-01-02T09:00Z')] });
    assert.deepEqual(iso(result), ['2030-01-01T09:00', '2030-01-03T09:00']);
  });
});

describe('generateOccurrences: days that do not exist are skipped, as calendar apps do', () => {
  it('a monthly series on the 31st skips shorter months and stays on the 31st', () => {
    const result = generateOccurrences(new Date('2030-01-31T09:00Z'), { frequency: 'MONTHLY' }, { rangeEnd: FAR, maxOccurrences: 4 });
    assert.deepEqual(iso(result), ['2030-01-31T09:00', '2030-03-31T09:00', '2030-05-31T09:00', '2030-07-31T09:00']);
  });

  it('a yearly series on 29 February occurs in leap years only', () => {
    const result = generateOccurrences(new Date('2028-02-29T09:00Z'), { frequency: 'YEARLY' }, { rangeEnd: FAR, maxOccurrences: 3 });
    assert.deepEqual(iso(result), ['2028-02-29T09:00', '2032-02-29T09:00', '2036-02-29T09:00']);
  });
});

describe('generateOccurrences: long-running series', () => {
  it('still produces occurrences many years after it started', () => {
    const week = { rangeStart: new Date('2040-03-05T00:00Z'), rangeEnd: new Date('2040-03-12T00:00Z') };
    assert.equal(generateOccurrences(new Date('2026-01-01T09:00Z'), { frequency: 'DAILY' }, week).length, 7);
    assert.deepEqual(iso(generateOccurrences(new Date('2027-01-04T09:00Z'), { frequency: 'WEEKLY', byDay: ['MO', 'WE'] }, week)),
      ['2040-03-05T09:00', '2040-03-07T09:00']);
    assert.deepEqual(iso(generateOccurrences(new Date('2026-01-15T09:00Z'), { frequency: 'MONTHLY' },
      { rangeStart: new Date('2040-03-01T00:00Z'), rangeEnd: new Date('2040-04-01T00:00Z') })), ['2040-03-15T09:00']);
  });
});

describe('generateOccurrences: timezone', () => {
  // Paris switches to summer time on 31 March 2030 and back on 27 October 2030
  const start = new Date('2030-03-18T09:00Z'); // 10:00 in Paris

  it('keeps the same local time across a clock change', () => {
    const result = generateOccurrences(start, { frequency: 'WEEKLY' }, { rangeEnd: FAR, maxOccurrences: 4, timezone: 'Europe/Paris' });
    assert.deepEqual(iso(result), ['2030-03-18T09:00', '2030-03-25T09:00', '2030-04-01T08:00', '2030-04-08T08:00']);
  });

  it('repeats in UTC when no timezone is given, whatever the machine timezone', () => {
    const result = generateOccurrences(start, { frequency: 'WEEKLY' }, { rangeEnd: FAR, maxOccurrences: 4 });
    assert.deepEqual(iso(result), ['2030-03-18T09:00', '2030-03-25T09:00', '2030-04-01T09:00', '2030-04-08T09:00']);
  });

  it('decides the weekday by the local date, not the UTC date', () => {
    // 23:30 UTC on Sunday is 09:30 on Monday in Sydney
    const result = generateOccurrences(new Date('2030-01-06T22:30Z'), { frequency: 'WEEKLY', byDay: ['MO'] },
      { rangeEnd: FAR, maxOccurrences: 2, timezone: 'Australia/Sydney' });
    assert.deepEqual(iso(result), ['2030-01-06T22:30', '2030-01-13T22:30']);
  });

  it('matches a cancelled occurrence by its local day', () => {
    const result = generateOccurrences(start, { frequency: 'WEEKLY' },
      { rangeEnd: FAR, maxOccurrences: 3, timezone: 'Europe/Paris', excludedDates: [new Date('2030-04-01T08:00Z')] });
    assert.deepEqual(iso(result), ['2030-03-18T09:00', '2030-03-25T09:00', '2030-04-08T08:00']);
  });

  it('falls back to UTC for an unknown timezone name', () => {
    const result = generateOccurrences(start, { frequency: 'DAILY', count: 2 }, { rangeEnd: FAR, timezone: 'Mars/Olympus' });
    assert.deepEqual(iso(result), ['2030-03-18T09:00', '2030-03-19T09:00']);
  });
});

describe('expandRecurringEvent and getNextOccurrence', () => {
  const event = {
    id: 'booking-1',
    start: new Date('2030-03-18T09:00Z'),
    end: new Date('2030-03-18T10:00Z'),
    recurrence: { frequency: 'WEEKLY' },
    excludedDates: [],
  };

  it('gives each occurrence the event length and the local time', () => {
    const occurrences = expandRecurringEvent(event, {
      rangeStart: new Date('2030-04-01T00:00Z'), rangeEnd: new Date('2030-04-02T00:00Z'), timezone: 'Europe/Paris',
    });
    assert.equal(occurrences.length, 1);
    assert.equal(occurrences[0].start.toISOString(), '2030-04-01T08:00:00.000Z');
    assert.equal(occurrences[0].end.toISOString(), '2030-04-01T09:00:00.000Z');
    assert.equal(occurrences[0].seriesId, 'booking-1');
  });

  it('finds the next occurrence of a series that started long ago', () => {
    const next = getNextOccurrence(new Date('2020-01-06T09:00Z'), { frequency: 'WEEKLY' }, new Date('2030-03-19T00:00Z'));
    assert.equal(next.toISOString(), '2030-03-25T09:00:00.000Z');
    assert.equal(getNextOccurrence(new Date('2020-01-06T09:00Z'), { frequency: 'WEEKLY', count: 2 }, new Date('2030-03-19T00:00Z')), null);
  });
});
