/**
 * @zerolimit/solid-pod-sync/core — Recurrence Utilities
 *
 * Handles iCalendar RRULE (RFC 5545) recurrence rules:
 * - Parsing RRULE strings
 * - Generating occurrences
 * - Building RRULE from user input
 * - Managing exceptions (cancelled/rescheduled instances)
 * 
 * Supports: DAILY, WEEKLY, MONTHLY, YEARLY frequencies
 */

import { randomUUID } from 'crypto';

/**
 * @typedef {Object} RecurrenceRule
 * @property {string} frequency - DAILY, WEEKLY, MONTHLY, YEARLY
 * @property {number} [interval] - Interval between occurrences (default: 1)
 * @property {number} [count] - Number of occurrences
 * @property {Date} [until] - End date for recurrence
 * @property {string[]} [byDay] - Days of week: MO, TU, WE, TH, FR, SA, SU
 * @property {number[]} [byMonth] - Months: 1-12
 * @property {number[]} [byMonthDay] - Days of month: 1-31 or -1 to -31
 * @property {number[]} [bySetPos] - Position in set: 1, 2, 3, 4, -1 (last)
 * @property {string} [weekStart] - Week start day (default: MO)
 */

/**
 * @typedef {Object} RecurringEvent
 * @property {string} id - Event ID
 * @property {string} seriesId - Series identifier (same for all occurrences)
 * @property {Date} start - Start datetime
 * @property {Date} end - End datetime
 * @property {RecurrenceRule} recurrence - Recurrence rule
 * @property {Date[]} [excludedDates] - Dates to skip (cancelled instances)
 * @property {Object[]} [exceptions] - Modified instances
 */

// Day name mappings
const DAY_MAP = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6
};

const DAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * Parse an RRULE string into a RecurrenceRule object
 * @param {string} rruleString - e.g., "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=10"
 * @returns {RecurrenceRule}
 */
export function parseRRule(rruleString) {
  if (!rruleString) return null;
  
  // Remove RRULE: prefix if present
  const ruleStr = rruleString.replace(/^RRULE:/i, '');
  
  const parts = ruleStr.split(';');
  const rule = {};
  
  for (const part of parts) {
    const [key, value] = part.split('=');
    
    switch (key.toUpperCase()) {
      case 'FREQ':
        rule.frequency = value.toUpperCase();
        break;
      case 'INTERVAL':
        rule.interval = parseInt(value, 10);
        break;
      case 'COUNT':
        rule.count = parseInt(value, 10);
        break;
      case 'UNTIL':
        rule.until = parseRRuleDate(value);
        break;
      case 'BYDAY':
        rule.byDay = value.split(',').map(d => d.toUpperCase());
        break;
      case 'BYMONTH':
        rule.byMonth = value.split(',').map(m => parseInt(m, 10));
        break;
      case 'BYMONTHDAY':
        rule.byMonthDay = value.split(',').map(d => parseInt(d, 10));
        break;
      case 'BYSETPOS':
        rule.bySetPos = value.split(',').map(p => parseInt(p, 10));
        break;
      case 'WKST':
        rule.weekStart = value.toUpperCase();
        break;
    }
  }
  
  return rule;
}

/**
 * Build an RRULE string from a RecurrenceRule object
 * @param {RecurrenceRule} rule 
 * @returns {string}
 */
export function buildRRule(rule) {
  if (!rule || !rule.frequency) return '';
  
  const parts = [`FREQ=${rule.frequency.toUpperCase()}`];
  
  if (rule.interval && rule.interval > 1) {
    parts.push(`INTERVAL=${rule.interval}`);
  }
  
  if (rule.count) {
    parts.push(`COUNT=${rule.count}`);
  } else if (rule.until) {
    parts.push(`UNTIL=${formatRRuleDate(rule.until)}`);
  }
  
  if (rule.byDay && rule.byDay.length > 0) {
    parts.push(`BYDAY=${rule.byDay.join(',')}`);
  }
  
  if (rule.byMonth && rule.byMonth.length > 0) {
    parts.push(`BYMONTH=${rule.byMonth.join(',')}`);
  }
  
  if (rule.byMonthDay && rule.byMonthDay.length > 0) {
    parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
  }
  
  if (rule.bySetPos && rule.bySetPos.length > 0) {
    parts.push(`BYSETPOS=${rule.bySetPos.join(',')}`);
  }
  
  if (rule.weekStart && rule.weekStart !== 'MO') {
    parts.push(`WKST=${rule.weekStart}`);
  }
  
  return parts.join(';');
}

