/**
 * @zerolimit/solid-pod-sync/core — RDF Vocabulary Definitions
 *
 * Standard + custom vocabularies for Solid Pod scheduling data:
 * - schema.org for events, people, organizations
 * - vCard for contact information
 * - Custom scheduler vocabulary for availability patterns
 */

// Namespace prefixes
export const NAMESPACES = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  schema: 'http://schema.org/',
  vcard: 'http://www.w3.org/2006/vcard/ns#',
  solid: 'http://www.w3.org/ns/solid/terms#',
  acl: 'http://www.w3.org/ns/auth/acl#',
  foaf: 'http://xmlns.com/foaf/0.1/',
  dcterms: 'http://purl.org/dc/terms/',
  // Custom scheduler namespace
  sched: 'https://vocab.protonscheduler.app/ns#',
};

// Schema.org terms we use
export const SCHEMA = {
  // Types
  Event: `${NAMESPACES.schema}Event`,
  Person: `${NAMESPACES.schema}Person`,
  Schedule: `${NAMESPACES.schema}Schedule`,
  
  // Properties
  name: `${NAMESPACES.schema}name`,
  email: `${NAMESPACES.schema}email`,
  description: `${NAMESPACES.schema}description`,
  startDate: `${NAMESPACES.schema}startDate`,
  endDate: `${NAMESPACES.schema}endDate`,
  duration: `${NAMESPACES.schema}duration`,
  location: `${NAMESPACES.schema}location`,
  organizer: `${NAMESPACES.schema}organizer`,
  attendee: `${NAMESPACES.schema}attendee`,
  eventStatus: `${NAMESPACES.schema}eventStatus`,
  url: `${NAMESPACES.schema}url`,
  identifier: `${NAMESPACES.schema}identifier`,
  dateCreated: `${NAMESPACES.schema}dateCreated`,
  dateModified: `${NAMESPACES.schema}dateModified`,
  
  // Event status values
  EventScheduled: `${NAMESPACES.schema}EventScheduled`,
  EventCancelled: `${NAMESPACES.schema}EventCancelled`,
  EventConfirmed: `${NAMESPACES.schema}EventConfirmed`,
};

