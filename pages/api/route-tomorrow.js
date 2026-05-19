import { google } from "googleapis";
import { supabaseAdmin } from "../../lib/supabaseAdmin";

const DEFAULT_TRAVEL_BUFFER_MINUTES = 25;
const CLUMP_DISTANCE_MINUTES = 15;
const MAX_EARLY_MINUTES = 120;
const MAX_LATE_MINUTES = 120;
const FLEET_RETURN_HOME_SCORING = true;

const TARGET_CALENDAR_NAMES = [
  "Jiffy Lawn Bookings",
  "Internal Booking",
  "Windows/Eaves",
  "Carpet Cleaning Bookings",
  "Residential Deep Clean Bookings",
  "BBQ Bookings",
  "Power Washing",
];

const CORRIDORS = [
  {
    name: "Hamilton / Burlington / Oakville",
    keywords: ["hamilton", "burlington", "oakville", "dundas", "ancaster", "stoney creek", "waterdown"],
  },
  {
    name: "Mississauga / Brampton / Milton",
    keywords: ["mississauga", "brampton", "milton", "caledon", "georgetown"],
  },
  {
    name: "Vaughan / Woodbridge / Richmond Hill",
    keywords: ["vaughan", "woodbridge", "richmond hill", "thornhill", "maple", "concord"],
  },
  {
    name: "Pickering / Scarborough / Markham",
    keywords: ["pickering", "scarborough", "markham", "ajax", "whitby", "oshawa", "stouffville"],
  },
  {
    name: "Toronto Core / Etobicoke / North York",
    keywords: ["toronto", "etobicoke", "north york", "east york", "york"],
  },
];

function getTomorrowDateToronto() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  const d = new Date(`${year}-${month}-${day}T12:00:00`);
  d.setDate(d.getDate() + 1);

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s,/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeServiceKey(value) {
  const service = normalizeText(value);

  if (!service) return "general";
  if (service.includes("bbq")) return "bbq";
  if (service.includes("oven") || service.includes("stove")) return "oven";
  if (service.includes("carpet")) return "carpet";
  if (service.includes("window") || service.includes("eaves")) return "windows";
  if (service.includes("gutter")) return "gutter";
  if (service.includes("pressure") || service.includes("power wash")) return "pressure-washing";
  if (service.includes("deep clean")) return "deep-clean";
  if (service.includes("lawn")) return "lawn";

  return service;
}

function getServiceDurationMinutes(serviceType, title, description) {
  const service = normalizeServiceKey(serviceType);
  const text = normalizeText(`${title || ""} ${description || ""}`);

  if (service === "bbq" || text.includes("bbq")) return 120;
  if (service === "oven" || text.includes("oven")) return 120;
  if (service === "carpet" || text.includes("carpet")) return 120;
  if (service === "windows" || text.includes("window")) return 180;
  if (service === "gutter" || text.includes("gutter")) return 180;
  if (service === "pressure-washing" || text.includes("pressure") || text.includes("power wash")) return 180;
  if (service === "deep-clean" || text.includes("deep clean")) return 240;
  if (service === "lawn" || text.includes("lawn")) return 90;

  return 120;
}