// ── Wall-clock time ─────────────────────────────────────────────────────────
//
// A recurring meeting repeats at the same *local* time: 10:00 every Monday
// stays 10:00 when the clocks change. So occurrences are worked out on
// "wall" dates: Date objects whose UTC fields hold the local calendar date
// and time in the event's timezone. Arithmetic on them never crosses a DST
// change, and each result is converted back to a real instant at the end.
// With no timezone given, wall time is UTC.

const DAY_MS = 24 * 60 * 60 * 1000;

function wallFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
}

/** Instant → wall date in `timeZone` (UTC fields hold the local date and time). */
function toWall(instant, timeZone) {
  const date = new Date(instant);
  if (!timeZone) return date;
  const parts = Object.fromEntries(wallFormatter(timeZone).formatToParts(date).map((p) => [p.type, Number(p.value)]));
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second,
    date.getUTCMilliseconds()));
}

/** Wall date in `timeZone` → instant. Two passes settle DST changes. */
function fromWall(wall, timeZone) {
  if (!timeZone) return new Date(wall);
  let instant = wall.getTime();
  for (let i = 0; i < 2; i++) {
    instant += wall.getTime() - toWall(instant, timeZone).getTime();
  }
  return new Date(instant);
}

function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) return false;
  try {
    wallFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Whole days from the Unix epoch to a wall date's day. */
const dayNumber = (wall) => Math.floor(wall.getTime() / DAY_MS);
const wallDateKey = (wall) => wall.toISOString().slice(0, 10);
const daysInMonth = (wall) => new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + 1, 0)).getUTCDate();

/** Parse a BYDAY entry: "MO" → { day: 1 }, "2TU" → { day: 2, nth: 2 }, "-1FR" → { day: 5, nth: -1 }. */
function parseByDay(entry) {
  const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(String(entry).toUpperCase());
  if (!match) return null;
  return { day: DAY_MAP[match[2]], nth: match[1] ? parseInt(match[1], 10) : null };
}

/** Does this wall day's weekday (and its position in the month, if asked) match a BYDAY list? */
function matchesByDay(wall, byDay) {
  const weekday = wall.getUTCDay();
  const dayOfMonth = wall.getUTCDate();
  return byDay.some((entry) => {
    const parsed = parseByDay(entry);
    if (!parsed || parsed.day !== weekday) return false;
    if (parsed.nth === null) return true;
    if (parsed.nth > 0) return Math.ceil(dayOfMonth / 7) === parsed.nth;
    return Math.floor((daysInMonth(wall) - dayOfMonth) / 7) + 1 === -parsed.nth;
  });
}

function matchesByMonthDay(wall, byMonthDay) {
  const dayOfMonth = wall.getUTCDate();
  const total = daysInMonth(wall);
  return byMonthDay.some((d) => (d > 0 ? d === dayOfMonth : total + d + 1 === dayOfMonth));
}

/**
 * How many whole periods (days, weeks, months or years) lie between the
 * period containing the start and the one containing `wall`.
 */
function periodIndex(wall, start, frequency, weekStartDay) {
  switch (frequency) {
    case 'DAILY':
      return dayNumber(wall) - dayNumber(start);
    case 'WEEKLY': {
      // Number each week by the day it starts on (WKST)
      const weekOf = (d) => Math.floor((dayNumber(d) - ((d.getUTCDay() - weekStartDay + 7) % 7)) / 7);
      return weekOf(wall) - weekOf(start);
    }
    case 'MONTHLY':
      return (wall.getUTCFullYear() - start.getUTCFullYear()) * 12 + (wall.getUTCMonth() - start.getUTCMonth());
    case 'YEARLY':
      return wall.getUTCFullYear() - start.getUTCFullYear();
    default:
      return NaN;
  }
}

/**
 * Whether the rule has an occurrence on this wall day.
 *
 * Follows RFC 5545: a day that does not exist is skipped, not moved. A
 * monthly rule that starts on the 31st has no occurrence in a 30-day month,
 * and a yearly rule that starts on 29 February only occurs in leap years.
 * Calendar apps read the RRULE the same way, so what is computed here
 * matches what attendees see in their own calendars.
 */
function occursOn(wall, rule, start, weekStartDay) {
  const frequency = rule.frequency;
  const index = periodIndex(wall, start, frequency, weekStartDay);
  if (!(index >= 0) || index % (rule.interval || 1) !== 0) return false;

  const byDay = rule.byDay?.length ? rule.byDay : null;
  const byMonthDay = rule.byMonthDay?.length ? rule.byMonthDay : null;
  const byMonth = rule.byMonth?.length ? rule.byMonth : null;

  if (byMonth && !byMonth.includes(wall.getUTCMonth() + 1)) return false;
  if (byMonthDay && !matchesByMonthDay(wall, byMonthDay)) return false;
  if (byDay && !matchesByDay(wall, byDay)) return false;

  switch (frequency) {
    case 'DAILY':
      return true;
    case 'WEEKLY':
      return byDay ? true : wall.getUTCDay() === start.getUTCDay();
    case 'MONTHLY':
      return byDay || byMonthDay ? true : wall.getUTCDate() === start.getUTCDate();
    case 'YEARLY':
      if (!byMonth && wall.getUTCMonth() !== start.getUTCMonth()) return false;
      return byDay || byMonthDay ? true : wall.getUTCDate() === start.getUTCDate();
    default:
      return false;
  }
}

