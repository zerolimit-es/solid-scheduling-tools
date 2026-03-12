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

const FREQUENCY_ORDER = ['YEARLY', 'MONTHLY', 'WEEKLY', 'DAILY'];

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

/**
 * Generate occurrences for a recurring event
 * @param {Date} startDate - First occurrence start date
 * @param {RecurrenceRule} rule - Recurrence rule
 * @param {Object} options - Generation options
 * @param {Date} [options.rangeStart] - Start of date range to generate
 * @param {Date} [options.rangeEnd] - End of date range to generate
 * @param {number} [options.maxOccurrences] - Maximum occurrences to generate (default: 100)
 * @param {Date[]} [options.excludedDates] - Dates to exclude
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
  
  const occurrences = [];
  const interval = rule.interval || 1;
  const count = rule.count || maxOccurrences;
  const until = rule.until ? new Date(rule.until) : rangeEnd;
  
  // Normalize excluded dates to date strings for comparison
  const excludedSet = new Set(
    excludedDates.map(d => new Date(d).toISOString().split('T')[0])
  );
  
  let current = new Date(startDate);
  let generated = 0;
  let iterations = 0;
  const maxIterations = maxOccurrences * 10; // Safety limit
  
  while (generated < count && current <= until && iterations < maxIterations) {
    iterations++;
    
    // Check if current date matches the rule
    if (matchesRule(current, rule, startDate)) {
      // Check if in range and not excluded
      if (current >= rangeStart && current <= rangeEnd) {
        const dateStr = current.toISOString().split('T')[0];
        if (!excludedSet.has(dateStr)) {
          occurrences.push(new Date(current));
          generated++;
        }
      }
    }
    
    // Advance to next potential occurrence
    if ((rule.frequency === 'WEEKLY' && rule.byDay?.length > 0) ||
        (rule.frequency === 'MONTHLY' && rule.byMonthDay?.length > 0)) {
      // Advance daily to visit each candidate day when BYDAY/BYMONTHDAY filtering is active
      current = advanceDate(current, 'DAILY', 1);
    } else {
      current = advanceDate(current, rule.frequency, rule.frequency === 'WEEKLY' ? 1 : interval);
    }
  }
  
  return occurrences;
}

/**
 * Check if a date matches the recurrence rule constraints
 */
function matchesRule(date, rule, startDate) {
  // Check BYDAY
  if (rule.byDay && rule.byDay.length > 0) {
    const dayName = DAY_NAMES[date.getDay()];
    
    // Handle nth weekday (e.g., 2MO = second Monday)
    const matchesAny = rule.byDay.some(bd => {
      const match = bd.match(/^(-?\d)?(\w{2})$/);
      if (!match) return false;
      
      const [, nth, day] = match;
      if (day !== dayName) return false;
      
      if (nth) {
        const n = parseInt(nth, 10);
        const weekOfMonth = getWeekOfMonth(date, n < 0);
        return weekOfMonth === Math.abs(n);
      }
      
      return true;
    });
    
    if (!matchesAny) return false;
  }
  
  // Check BYMONTH
  if (rule.byMonth && rule.byMonth.length > 0) {
    const month = date.getMonth() + 1;
    if (!rule.byMonth.includes(month)) return false;
  }
  
  // Check BYMONTHDAY
  if (rule.byMonthDay && rule.byMonthDay.length > 0) {
    const dayOfMonth = date.getDate();
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    
    const matchesAny = rule.byMonthDay.some(d => {
      if (d > 0) return d === dayOfMonth;
      // Negative: count from end of month
      return daysInMonth + d + 1 === dayOfMonth;
    });
    
    if (!matchesAny) return false;
  }
  
  // Check interval alignment for WEEKLY
  if (rule.frequency === 'WEEKLY' && (rule.interval || 1) > 1) {
    const weeksDiff = getWeeksDiff(startDate, date, rule.weekStart || 'MO');
    if (weeksDiff % (rule.interval || 1) !== 0) return false;
  }
  
  return true;
}

/**
 * Advance a date by the given frequency
 */
function advanceDate(date, frequency, amount = 1) {
  const result = new Date(date);
  
  switch (frequency) {
    case 'DAILY':
      result.setDate(result.getDate() + amount);
      break;
    case 'WEEKLY':
      result.setDate(result.getDate() + (7 * amount));
      break;
    case 'MONTHLY': {
      const targetDay = result.getDate();
      result.setDate(1); // avoid overflow into next month
      result.setMonth(result.getMonth() + amount);
      const daysInMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
      result.setDate(Math.min(targetDay, daysInMonth));
      break;
    }
    case 'YEARLY':
      result.setFullYear(result.getFullYear() + amount);
      break;
    default:
      result.setDate(result.getDate() + 1);
  }
  
  return result;
}

/**
 * Get the week of month for a date
 */
function getWeekOfMonth(date, fromEnd = false) {
  if (fromEnd) {
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const daysRemaining = daysInMonth - date.getDate();
    return Math.floor(daysRemaining / 7) + 1;
  }
  return Math.ceil(date.getDate() / 7);
}

/**
 * Get weeks difference between two dates
 */
function getWeeksDiff(start, end, weekStart = 'MO') {
  const startWeek = getWeekNumber(start, weekStart);
  const endWeek = getWeekNumber(end, weekStart);
  const yearDiff = end.getFullYear() - start.getFullYear();
  return endWeek - startWeek + (yearDiff * 52);
}

/**
 * Get ISO week number
 */
function getWeekNumber(date, weekStart = 'MO') {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
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
export function getNextOccurrence(startDate, rule, afterDate = new Date()) {
  const occurrences = generateOccurrences(startDate, rule, {
    rangeStart: afterDate,
    maxOccurrences: 1,
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
  return `series-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Expand a recurring event into individual occurrences with full event data
 * @param {RecurringEvent} event - The recurring event
 * @param {Object} options - Expansion options
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
