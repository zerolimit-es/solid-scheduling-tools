/**
 * @zerolimit/solid-pod-sync/core — Solid Pod CRUD
 *
 * Framework-agnostic Solid Pod operations using Inrupt's SDK:
 * - Reading and writing availability settings
 * - Managing bookings (create, load, cancel, delete)
 * - Setting up public booking pages with appropriate ACLs
 * - Fetching user Pods
 *
 * All functions accept an authenticated `fetch` and are stateless —
 * no config globals, no database coupling.
 */

import {
  getSolidDataset,
  saveSolidDatasetAt,
  createSolidDataset,
  createThing,
  setThing,
  getThing,
  getThingAll,
  removeThing,
  getUrl,
  getStringNoLocale,
  getBoolean,
  getDatetime,
  getInteger,
  setUrl,
  setStringNoLocale,
  setBoolean,
  setDatetime,
  setInteger,
  createContainerAt,
  getContainedResourceUrlAll,
  deleteFile,
  overwriteFile,
  getFile,
  isContainer,
  getPodUrlAll,
  universalAccess,
} from '@inrupt/solid-client';

import { SCHEMA, SCHED, VCARD, dayNameToUri, uriToDayName } from './rdf.js';
import { buildRRule, parseRRule, generateSeriesId } from './recurrence.js';

/** @type {import('./types.js').PodPaths} */
const DEFAULT_POD_PATHS = {
  schedulerPath: 'proton-scheduler',
  availabilityFile: 'availability.ttl',
  bookingsContainer: 'bookings',
  publicProfile: 'public-profile.ttl',
};

/**
 * Get the scheduler data paths for a user's Pod
 * @param {string} podUrl - Root URL of the Pod
 * @param {Partial<import('./types.js').PodPaths>} [pathConfig] - Path overrides
 * @returns {Object} Paths object
 */
export function getSchedulerPaths(podUrl, pathConfig) {
  const paths = { ...DEFAULT_POD_PATHS, ...pathConfig };
  const base = podUrl.endsWith('/') ? podUrl : `${podUrl}/`;
  const schedulerRoot = `${base}${paths.schedulerPath}/`;

  return {
    root: schedulerRoot,
    availability: `${schedulerRoot}${paths.availabilityFile}`,
    publicProfile: `${schedulerRoot}${paths.publicProfile}`,
    bookings: `${schedulerRoot}${paths.bookingsContainer}/`,
  };
}

/**
 * Initialize the scheduler container structure in a Pod
 * @param {string} podUrl - Root URL of the Pod
 * @param {Function} fetch - Authenticated fetch function
 * @param {Partial<import('./types.js').PodPaths>} [pathConfig] - Path overrides
 */
export async function initializeSchedulerContainer(podUrl, fetch, pathConfig) {
  const paths = getSchedulerPaths(podUrl, pathConfig);
  
  try {
    // Create main scheduler container
    await createContainerAt(paths.root, { fetch });
    console.log(`Created scheduler container at ${paths.root}`);
  } catch (error) {
    if (error.statusCode !== 409 && error.statusCode !== 412) { // 409 = already exists
      throw error;
    }
  }
  
  try {
    // Create bookings container
    await createContainerAt(paths.bookings, { fetch });
    console.log(`Created bookings container at ${paths.bookings}`);
  } catch (error) {
    if (error.statusCode !== 409 && error.statusCode !== 412) {
      throw error;
    }
  }
  
  return paths;
}

/**
 * Save user availability settings to their Pod
 * @param {string} podUrl - Root URL of the Pod
 * @param {Object} availability - Availability settings
 * @param {Function} fetch - Authenticated fetch function
 * @param {Partial<import('./types.js').PodPaths>} [pathConfig] - Path overrides
 */