/**
 * Generate occurrences for a recurring event
 * @param {Date} startDate - First occurrence start date
 * @param {RecurrenceRule} rule - Recurrence rule
 * @param {Object} options - Generation options
 * @param {Date} [options.rangeStart] - Start of date range to generate
 * @param {Date} [options.rangeEnd] - End of date range to generate
 * @param {number} [options.maxOccurrences] - Maximum occurrences to return (default: 100)
 * @param {Date[]} [options.excludedDates] - Occurrences to leave out (cancelled instances)
 * @param {string} [options.timezone] - IANA timezone the event repeats in. Occurrences
 *   keep the same local time across DST changes. Without it they repeat in UTC.
 * @returns {Date[]} Array of occurrence start dates
 */
export function generateOccurrences(startDate, rule, options = {}) {
  const {
    rangeStart = new Date(startDate),
    rangeEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year default
    maxOccurrences = 100,
    excludedDates = [],
  } = options;

  if (!rule || !rule.frequency) {
    return [new Date(startDate)];
  }

  const frequency = String(rule.frequency).toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(frequency)) return [];
  const normalized = { ...rule, frequency };

  const timeZone = isValidTimeZone(options.timezone) ? options.timezone : null;
  const start = toWall(startDate, timeZone);
  const startInstant = new Date(startDate).getTime();
  const from = new Date(rangeStart).getTime();
  const until = rule.until ? new Date(rule.until).getTime() : Infinity;
  const lastInstant = Math.min(new Date(rangeEnd).getTime(), until);
  const count = Number.isInteger(rule.count) && rule.count > 0 ? rule.count : null;
  const weekStartDay = DAY_MAP[String(rule.weekStart || 'MO').toUpperCase()] ?? 1;
  const timeOfDay = start.getTime() - dayNumber(start) * DAY_MS;

  // Cancelled instances, by local calendar day
  const excluded = new Set(excludedDates.map((d) => wallDateKey(toWall(d, timeZone))));

  // COUNT is counted from the first occurrence, so a counted series must be
  // walked from its start. An uncounted one can begin at the range: whether
  // a day is an occurrence is worked out from the calendar, not by stepping
  // from the start, so a series can run for decades.
  const firstDay = dayNumber(start);
  const rangeFirstDay = dayNumber(toWall(from, timeZone)) - 1;
  const lastDay = dayNumber(toWall(lastInstant, timeZone)) + 1;
  let day = count === null ? Math.max(firstDay, rangeFirstDay) : firstDay;

  const occurrences = [];
  let seen = 0;

  for (; day <= lastDay && occurrences.length < maxOccurrences; day++) {
    const wall = new Date(day * DAY_MS + timeOfDay);
    if (!occursOn(wall, normalized, start, weekStartDay)) continue;

    const instant = fromWall(wall, timeZone).getTime();
    if (instant < startInstant) continue;
    if (instant > lastInstant) break;

    // Cancelled instances still count towards COUNT (RFC 5545)
    seen++;
    if (count !== null && seen > count) break;

    if (instant >= from && !excluded.has(wallDateKey(wall))) {
      occurrences.push(new Date(instant));
    }
  }

  return occurrences;
}

/**
 * Parse RRULE date format (YYYYMMDD or YYYYMMDDTHHMMSSZ)
 */
function parseRRuleDate(dateStr) {
  if (!dateStr) return null;
  
  const match = dateStr.match(/^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})Z?)?$/);
  if (!match) return new Date(dateStr);
  
  const [, year, month, day, , hour, minute, second] = match;
  
  if (hour) {
    return new Date(Date.UTC(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second) || 0
    ));
  }
  
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
}

/**
 * Format date for RRULE (YYYYMMDDTHHMMSSZ)
 */
function formatRRuleDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Create a human-readable description of a recurrence rule
 * @param {RecurrenceRule} rule 
 * @returns {string}
 */