// Custom ProtonScheduler vocabulary
export const SCHED = {
  // Types
  AvailabilitySettings: `${NAMESPACES.sched}AvailabilitySettings`,
  DayAvailability: `${NAMESPACES.sched}DayAvailability`,
  TimeSlot: `${NAMESPACES.sched}TimeSlot`,
  BookingPage: `${NAMESPACES.sched}BookingPage`,
  Booking: `${NAMESPACES.sched}Booking`,
  RecurringEvent: `${NAMESPACES.sched}RecurringEvent`,
  RecurrenceRule: `${NAMESPACES.sched}RecurrenceRule`,
  EventException: `${NAMESPACES.sched}EventException`,
  
  // Properties
  eventDuration: `${NAMESPACES.sched}eventDuration`,
  timezone: `${NAMESPACES.sched}timezone`,
  bufferBefore: `${NAMESPACES.sched}bufferBefore`,
  bufferAfter: `${NAMESPACES.sched}bufferAfter`,
  minNotice: `${NAMESPACES.sched}minNotice`,
  maxAdvance: `${NAMESPACES.sched}maxAdvance`,
  
  // Day availability properties
  dayOfWeek: `${NAMESPACES.sched}dayOfWeek`,
  isEnabled: `${NAMESPACES.sched}isEnabled`,
  startTime: `${NAMESPACES.sched}startTime`,
  endTime: `${NAMESPACES.sched}endTime`,
  hasAvailability: `${NAMESPACES.sched}hasAvailability`,
  
  // Booking page properties
  bookingSlug: `${NAMESPACES.sched}bookingSlug`,
  isPublic: `${NAMESPACES.sched}isPublic`,
  meetingTitle: `${NAMESPACES.sched}meetingTitle`,
  meetingDescription: `${NAMESPACES.sched}meetingDescription`,
  
  // Booking properties
  bookedBy: `${NAMESPACES.sched}bookedBy`,
  bookedByEmail: `${NAMESPACES.sched}bookedByEmail`,
  additionalNotes: `${NAMESPACES.sched}additionalNotes`,
  confirmationSent: `${NAMESPACES.sched}confirmationSent`,
  icsGenerated: `${NAMESPACES.sched}icsGenerated`,
  
  // Recurrence properties (following iCalendar RRULE standard)
  isRecurring: `${NAMESPACES.sched}isRecurring`,
  recurrenceRule: `${NAMESPACES.sched}recurrenceRule`,
  rruleString: `${NAMESPACES.sched}rruleString`,
  frequency: `${NAMESPACES.sched}frequency`,
  interval: `${NAMESPACES.sched}interval`,
  count: `${NAMESPACES.sched}count`,
  until: `${NAMESPACES.sched}until`,
  byDay: `${NAMESPACES.sched}byDay`,
  byMonth: `${NAMESPACES.sched}byMonth`,
  byMonthDay: `${NAMESPACES.sched}byMonthDay`,
  bySetPos: `${NAMESPACES.sched}bySetPos`,
  weekStart: `${NAMESPACES.sched}weekStart`,
  
  // Recurrence instance properties
  seriesId: `${NAMESPACES.sched}seriesId`,
  originalDate: `${NAMESPACES.sched}originalDate`,
  isException: `${NAMESPACES.sched}isException`,
  exceptionType: `${NAMESPACES.sched}exceptionType`,
  excludedDates: `${NAMESPACES.sched}excludedDates`,
  
  // Day of week values
  Monday: `${NAMESPACES.sched}Monday`,
  Tuesday: `${NAMESPACES.sched}Tuesday`,
  Wednesday: `${NAMESPACES.sched}Wednesday`,
  Thursday: `${NAMESPACES.sched}Thursday`,
  Friday: `${NAMESPACES.sched}Friday`,
  Saturday: `${NAMESPACES.sched}Saturday`,
  Sunday: `${NAMESPACES.sched}Sunday`,
  
  // Frequency values (iCalendar standard)
  FrequencyDaily: `${NAMESPACES.sched}DAILY`,
  FrequencyWeekly: `${NAMESPACES.sched}WEEKLY`,
  FrequencyMonthly: `${NAMESPACES.sched}MONTHLY`,
  FrequencyYearly: `${NAMESPACES.sched}YEARLY`,
  
  // Exception types
  ExceptionCancelled: `${NAMESPACES.sched}ExceptionCancelled`,
  ExceptionRescheduled: `${NAMESPACES.sched}ExceptionRescheduled`,
};

// vCard terms
export const VCARD = {
  fn: `${NAMESPACES.vcard}fn`,
  hasEmail: `${NAMESPACES.vcard}hasEmail`,
  hasTelephone: `${NAMESPACES.vcard}hasTelephone`,
  hasPhoto: `${NAMESPACES.vcard}hasPhoto`,
  hasURL: `${NAMESPACES.vcard}hasURL`,
};

// FOAF terms
export const FOAF = {
  name: `${NAMESPACES.foaf}name`,
  mbox: `${NAMESPACES.foaf}mbox`,
  img: `${NAMESPACES.foaf}img`,
};

// Helper to map JavaScript day names to RDF URIs
export const dayNameToUri = {
  monday: SCHED.Monday,
  tuesday: SCHED.Tuesday,
  wednesday: SCHED.Wednesday,
  thursday: SCHED.Thursday,
  friday: SCHED.Friday,
  saturday: SCHED.Saturday,
  sunday: SCHED.Sunday,
};

export const uriToDayName = Object.fromEntries(
  Object.entries(dayNameToUri).map(([k, v]) => [v, k])
);

// Generate a Turtle prefix block
export function getTurtlePrefixes() {
  return Object.entries(NAMESPACES)
    .map(([prefix, uri]) => `@prefix ${prefix}: <${uri}> .`)
    .join('\n');
}

export default {
  NAMESPACES,
  SCHEMA,
  SCHED,
  VCARD,
  FOAF,
  dayNameToUri,
  uriToDayName,
  getTurtlePrefixes,
};