export async function saveAvailability(podUrl, availability, fetch, pathConfig) {
  const paths = getSchedulerPaths(podUrl, pathConfig);
  
  // Ensure container exists
  await initializeSchedulerContainer(podUrl, fetch, pathConfig);

  // Create dataset
  let dataset = createSolidDataset();
  
  // Create main settings thing
  const settingsUrl = `${paths.availability}#settings`;
  let settings = createThing({ url: settingsUrl });
  
  settings = setUrl(settings, `${SCHEMA.name}Type`, SCHED.AvailabilitySettings);
  settings = setInteger(settings, SCHED.eventDuration, availability.eventDuration || 30);
  settings = setStringNoLocale(settings, SCHED.timezone, availability.timezone || 'UTC');
  settings = setStringNoLocale(settings, SCHED.bookingSlug, availability.bookingSlug || '');
  settings = setStringNoLocale(settings, SCHEMA.name, availability.name || '');
  settings = setStringNoLocale(settings, SCHEMA.email, availability.email || '');
  
  if (availability.bufferBefore) {
    settings = setInteger(settings, SCHED.bufferBefore, availability.bufferBefore);
  }
  if (availability.bufferAfter) {
    settings = setInteger(settings, SCHED.bufferAfter, availability.bufferAfter);
  }
  if (availability.minNotice) {
    settings = setInteger(settings, SCHED.minNotice, availability.minNotice);
  }
  if (availability.maxAdvance) {
    settings = setInteger(settings, SCHED.maxAdvance, availability.maxAdvance);
  }
  
  dataset = setThing(dataset, settings);
  
  // Add day availability
  const days = availability.days || {};
  for (const [dayName, daySettings] of Object.entries(days)) {
    const dayUri = dayNameToUri[dayName.toLowerCase()];
    if (!dayUri) continue;
    
    const dayUrl = `${paths.availability}#${dayName}`;
    let dayThing = createThing({ url: dayUrl });
    
    dayThing = setUrl(dayThing, `${SCHEMA.name}Type`, SCHED.DayAvailability);
    dayThing = setUrl(dayThing, SCHED.dayOfWeek, dayUri);
    dayThing = setBoolean(dayThing, SCHED.isEnabled, daySettings.enabled || false);
    dayThing = setStringNoLocale(dayThing, SCHED.startTime, daySettings.start || '09:00');
    dayThing = setStringNoLocale(dayThing, SCHED.endTime, daySettings.end || '17:00');
    
    dataset = setThing(dataset, dayThing);
    
    // Link day to settings
    settings = setUrl(settings, SCHED.hasAvailability, dayUrl);
    dataset = setThing(dataset, settings);
  }
  
  // Save to Pod — delete first to avoid 412 ETag conflict
  try {
    await deleteFile(paths.availability, { fetch });
  } catch (e) {
    // ignore if file doesn't exist
  }
  await saveSolidDatasetAt(paths.availability, dataset, { fetch });
  
  return paths.availability;
}

/**
 * Load user availability settings from their Pod
 * @param {string} podUrl - Root URL of the Pod
 * @param {Function} fetch - Authenticated fetch function
 * @param {Partial<import('./types.js').PodPaths>} [pathConfig] - Path overrides
 * @returns {Object|null} Availability settings or null
 */