export function describeRecurrence(rule) {
  if (!rule || !rule.frequency) return 'Does not repeat';
  
  const parts = [];
  const interval = rule.interval || 1;
  
  // Frequency
  switch (rule.frequency) {
    case 'DAILY':
      parts.push(interval === 1 ? 'Daily' : `Every ${interval} days`);
      break;
    case 'WEEKLY':
      parts.push(interval === 1 ? 'Weekly' : `Every ${interval} weeks`);
      break;
    case 'MONTHLY':
      parts.push(interval === 1 ? 'Monthly' : `Every ${interval} months`);
      break;
    case 'YEARLY':
      parts.push(interval === 1 ? 'Yearly' : `Every ${interval} years`);
      break;
  }
  
  // Days
  if (rule.byDay && rule.byDay.length > 0) {
    const dayNames = rule.byDay.map(d => {
      const match = d.match(/^(-?\d)?(\w{2})$/);
      if (!match) return d;
      
      const [, nth, day] = match;
      const fullDay = { MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday' }[day];
      
      if (nth) {
        const n = parseInt(nth, 10);
        const ordinal = n === -1 ? 'last' : ['', 'first', 'second', 'third', 'fourth'][n] || `${n}th`;
        return `${ordinal} ${fullDay}`;
      }
      
      return fullDay;
    });
    
    parts.push(`on ${dayNames.join(', ')}`);
  }
  
  // End condition
  if (rule.count) {
    parts.push(`for ${rule.count} times`);
  } else if (rule.until) {
    const untilDate = new Date(rule.until);
    parts.push(`until ${untilDate.toLocaleDateString()}`);
  }
  
  return parts.join(' ');
}

/**
 * Create common recurrence presets
 */
export const RECURRENCE_PRESETS = {
  none: null,
  daily: { frequency: 'DAILY', interval: 1 },
  weekdays: { frequency: 'WEEKLY', interval: 1, byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] },
  weekly: { frequency: 'WEEKLY', interval: 1 },
  biweekly: { frequency: 'WEEKLY', interval: 2 },
  monthly: { frequency: 'MONTHLY', interval: 1 },
  yearly: { frequency: 'YEARLY', interval: 1 },
};

/**
 * Get the next occurrence after a given date
 */
export function getNextOccurrence(startDate, rule, afterDate = new Date(), options = {}) {
  const occurrences = generateOccurrences(startDate, rule, {
    rangeStart: afterDate,
    // An open-ended series always has a next occurrence; look far enough ahead for yearly rules
    rangeEnd: new Date(new Date(afterDate).getTime() + 10 * 366 * DAY_MS),
    maxOccurrences: 1,
    timezone: options.timezone,
  });
  return occurrences[0] || null;
}

/**
 * Check if two dates are the same occurrence (same day)
 */
export function isSameOccurrence(date1, date2) {
  return date1.toISOString().split('T')[0] === date2.toISOString().split('T')[0];
}

/**
 * Generate a series ID for recurring events
 */
export function generateSeriesId() {
  return `series-${randomUUID()}`;
}

/**
 * Expand a recurring event into individual occurrences with full event data
 * @param {RecurringEvent} event - The recurring event
 * @param {Object} options - Expansion options (rangeStart, rangeEnd, maxOccurrences, timezone)
 * @returns {Array} Array of individual event occurrences
 */
export function expandRecurringEvent(event, options = {}) {
  const { rangeStart, rangeEnd, maxOccurrences = 50 } = options;
  
  if (!event.recurrence || !event.recurrence.frequency) {
    return [{
      ...event,
      isRecurring: false,
      occurrenceDate: new Date(event.start),
    }];
  }
  
  const occurrenceDates = generateOccurrences(
    new Date(event.start),
    event.recurrence,
    {
      rangeStart,
      rangeEnd,
      maxOccurrences,
      excludedDates: event.excludedDates || [],
      timezone: options.timezone || event.timezone,
    }
  );
  
  const duration = new Date(event.end) - new Date(event.start);
  
  return occurrenceDates.map(occurrenceDate => {
    // Check for exceptions (modified instances)
    const exception = event.exceptions?.find(ex => 
      isSameOccurrence(new Date(ex.originalDate), occurrenceDate)
    );
    
    if (exception) {
      return {
        ...event,
        ...exception,
        id: `${event.id}_${occurrenceDate.toISOString()}`,
        seriesId: event.seriesId || event.id,
        isRecurring: true,
        isException: true,
        occurrenceDate,
      };
    }
    
    const occurrenceEnd = new Date(occurrenceDate.getTime() + duration);
    
    return {
      ...event,
      id: `${event.id}_${occurrenceDate.toISOString()}`,
      seriesId: event.seriesId || event.id,
      start: occurrenceDate,
      end: occurrenceEnd,
      isRecurring: true,
      isException: false,
      occurrenceDate,
    };
  });
}

export default {
  parseRRule,
  buildRRule,
  generateOccurrences,
  describeRecurrence,
  getNextOccurrence,
  isSameOccurrence,
  generateSeriesId,
  expandRecurringEvent,
  RECURRENCE_PRESETS,
  DAY_MAP,
  DAY_NAMES,
};