function parseTimeOnDate(dateString, timeValue, fallback = "09:00:00") {
  const raw = String(timeValue || fallback).trim();

  if (raw.includes("T")) {
    const dt = new Date(raw);
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (match) {
    const hh = String(match[1]).padStart(2, "0");
    const mm = String(match[2]).padStart(2, "0");
    const ss = String(match[3] || "00").padStart(2, "0");
    return new Date(`${dateString}T${hh}:${mm}:${ss}`);
  }

  return new Date(`${dateString}T${fallback}`);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function getDayKeyFromServiceDate(serviceDate) {
  const date = new Date(`${serviceDate}T12:00:00`);
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][date.getDay()];
}

function getWorkingDays(tech) {
  if (!Array.isArray(tech.working_days) || tech.working_days.length === 0) {
    return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  }

  return tech.working_days
    .map((d) => normalizeText(d).slice(0, 3))
    .filter(Boolean);
}

function techWorksOnServiceDate(tech, serviceDate) {
  return getWorkingDays(tech).includes(getDayKeyFromServiceDate(serviceDate));
}

function getTechName(tech) {
  return (
    tech.display_name ||
    [tech.first_name, tech.last_name].filter(Boolean).join(" ") ||
    tech.legal_name ||
    tech.email ||
    `Tech ${tech.id}`
  );
}

function getTechFirstName(tech) {
  return String(getTechName(tech) || "Tech").trim().split(/\s+/)[0] || "Tech";
}

function getOrdinal(n) {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

function stripExistingRoutePrefix(title) {
  return String(title || "")
    .replace(/^\s*\d+(st|nd|rd|th)\s+[a-zA-Z]+\s+/i, "")
    .trim();
}

function buildRoutedTitle({ order, tech, originalTitle }) {
  return `${getOrdinal(order)} ${getTechFirstName(tech)} ${stripExistingRoutePrefix(originalTitle)}`;
}

function getTechServiceKeys(tech) {
  if (!Array.isArray(tech.services)) return [];
  return tech.services.map(normalizeServiceKey).filter(Boolean);
}

function techCanDoService(tech, job) {
  const services = getTechServiceKeys(tech);
  if (!services.length) return true;

  const jobService = normalizeServiceKey(job.service_type);
  if (!jobService || jobService === "general") return true;

  return services.includes(jobService);
}

function getTechMaxJobs(tech) {
  const value = Number(tech.max_jobs_per_day);
  if (Number.isFinite(value) && value > 0) return value;
  return 5;
}

function getTechRank(tech) {
  const value = Number(tech.rank_position);
  if (Number.isFinite(value) && value > 0) return value;
  return 999;
}

function getTechShiftStart(tech, serviceDate) {
  return parseTimeOnDate(serviceDate, tech.work_start_time || "08:00:00", "08:00:00");
}

function getCorridor(address) {
  const text = normalizeText(address);

  for (const corridor of CORRIDORS) {
    if (corridor.keywords.some((k) => text.includes(k))) return corridor.name;
  }

  return "Other";
}

function addressKey(address) {
  return normalizeText(address);
}

function matrixKey(from, to) {
  return `${addressKey(from)}|||${addressKey(to)}`;
}

function tokenizeAddress(address) {
  return normalizeText(address)
    .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|place|pl|crescent|cres|circle|cir|parkway|pkwy|unit|suite|apt)\b/g, " ")
    .split(/[,\s]+/)
    .filter((x) => x.length > 1);
}

function fallbackAddressScore(a, b) {
  const aTokens = new Set(tokenizeAddress(a));
  const bTokens = new Set(tokenizeAddress(b));
  let score = 0;

  for (const token of aTokens) {
    if (bTokens.has(token)) score += 1;
  }

  return score;
}