export async function loadAvailability(podUrl, fetch, pathConfig) {
  const paths = getSchedulerPaths(podUrl, pathConfig);
  
  try {
    const dataset = await getSolidDataset(paths.availability, { fetch });
    const settingsUrl = `${paths.availability}#settings`;
    const settings = getThing(dataset, settingsUrl);
    
    if (!settings) {
      return null;
    }
    
    const availability = {
      eventDuration: getInteger(settings, SCHED.eventDuration) || 30,
      timezone: getStringNoLocale(settings, SCHED.timezone) || 'UTC',
      bookingSlug: getStringNoLocale(settings, SCHED.bookingSlug) || '',
      name: getStringNoLocale(settings, SCHEMA.name) || '',
      email: getStringNoLocale(settings, SCHEMA.email) || '',
      bufferBefore: getInteger(settings, SCHED.bufferBefore) || 0,
      bufferAfter: getInteger(settings, SCHED.bufferAfter) || 0,
      minNotice: getInteger(settings, SCHED.minNotice) || 0,
      maxAdvance: getInteger(settings, SCHED.maxAdvance) || 60,
      days: {},
    };
    
    // Load day availability
    const allThings = getThingAll(dataset);
    for (const thing of allThings) {
      const dayOfWeekUri = getUrl(thing, SCHED.dayOfWeek);
      if (dayOfWeekUri) {
        const dayName = uriToDayName[dayOfWeekUri];
        if (dayName) {
          availability.days[dayName] = {
            enabled: getBoolean(thing, SCHED.isEnabled) || false,
            start: getStringNoLocale(thing, SCHED.startTime) || '09:00',
            end: getStringNoLocale(thing, SCHED.endTime) || '17:00',
          };
        }
      }
    }
    
    return availability;
  } catch (error) {
    if (error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Save a booking to the organizer's Pod
 * @param {string} podUrl - Root URL of organizer's Pod
 * @param {Object} booking - Booking data
 * @param {Function} fetch - Authenticated fetch function
 * @param {Partial<import('./types.js').PodPaths>} [pathConfig] - Path overrides
 * @returns {string} URL of the saved booking
 */
export async function saveBooking(podUrl, booking, fetch, pathConfig) {
  const paths = getSchedulerPaths(podUrl, pathConfig);

  // Ensure container exists
  await initializeSchedulerContainer(podUrl, fetch, pathConfig);
  
  // Generate booking ID and URL
  const bookingId = booking.id || `booking-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const bookingUrl = `${paths.bookings}${bookingId}.ttl`;

  // Skip if already exists on Pod (idempotent sync)
  try {
    await getSolidDataset(bookingUrl, { fetch });
    console.log(`[Solid] Booking ${bookingId} already exists on Pod, skipping write`);
    return bookingUrl;
  } catch {
    // 404 = doesn't exist yet, proceed with save
  }

  let dataset = createSolidDataset();
  
  const thingUrl = `${bookingUrl}#event`;
  let bookingThing = createThing({ url: thingUrl });
  
  // Set type
  bookingThing = setUrl(bookingThing, `${SCHEMA.name}Type`, SCHED.Booking);
  bookingThing = setUrl(bookingThing, `${SCHEMA.name}additionalType`, SCHEMA.Event);
  
  // Event details
  bookingThing = setStringNoLocale(bookingThing, SCHEMA.identifier, bookingId);
  bookingThing = setStringNoLocale(bookingThing, SCHEMA.name, booking.title);
  bookingThing = setDatetime(bookingThing, SCHEMA.startDate, new Date(booking.start));
  bookingThing = setDatetime(bookingThing, SCHEMA.endDate, new Date(booking.end));
  bookingThing = setUrl(bookingThing, SCHEMA.eventStatus, SCHEMA.EventConfirmed);
  
  if (booking.description) {
    bookingThing = setStringNoLocale(bookingThing, SCHEMA.description, booking.description);
  }
  if (booking.location) {
    bookingThing = setStringNoLocale(bookingThing, SCHEMA.location, booking.location);
  }
  
  // Organizer info
  bookingThing = setStringNoLocale(bookingThing, `${SCHEMA.organizer}Name`, booking.organizer.name);
  bookingThing = setStringNoLocale(bookingThing, `${SCHEMA.organizer}Email`, booking.organizer.email);
  
  // Attendee info
  bookingThing = setStringNoLocale(bookingThing, SCHED.bookedBy, booking.attendee.name);
  bookingThing = setStringNoLocale(bookingThing, SCHED.bookedByEmail, booking.attendee.email);
  
  if (booking.notes) {
    bookingThing = setStringNoLocale(bookingThing, SCHED.additionalNotes, booking.notes);
  }
  
  // Recurrence support
  if (booking.recurrence && booking.recurrence.frequency) {
    bookingThing = setBoolean(bookingThing, SCHED.isRecurring, true);
    
    // Store the RRULE string for easy parsing
    const rruleString = buildRRule(booking.recurrence);
    bookingThing = setStringNoLocale(bookingThing, SCHED.rruleString, rruleString);
    
    // Store individual recurrence properties
    bookingThing = setStringNoLocale(bookingThing, SCHED.frequency, booking.recurrence.frequency);
    
    if (booking.recurrence.interval) {
      bookingThing = setInteger(bookingThing, SCHED.interval, booking.recurrence.interval);
    }
    if (booking.recurrence.count) {
      bookingThing = setInteger(bookingThing, SCHED.count, booking.recurrence.count);
    }
    if (booking.recurrence.until) {
      bookingThing = setDatetime(bookingThing, SCHED.until, new Date(booking.recurrence.until));
    }
    if (booking.recurrence.byDay && booking.recurrence.byDay.length > 0) {
      bookingThing = setStringNoLocale(bookingThing, SCHED.byDay, booking.recurrence.byDay.join(','));
    }
    
    // Series ID for grouping occurrences
    const seriesId = booking.seriesId || generateSeriesId();
    bookingThing = setStringNoLocale(bookingThing, SCHED.seriesId, seriesId);
  } else {
    bookingThing = setBoolean(bookingThing, SCHED.isRecurring, false);
  }
  
  // Excluded dates (cancelled occurrences)
  if (booking.excludedDates && booking.excludedDates.length > 0) {
    const excludedStr = booking.excludedDates.map(d => new Date(d).toISOString()).join(',');
    bookingThing = setStringNoLocale(bookingThing, SCHED.excludedDates, excludedStr);
  }
  
  // Metadata
  bookingThing = setDatetime(bookingThing, SCHEMA.dateCreated, new Date());
  bookingThing = setBoolean(bookingThing, SCHED.confirmationSent, booking.confirmationSent || false);
  
  dataset = setThing(dataset, bookingThing);
  
  await saveSolidDatasetAt(bookingUrl, dataset, { fetch });
  
  return bookingUrl;
}

/**
 * Load all bookings from a user's Pod
 * @param {string} podUrl - Root URL of the Pod
 * @param {Function} fetch - Authenticated fetch function
 * @param {Object} [options] - Filter options
 * @param {Partial<import('./types.js').PodPaths>} [pathConfig] - Path overrides
 * @returns {Array} Array of booking objects
 */
export async function loadBookings(podUrl, fetch, options = {}, pathConfig) {
  const paths = getSchedulerPaths(podUrl, pathConfig);
  const bookings = [];
  
  try {
    const container = await getSolidDataset(paths.bookings, { fetch });
    const resourceUrls = getContainedResourceUrlAll(container);
    
    for (const resourceUrl of resourceUrls) {
      if (!resourceUrl.endsWith('.ttl')) continue;
      
      try {
        const dataset = await getSolidDataset(resourceUrl, { fetch });
        const things = getThingAll(dataset);
        
        for (const thing of things) {
          const typeUrl = getUrl(thing, `${SCHEMA.name}Type`);
          if (typeUrl === SCHED.Booking) {
            // Parse recurrence data
            let recurrence = null;
            const isRecurring = getBoolean(thing, SCHED.isRecurring);
            
            if (isRecurring) {
              const rruleString = getStringNoLocale(thing, SCHED.rruleString);
              
              if (rruleString) {
                recurrence = parseRRule(rruleString);
              } else {
                // Build from individual properties
                recurrence = {
                  frequency: getStringNoLocale(thing, SCHED.frequency),
                  interval: getInteger(thing, SCHED.interval) || 1,
                  count: getInteger(thing, SCHED.count),
                  until: getDatetime(thing, SCHED.until),
                };
                
                const byDayStr = getStringNoLocale(thing, SCHED.byDay);
                if (byDayStr) {
                  recurrence.byDay = byDayStr.split(',');
                }
              }
            }
            
            // Parse excluded dates
            let excludedDates = [];
            const excludedStr = getStringNoLocale(thing, SCHED.excludedDates);
            if (excludedStr) {
              excludedDates = excludedStr.split(',').map(d => new Date(d));
            }
            
            const booking = {
              id: getStringNoLocale(thing, SCHEMA.identifier),
              url: resourceUrl,
              title: getStringNoLocale(thing, SCHEMA.name),
              start: getDatetime(thing, SCHEMA.startDate),
              end: getDatetime(thing, SCHEMA.endDate),
              description: getStringNoLocale(thing, SCHEMA.description),
              location: getStringNoLocale(thing, SCHEMA.location),
              status: getUrl(thing, SCHEMA.eventStatus),
              organizer: {
                name: getStringNoLocale(thing, `${SCHEMA.organizer}Name`),
                email: getStringNoLocale(thing, `${SCHEMA.organizer}Email`),
              },
              attendee: {
                name: getStringNoLocale(thing, SCHED.bookedBy),
                email: getStringNoLocale(thing, SCHED.bookedByEmail),
              },
              notes: getStringNoLocale(thing, SCHED.additionalNotes),
              createdAt: getDatetime(thing, SCHEMA.dateCreated),
              confirmationSent: getBoolean(thing, SCHED.confirmationSent),
              // Recurrence fields
              isRecurring: isRecurring || false,
              recurrence,
              seriesId: getStringNoLocale(thing, SCHED.seriesId),
              excludedDates,
            };
            
            // Apply filters
            if (!options.includeCancelled && booking.status === SCHEMA.EventCancelled) continue;
            if (options.from && booking.start < options.from) continue;
            if (options.to && booking.start > options.to) continue;
            if (options.status && booking.status !== options.status) continue;
            
            bookings.push(booking);
          }
        }
      } catch (err) {
        console.warn(`Failed to load booking from ${resourceUrl}:`, err.message);
      }
    }
    
    // Sort by start date
    bookings.sort((a, b) => new Date(a.start) - new Date(b.start));
    
    return bookings;
  } catch (error) {
    if (error.statusCode === 404) {
      return [];
    }
    throw error;
  }
}

/**
 * Cancel a booking
 * @param {string} bookingUrl - URL of the booking resource
 * @param {Function} fetch - Authenticated fetch function
 */
export async function cancelBooking(bookingUrl, fetch) {
  try {
    const dataset = await getSolidDataset(bookingUrl, { fetch });
    const things = getThingAll(dataset);
    
    let updatedDataset = dataset;
    
    for (const thing of things) {
      const typeUrl = getUrl(thing, `${SCHEMA.name}Type`);
      if (typeUrl === SCHED.Booking) {
        let updatedThing = setUrl(thing, SCHEMA.eventStatus, SCHEMA.EventCancelled);
        updatedThing = setDatetime(updatedThing, SCHEMA.dateModified, new Date());
        updatedDataset = setThing(updatedDataset, updatedThing);
      }
    }
    
    await saveSolidDatasetAt(bookingUrl, updatedDataset, { fetch });
    return true;
  } catch (error) {
    console.error('Failed to cancel booking:', error);
    throw error;
  }
}

/**
 * Delete a booking completely
 * @param {string} bookingUrl - URL of the booking resource
 * @param {Function} fetch - Authenticated fetch function
 */
export async function deleteBooking(bookingUrl, fetch) {
  await deleteFile(bookingUrl, { fetch });
}

/**
 * Add an excluded date to a recurring booking (cancel single occurrence)
 * @param {string} bookingUrl - URL of the booking resource
 * @param {Date} dateToExclude - The occurrence date to exclude
 * @param {Function} fetch - Authenticated fetch function
 */
export async function addExcludedDate(bookingUrl, dateToExclude, fetch) {
  try {
    const dataset = await getSolidDataset(bookingUrl, { fetch });
    const things = getThingAll(dataset);
    
    let updatedDataset = dataset;
    
    for (const thing of things) {
      const typeUrl = getUrl(thing, `${SCHEMA.name}Type`);
      if (typeUrl === SCHED.Booking) {
        // Get existing excluded dates
        const existingStr = getStringNoLocale(thing, SCHED.excludedDates) || '';
        const existingDates = existingStr ? existingStr.split(',') : [];
        
        // Add new date
        existingDates.push(new Date(dateToExclude).toISOString());
        
        // Update the thing
        let updatedThing = setStringNoLocale(thing, SCHED.excludedDates, existingDates.join(','));
        updatedThing = setDatetime(updatedThing, SCHEMA.dateModified, new Date());
        updatedDataset = setThing(updatedDataset, updatedThing);
      }
    }
    
    await saveSolidDatasetAt(bookingUrl, updatedDataset, { fetch });
    return true;
  } catch (error) {
    console.error('Failed to add excluded date:', error);
    throw error;
  }
}

/**
 * Update a recurring event series
 * @param {string} bookingUrl - URL of the booking resource
 * @param {Object} updates - Fields to update
 * @param {Function} fetch - Authenticated fetch function
 */
export async function updateRecurringSeries(bookingUrl, updates, fetch) {
  try {
    const dataset = await getSolidDataset(bookingUrl, { fetch });
    const things = getThingAll(dataset);
    
    let updatedDataset = dataset;
    
    for (const thing of things) {
      const typeUrl = getUrl(thing, `${SCHEMA.name}Type`);
      if (typeUrl === SCHED.Booking) {
        let updatedThing = thing;
        
        // Update allowed fields
        if (updates.title) {
          updatedThing = setStringNoLocale(updatedThing, SCHEMA.name, updates.title);
        }
        if (updates.description !== undefined) {
          updatedThing = setStringNoLocale(updatedThing, SCHEMA.description, updates.description);
        }
        if (updates.location !== undefined) {
          updatedThing = setStringNoLocale(updatedThing, SCHEMA.location, updates.location);
        }
        
        // Update recurrence if provided
        if (updates.recurrence) {
          const rruleString = buildRRule(updates.recurrence);
          updatedThing = setStringNoLocale(updatedThing, SCHED.rruleString, rruleString);
          updatedThing = setStringNoLocale(updatedThing, SCHED.frequency, updates.recurrence.frequency);
          
          if (updates.recurrence.interval) {
            updatedThing = setInteger(updatedThing, SCHED.interval, updates.recurrence.interval);
          }
          if (updates.recurrence.count) {
            updatedThing = setInteger(updatedThing, SCHED.count, updates.recurrence.count);
          }
          if (updates.recurrence.until) {
            updatedThing = setDatetime(updatedThing, SCHED.until, new Date(updates.recurrence.until));
          }
          if (updates.recurrence.byDay) {
            updatedThing = setStringNoLocale(updatedThing, SCHED.byDay, updates.recurrence.byDay.join(','));
          }
        }
        
        updatedThing = setDatetime(updatedThing, SCHEMA.dateModified, new Date());
        updatedDataset = setThing(updatedDataset, updatedThing);
      }
    }
    
    await saveSolidDatasetAt(bookingUrl, updatedDataset, { fetch });
    return true;
  } catch (error) {
    console.error('Failed to update recurring series:', error);
    throw error;
  }
}

/**
 * Make a user's public booking profile accessible
 * @param {string} podUrl - Root URL of the Pod
 * @param {Object} publicInfo - Public profile information
 * @param {Function} fetch - Authenticated fetch function
 * @param {Partial<import('./types.js').PodPaths>} [pathConfig] - Path overrides
 */
export async function setupPublicBookingPage(podUrl, publicInfo, fetch, pathConfig) {
  const paths = getSchedulerPaths(podUrl, pathConfig);
  
  // Create public profile dataset
  let dataset = createSolidDataset();
  
  const profileUrl = `${paths.publicProfile}#profile`;
  let profile = createThing({ url: profileUrl });
  
  profile = setUrl(profile, `${SCHEMA.name}Type`, SCHED.BookingPage);
  profile = setStringNoLocale(profile, SCHEMA.name, publicInfo.name);
  profile = setStringNoLocale(profile, SCHED.bookingSlug, publicInfo.bookingSlug);
  profile = setInteger(profile, SCHED.eventDuration, publicInfo.eventDuration);
  profile = setStringNoLocale(profile, SCHED.timezone, publicInfo.timezone);
  profile = setBoolean(profile, SCHED.isPublic, true);
  
  if (publicInfo.meetingTitle) {
    profile = setStringNoLocale(profile, SCHED.meetingTitle, publicInfo.meetingTitle);
  }
  if (publicInfo.meetingDescription) {
    profile = setStringNoLocale(profile, SCHED.meetingDescription, publicInfo.meetingDescription);
  }
  if (publicInfo.photo) {
    profile = setUrl(profile, VCARD.hasPhoto, publicInfo.photo);
  }
  
  dataset = setThing(dataset, profile);
  
  await saveSolidDatasetAt(paths.publicProfile, dataset, { fetch });
  
  // Set public read access
  try {
    await universalAccess.setPublicAccess(
      paths.publicProfile,
      { read: true, write: false },
      { fetch }
    );
  } catch (error) {
    console.warn('Could not set public access (may need WAC/ACP setup):', error.message);
  }
  
  return paths.publicProfile;
}

/**
 * Get all Pods associated with the authenticated user
 * @param {string} webId - User's WebID
 * @param {Function} fetch - Authenticated fetch function
 * @returns {Array<string>} Array of Pod URLs
 */
export async function getUserPods(webId, fetchFn) {
  // Strategy 1: Standard getPodUrlAll (pim:storage triple)
  try {
    const pods = await getPodUrlAll(webId, { fetch: fetchFn });
    if (pods.length > 0) return pods;
  } catch (e) { /* ignore */ }

  // Strategy 2: Check Link header for storageDescription (ESS 2.0+)
  try {
    const headRes = await fetchFn(webId, { method: 'HEAD' });
    const linkHeader = headRes.headers.get('link') || '';
    const match = linkHeader.match(/<([^>]+)>;\s*rel="http:\/\/www\.w3\.org\/ns\/solid\/terms#storageDescription"/);
    if (match) {
      const descRes = await fetchFn(match[1], { headers: { Accept: 'application/ld+json' } });
      if (descRes.ok) {
        const descJson = JSON.parse(await descRes.text());
        const entries = Array.isArray(descJson) ? descJson : [descJson];
        for (const entry of entries) {
          const storage = entry['http://www.w3.org/ns/solid/terms#storageSpace']
            || entry['http://www.w3.org/ns/pim/space#storage'];
          if (storage) {
            const url = typeof storage === 'string' ? storage
              : Array.isArray(storage) ? (storage[0]?.['@id'] || storage[0])
              : (storage['@id'] || storage);
            if (typeof url === 'string' && url.startsWith('http')) return [url];
          }
        }
      }
    }
  } catch (e) { /* ignore */ }

  return [];
}

/**
 * Check if a time slot conflicts with existing bookings
 * @param {string} podUrl - Root URL of the Pod
 * @param {Date} start - Proposed start time
 * @param {Date} end - Proposed end time
 * @param {Function} fetch - Authenticated fetch function
 * @param {Partial<import('./types.js').PodPaths>} [pathConfig] - Path overrides
 * @returns {boolean} True if there's a conflict
 */
export async function checkSlotConflict(podUrl, start, end, fetch, pathConfig) {
  const bookings = await loadBookings(podUrl, fetch, {
    from: new Date(start.getTime() - 24 * 60 * 60 * 1000), // 1 day before
    to: new Date(end.getTime() + 24 * 60 * 60 * 1000), // 1 day after
  }, pathConfig);
  
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  
  for (const booking of bookings) {
    if (booking.status === SCHEMA.EventCancelled) continue;
    
    const bookingStart = new Date(booking.start).getTime();
    const bookingEnd = new Date(booking.end).getTime();
    
    // Check for overlap
    if (startTime < bookingEnd && endTime > bookingStart) {
      return true;
    }
  }
  
  return false;
}

export default {
  getSchedulerPaths,
  initializeSchedulerContainer,
  saveAvailability,
  loadAvailability,
  saveBooking,
  loadBookings,
  cancelBooking,
  deleteBooking,
  addExcludedDate,
  updateRecurringSeries,
  setupPublicBookingPage,
  getUserPods,
  checkSlotConflict,
};