function getMatrixMinutes(matrix, from, to) {
  if (!from || !to) return 9999;
  if (addressKey(from) === addressKey(to)) return 0;

  const value = matrix.get(matrixKey(from, to));
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const fallback = fallbackAddressScore(from, to);
  if (fallback >= 4) return 15;
  if (fallback >= 2) return 30;
  return 75;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function buildDrivingTimeMatrix(addresses) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const matrix = new Map();

  const uniqueAddresses = Array.from(
    new Set(addresses.map((a) => String(a || "").trim()).filter(Boolean))
  );

  if (!apiKey) {
    return {
      matrix,
      diagnostics: {
        success: false,
        reason: "Missing GOOGLE_MAPS_API_KEY, using fallback scoring",
        address_count: uniqueAddresses.length,
      },
    };
  }

  const originChunks = chunkArray(uniqueAddresses, 10);
  const destinationChunks = chunkArray(uniqueAddresses, 10);
  const errors = [];

  for (const origins of originChunks) {
    for (const destinations of destinationChunks) {
      const params = new URLSearchParams({
        origins: origins.join("|"),
        destinations: destinations.join("|"),
        mode: "driving",
        units: "metric",
        key: apiKey,
      });

      try {
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`
        );

        const data = await response.json();

        if (data.status !== "OK") {
          errors.push({
            status: data.status,
            message: data.error_message || "Distance Matrix request failed",
          });
          continue;
        }

        (data.rows || []).forEach((row, originIndex) => {
          const origin = origins[originIndex];

          (row.elements || []).forEach((element, destinationIndex) => {
            const destination = destinations[destinationIndex];

            if (element.status === "OK") {
              const seconds = element.duration_in_traffic?.value || element.duration?.value;
              if (typeof seconds === "number") {
                matrix.set(matrixKey(origin, destination), Math.round(seconds / 60));
              }
            }
          });
        });
      } catch (err) {
        errors.push({
          status: "FETCH_ERROR",
          message: err.message || "Distance Matrix fetch failed",
        });
      }
    }
  }

  return {
    matrix,
    diagnostics: {
      success: errors.length === 0,
      address_count: uniqueAddresses.length,
      pair_count: matrix.size,
      errors,
    },
  };
}

function jobIsEligibleForTech(job, state, serviceDate) {
  if (!techCanDoService(state.tech, job)) return false;
  if (!techWorksOnServiceDate(state.tech, serviceDate)) return false;
  if (state.route.length >= state.maxJobs) return false;
  return true;
}

function buildTechStates(techs, serviceDate) {
  return techs.map((tech) => ({
    tech,
    techId: tech.id,
    techName: getTechName(tech),
    rank: getTechRank(tech),
    homeAddress: tech.home_address || "",
    shiftStart: getTechShiftStart(tech, serviceDate),
    route: [],
    maxJobs: getTechMaxJobs(tech),
  }));
}

function sortJobsForPlanning(jobs, serviceDate) {
  return [...jobs]
    .filter((job) => job?.address && job?.arrival_window_start)
    .sort((a, b) => {
      const ac = getCorridor(a.address);
      const bc = getCorridor(b.address);

      if (ac !== bc) return ac.localeCompare(bc);

      const at = parseTimeOnDate(serviceDate, a.arrival_window_start, "09:00:00").getTime();
      const bt = parseTimeOnDate(serviceDate, b.arrival_window_start, "09:00:00").getTime();

      return at - bt;
    });
}

function calculateRouteDriveMinutes(state, stops, matrix) {
  if (!state.homeAddress || !stops.length) return 0;

  let total = 0;
  let previous = state.homeAddress;

  for (const stop of stops) {
    total += getMatrixMinutes(matrix, previous, stop.address);
    previous = stop.address;
  }

  if (FLEET_RETURN_HOME_SCORING) {
    total += getMatrixMinutes(matrix, previous, state.homeAddress);
  }

  return total;
}

function buildStopFromJob(job, existing = false) {
  return {
    job,
    jobId: job.id,
    title: job.title,
    originalTitle: job.title,
    service_type: normalizeServiceKey(job.service_type),
    address: job.address,
    corridor: getCorridor(job.address),
    plannedStart: null,
    plannedEnd: null,
    existing,
    routeOrder: null,
  };
}

function rebuildSchedule(state, serviceDate, matrix) {
  let current = new Date(state.shiftStart.getTime());
  let previous = state.homeAddress;

  state.route = state.route.map((stop, index) => {
    const travel = getMatrixMinutes(matrix, previous, stop.address);
    current = addMinutes(current, travel);

    const job = stop.job || stop;
    const duration = getServiceDurationMinutes(job.service_type, job.title, job.raw_description);

    const plannedStart = new Date(current.getTime());
    const plannedEnd = addMinutes(plannedStart, duration);

    current = addMinutes(plannedEnd, DEFAULT_TRAVEL_BUFFER_MINUTES);
    previous = stop.address;

    return {
      ...stop,
      plannedStart: plannedStart.toISOString(),
      plannedEnd: plannedEnd.toISOString(),
      routeOrder: index + 1,
    };
  });
}

function routeTimeViolationMinutes(state, stops, serviceDate, matrix) {
  let violation = 0;
  let current = new Date(state.shiftStart.getTime());
  let previous = state.homeAddress;

  for (const stop of stops) {
    const job = stop.job || stop;

    current = addMinutes(current, getMatrixMinutes(matrix, previous, stop.address));

    const windowStart = parseTimeOnDate(serviceDate, job.arrival_window_start, "09:00:00");
    const windowEnd = parseTimeOnDate(
      serviceDate,
      job.arrival_window_end || job.arrival_window_start,
      "12:00:00"
    );

    const tooEarlyLimit = addMinutes(windowStart, -MAX_EARLY_MINUTES);
    const tooLateLimit = addMinutes(windowEnd, MAX_LATE_MINUTES);

    if (current < tooEarlyLimit) {
      violation += Math.round((tooEarlyLimit.getTime() - current.getTime()) / 60000);
    }

    if (current > tooLateLimit) {
      violation += Math.round((current.getTime() - tooLateLimit.getTime()) / 60000);
    }

    const duration = getServiceDurationMinutes(job.service_type, job.title, job.raw_description);
    current = addMinutes(current, duration + DEFAULT_TRAVEL_BUFFER_MINUTES);
    previous = stop.address;
  }

  return violation;
}

function getLoadBalancePenalty(state, techStates, matrix, job) {
  const availableEligibleTechs = techStates.filter(
    (s) => s.route.length === 0 && jobIsEligibleForTech(job, s, new Date().toISOString().slice(0, 10))
  );

  const hasEmptyEligibleTech = availableEligibleTechs.length > 0;
  const techAlreadyHasJob = state.route.length > 0;

  if (!hasEmptyEligibleTech || !techAlreadyHasJob) return 0;

  const closestExisting = state.route.reduce((min, stop) => {
    return Math.min(min, getMatrixMinutes(matrix, stop.address, job.address));
  }, 9999);

  if (closestExisting <= CLUMP_DISTANCE_MINUTES) return -100;

  return 900;
}

function getRankPenalty(state) {
  return state.rank * 8;
}

function findBestInsertionForJob(state, techStates, job, serviceDate, matrix) {
  if (!jobIsEligibleForTech(job, state, serviceDate)) return null;

  const currentDrive = calculateRouteDriveMinutes(state, state.route, matrix);
  const currentViolation = routeTimeViolationMinutes(state, state.route, serviceDate, matrix);

  let best = null;

  for (let position = 0; position <= state.route.length; position++) {
    const candidateStop = buildStopFromJob(job, false);

    const candidateStops = [
      ...state.route.slice(0, position),
      candidateStop,
      ...state.route.slice(position),
    ];

    const newDrive = calculateRouteDriveMinutes(state, candidateStops, matrix);
    const newViolation = routeTimeViolationMinutes(state, candidateStops, serviceDate, matrix);

    const driveIncrease = newDrive - currentDrive;
    const timeViolationIncrease = newViolation - currentViolation;

    const score =
      driveIncrease * 20 +
      timeViolationIncrease * 60 +
      getLoadBalancePenalty(state, techStates, matrix, job) +
      getRankPenalty(state);

    if (!best || score < best.score) {
      best = {
        state,
        job,
        position,
        score,
        driveIncrease,
        timeViolationIncrease,
      };
    }
  }

  return best;
}

function addJobToStateAtPosition({ state, job, position, serviceDate, matrix, existing = false }) {
  const stop = buildStopFromJob(job, existing);

  state.route = [
    ...state.route.slice(0, position),
    stop,
    ...state.route.slice(position),
  ];

  rebuildSchedule(state, serviceDate, matrix);
}

function makeAssignmentFromStop(state, stop) {
  const job = stop.job || stop;

  return {
    job_id: job.id,
    tech_id: state.techId,
    tech_name: state.techName,
    tech_email: state.tech.email || null,
    address: job.address,
    service_type: normalizeServiceKey(job.service_type),
    google_event_id: job.google_event_id || null,
    calendar_name: job.calendar_name || null,
    route_order: stop.routeOrder,
    planned_start: stop.plannedStart,
    planned_end: stop.plannedEnd,
    skipped: Boolean(stop.existing),
  };
}

async function planRoutes(jobs, techs, serviceDate, forceReassign, matrix) {
  const techStates = buildTechStates(techs, serviceDate);
  const orderedJobs = sortJobsForPlanning(jobs, serviceDate);
  const unassignedJobs = [];

  if (!forceReassign) {
    for (const job of orderedJobs) {
      if (!job.assigned_technician_id) continue;

      const existingTech = techStates.find(
        (s) => String(s.techId) === String(job.assigned_technician_id)
      );

      if (!existingTech) continue;

      addJobToStateAtPosition({
        state: existingTech,
        job,
        position: existingTech.route.length,
        serviceDate,
        matrix,
        existing: true,
      });
    }
  }

  const assignedIds = new Set();

  for (const state of techStates) {
    for (const stop of state.route) {
      assignedIds.add(String((stop.job || stop).id));
    }
  }

  const remainingJobs = orderedJobs.filter((job) => {
    if (assignedIds.has(String(job.id))) return false;
    if (!forceReassign && job.assigned_technician_id) return false;
    return true;
  });

  while (remainingJobs.length > 0) {
    let bestMove = null;

    for (const job of remainingJobs) {
      for (const state of techStates) {
        const candidate = findBestInsertionForJob(state, techStates, job, serviceDate, matrix);
        if (!candidate) continue;

        if (!bestMove || candidate.score < bestMove.score) {
          bestMove = candidate;
        }
      }
    }

    if (!bestMove) {
      for (const job of remainingJobs) {
        unassignedJobs.push({
          job_id: job.id,
          title: job.title,
          address: job.address,
          service_type: normalizeServiceKey(job.service_type),
          reason: "No eligible tech found based on service, day, capacity, or timing rules",
        });
      }
      break;
    }

    addJobToStateAtPosition({
      state: bestMove.state,
      job: bestMove.job,
      position: bestMove.position,
      serviceDate,
      matrix,
      existing: false,
    });

    const index = remainingJobs.findIndex((j) => String(j.id) === String(bestMove.job.id));
    if (index >= 0) remainingJobs.splice(index, 1);
  }

  for (const state of techStates) rebuildSchedule(state, serviceDate, matrix);

  const assignments = [];

  for (const state of techStates) {
    for (const stop of state.route) {
      assignments.push(makeAssignmentFromStop(state, stop));
    }
  }

  return {
    assignments,
    unassignedJobs,
    routes: techStates.map((state) => ({
      tech_id: state.techId,
      tech_name: state.techName,
      tech_email: state.tech.email || null,
      home_address: state.homeAddress,
      rank: state.rank,
      services: getTechServiceKeys(state.tech),
      working_days: getWorkingDays(state.tech),
      max_jobs_per_day: state.maxJobs,
      assigned_jobs_count: state.route.length,
      estimated_drive_minutes_including_return_home: calculateRouteDriveMinutes(state, state.route, matrix),
      time_violation_minutes: routeTimeViolationMinutes(state, state.route, serviceDate, matrix),
      stops: state.route.map((stop) => {
        const job = stop.job || stop;

        return {
          jobId: job.id,
          title: stop.title || job.title,
          originalTitle: stop.originalTitle || job.title,
          service_type: normalizeServiceKey(job.service_type),
          address: job.address,
          corridor: stop.corridor || getCorridor(job.address),
          plannedStart: stop.plannedStart,
          plannedEnd: stop.plannedEnd,
          existing: Boolean(stop.existing),
          routeOrder: stop.routeOrder,
        };
      }),
    })),
  };
}

function buildOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId) throw new Error("Missing GOOGLE_CLIENT_ID");
  if (!clientSecret) throw new Error("Missing GOOGLE_CLIENT_SECRET");
  if (!refreshToken) throw new Error("Missing GOOGLE_REFRESH_TOKEN");

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return oauth2Client;
}

async function listTargetCalendars(calendarApi) {
  const response = await calendarApi.calendarList.list();
  const calendars = response.data.items || [];

  return calendars.filter((cal) =>
    TARGET_CALENDAR_NAMES.includes(String(cal.summary || "").trim())
  );
}

async function syncTechnicianGuestToGoogleEvent({
  calendarApi,
  calendarIdByName,
  allTechnicianEmails,
  job,
  assignedTech,
}) {
  if (!job?.google_event_id) return { success: false, reason: "Missing google_event_id" };
  if (!job?.calendar_name) return { success: false, reason: "Missing calendar_name" };
  if (!assignedTech?.email) return { success: false, reason: "Assigned technician missing email" };

  const calendarId = calendarIdByName.get(String(job.calendar_name).trim());

  if (!calendarId) {
    return { success: false, reason: `Calendar not found for ${job.calendar_name}` };
  }

  const existingEventResponse = await calendarApi.events.get({
    calendarId,
    eventId: job.google_event_id,
  });

  const existingAttendees = Array.isArray(existingEventResponse.data?.attendees)
    ? existingEventResponse.data.attendees
    : [];

  const filteredAttendees = existingAttendees.filter((attendee) => {
    const email = String(attendee?.email || "").toLowerCase().trim();
    return email && !allTechnicianEmails.has(email);
  });

  const assignedEmail = String(assignedTech.email).toLowerCase().trim();

  await calendarApi.events.patch({
    calendarId,
    eventId: job.google_event_id,
    sendUpdates: "all",
    requestBody: {
      attendees: [
        ...filteredAttendees,
        {
          email: assignedEmail,
          displayName: getTechName(assignedTech),
          responseStatus: "needsAction",
        },
      ],
    },
  });

  return {
    success: true,
    calendar_name: job.calendar_name,
    google_event_id: job.google_event_id,
    tech_email: assignedEmail,
  };
}

async function renameGoogleCalendarEvent({ calendarApi, calendarIdByName, job, tech, order }) {
  if (!job?.google_event_id || !job?.calendar_name) {
    return { success: false, reason: "Missing google_event_id or calendar_name" };
  }

  const calendarId = calendarIdByName.get(String(job.calendar_name).trim());

  if (!calendarId) {
    return { success: false, reason: `Calendar not found for ${job.calendar_name}` };
  }

  const newTitle = buildRoutedTitle({ order, tech, originalTitle: job.title });

  await calendarApi.events.patch({
    calendarId,
    eventId: job.google_event_id,
    requestBody: { summary: newTitle },
  });

  const { error } = await supabaseAdmin
    .from("jobs")
    .update({
      title: newTitle,
      route_order: order,
    })
    .eq("id", job.id);

  if (error) {
    await supabaseAdmin.from("jobs").update({ title: newTitle }).eq("id", job.id);
  }

  return {
    success: true,
    job_id: job.id,
    calendar_name: job.calendar_name,
    google_event_id: job.google_event_id,
    new_title: newTitle,
    route_order: order,
  };
}

async function renameRoutedCalendarEvents({ calendarApi, calendarIdByName, routes, jobs, technicianById }) {
  const results = [];

  for (const route of routes) {
    const tech = technicianById.get(String(route.tech_id));
    if (!tech || !route.stops?.length) continue;

    for (let i = 0; i < route.stops.length; i++) {
      const stop = route.stops[i];
      const job = jobs.find((j) => String(j.id) === String(stop.jobId));

      if (!job) {
        results.push({
          success: false,
          job_id: stop.jobId,
          reason: "Job not found for title rewrite",
        });
        continue;
      }

      try {
        const result = await renameGoogleCalendarEvent({
          calendarApi,
          calendarIdByName,
          job,
          tech,
          order: i + 1,
        });

        stop.title = result.new_title;
        stop.routeOrder = i + 1;

        results.push({ ...result, tech_name: getTechName(tech) });
      } catch (err) {
        results.push({
          success: false,
          job_id: job.id,
          tech_name: getTechName(tech),
          reason: err.message || "Failed to rename calendar event",
        });
      }
    }
  }

  return results;
}

function formatTime12h(timeValue) {
  if (!timeValue) return "-";

  const raw = String(timeValue).trim();

  if (raw.includes("T")) {
    const dt = new Date(raw);
    if (!Number.isNaN(dt.getTime())) {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Toronto",
        hour: "numeric",
        minute: "2-digit",
      }).format(dt);
    }
  }

  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return raw;

  const hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;

  return `${hour12}:${minute} ${suffix}`;
}

function buildGoogleMapsLinkForRoute(route) {
  if (!route?.stops?.length) return "";

  const addresses = [];

  if (route.home_address) addresses.push(route.home_address);

  for (const stop of route.stops) {
    if (stop.address) addresses.push(stop.address);
  }

  const cleaned = addresses.map((a) => String(a || "").trim()).filter(Boolean);
  if (cleaned.length < 2) return "";

  const origin = encodeURIComponent(cleaned[0]);
  const destination = encodeURIComponent(cleaned[cleaned.length - 1]);
  const waypoints = cleaned.slice(1, -1).map(encodeURIComponent).join("|");

  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;

  if (waypoints) url += `&waypoints=${waypoints}`;

  return url;
}

function escapeHeader(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function buildRouteEmailBody({ serviceDate, route }) {
  const lines = [];

  lines.push(`Hi ${route.tech_name || "Technician"},`);
  lines.push("");
  lines.push(`Here is your route for ${serviceDate}:`);
  lines.push("");

  if (!route.stops?.length) {
    lines.push("No jobs assigned.");
  } else {
    route.stops.forEach((stop, index) => {
      lines.push(`${index + 1}. ${formatTime12h(stop.plannedStart)} - ${stop.title || "Job"}`);
      lines.push(`   Service: ${normalizeServiceKey(stop.service_type)}`);
      lines.push(`   Address: ${stop.address || "-"}`);
      lines.push("");
    });
  }

  const mapsLink = buildGoogleMapsLinkForRoute(route);

  if (mapsLink) {
    lines.push("Google Maps route:");
    lines.push(mapsLink);
    lines.push("");
  }

  lines.push("Please reply if anything looks off.");
  lines.push("");
  lines.push("Deep Cleans Routing");

  return lines.join("\n");
}

function buildRawEmail({ from, to, subject, body }) {
  const message = [
    `From: ${escapeHeader(from)}`,
    `To: ${escapeHeader(to)}`,
    `Subject: ${escapeHeader(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body,
  ].join("\r\n");

  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sendRouteEmail({ gmailApi, fromEmail, route, serviceDate }) {
  if (!route?.tech_email) {
    return { success: false, reason: "Missing technician email" };
  }

  await gmailApi.users.messages.send({
    userId: "me",
    requestBody: {
      raw: buildRawEmail({
        from: fromEmail,
        to: route.tech_email,
        subject: `Your Route for ${serviceDate}`,
        body: buildRouteEmailBody({ serviceDate, route }),
      }),
    },
  });

  return {
    success: true,
    tech_name: route.tech_name,
    tech_email: route.tech_email,
  };
}

export default async function handler(req, res) {
  try {
    const serviceDate =
      req.method === "POST" && req.body?.service_date
        ? req.body.service_date
        : getTomorrowDateToronto();

    const forceReassign =
      String(req.query?.force || req.body?.force || "")
        .toLowerCase()
        .trim() === "true";

    const { data: jobs, error: jobsError } = await supabaseAdmin
      .from("jobs")
      .select("*")
      .eq("service_date", serviceDate)
      .order("arrival_window_start", { ascending: true });

    if (jobsError) throw jobsError;

    const { data: techs, error: techError } = await supabaseAdmin
      .from("technicians")
      .select("*")
      .eq("is_active", true)
      .order("rank_position", { ascending: true, nullsFirst: false });

    if (techError) throw techError;

    if (!techs?.length) {
      return res.status(400).json({
        success: false,
        message: "No active technicians found",
      });
    }

    const addressesForMatrix = [
      ...(jobs || []).map((job) => job.address),
      ...(techs || []).map((tech) => tech.home_address),
    ].filter(Boolean);

    const { matrix, diagnostics } = await buildDrivingTimeMatrix(addressesForMatrix);

    const { assignments, unassignedJobs, routes } = await planRoutes(
      jobs || [],
      techs,
      serviceDate,
      forceReassign,
      matrix
    );

    for (const assignment of assignments) {
      if (assignment.skipped) continue;

      const { error } = await supabaseAdmin
        .from("jobs")
        .update({
          assigned_technician_id: assignment.tech_id,
          route_order: assignment.route_order,
        })
        .eq("id", assignment.job_id);

      if (error) {
        await supabaseAdmin
          .from("jobs")
          .update({
            assigned_technician_id: assignment.tech_id,
          })
          .eq("id", assignment.job_id);
      }
    }

    const auth = buildOAuthClient();
    const calendarApi = google.calendar({ version: "v3", auth });
    const gmailApi = google.gmail({ version: "v1", auth });

    const calendars = await listTargetCalendars(calendarApi);

    const calendarIdByName = new Map(
      calendars.map((cal) => [String(cal.summary || "").trim(), cal.id])
    );

    const technicianById = new Map(techs.map((tech) => [String(tech.id), tech]));

    const allTechnicianEmails = new Set(
      techs.map((tech) => String(tech.email || "").toLowerCase().trim()).filter(Boolean)
    );

    const senderEmail = process.env.GOOGLE_SENDER_EMAIL || process.env.GMAIL_SENDER_EMAIL;

    if (!senderEmail) throw new Error("Missing GOOGLE_SENDER_EMAIL");

    const inviteResults = [];

    for (const assignment of assignments) {
      const job = jobs.find((j) => String(j.id) === String(assignment.job_id));
      const tech = technicianById.get(String(assignment.tech_id));

      if (!job || !tech) continue;

      try {
        const result = await syncTechnicianGuestToGoogleEvent({
          calendarApi,
          calendarIdByName,
          allTechnicianEmails,
          job,
          assignedTech: tech,
        });

        inviteResults.push({
          ...result,
          job_id: assignment.job_id,
          tech_name: getTechName(tech),
        });
      } catch (err) {
        inviteResults.push({
          success: false,
          job_id: assignment.job_id,
          tech_name: tech ? getTechName(tech) : null,
          reason: err.message || "Failed to invite tech",
        });
      }
    }

    const titleRewriteResults = await renameRoutedCalendarEvents({
      calendarApi,
      calendarIdByName,
      routes,
      jobs: jobs || [],
      technicianById,
    });

    const emailResults = [];

    for (const route of routes) {
      if (!route.tech_email || !route.stops?.length) continue;

      try {
        const result = await sendRouteEmail({
          gmailApi,
          fromEmail: senderEmail,
          route,
          serviceDate,
        });

        emailResults.push(result);
      } catch (err) {
        emailResults.push({
          success: false,
          tech_name: route.tech_name,
          tech_email: route.tech_email,
          reason: err.message || "Failed to send route email",
        });
      }
    }

    return res.status(200).json({
      success: true,
      service_date: serviceDate,
      force_reassign: forceReassign,
      routing_rules:
        "Eligible techs only. Available techs get one job before stacking unless under 15 minutes apart. Arrival must stay within 2 hours early or 2 hours late. Ranking breaks close decisions. Fleet mileage and individual routes are both considered.",
      total_jobs: jobs.length,
      total_technicians: techs.length,
      assigned_count: assignments.filter((a) => !a.skipped).length,
      preserved_count: assignments.filter((a) => a.skipped).length,
      unassigned_count: unassignedJobs.length,
      distance_matrix_diagnostics: diagnostics,
      assignments,
      unassigned_jobs: unassignedJobs,
      routes,
      google_invite_results: inviteResults,
      title_rewrite_results: titleRewriteResults,
      route_email_results: emailResults,
      route_email_sender: senderEmail,
    });
  } catch (err) {
    console.error("route-tomorrow error:", err);

    return res.status(500).json({
      success: false,
      error: err.message || "Unknown server error",
    });
  }
}
