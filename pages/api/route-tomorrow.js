import { google } from "googleapis";
import { supabaseAdmin } from "../../lib/supabaseAdmin";

const DEFAULT_TRAVEL_BUFFER_MINUTES = 25;

const TARGET_CALENDAR_NAMES = [
  "Jiffy Lawn Bookings",
  "Internal Booking",
  "Windows/Eaves",
  "Carpet Cleaning Bookings",
  "Residential Deep Clean Bookings",
  "BBQ Bookings",
  "Power Washing",
];

const CORRIDOR_KEYWORDS = [
  {
    name: "hamilton_burlington_oakville",
    keywords: [
      "hamilton",
      "burlington",
      "oakville",
      "dundas",
      "ancaster",
      "stoney creek",
      "grimsby",
      "waterdown",
    ],
  },
  {
    name: "mississauga_brampton_milton",
    keywords: [
      "mississauga",
      "brampton",
      "milton",
      "caledon",
      "georgetown",
      "halton hills",
    ],
  },
  {
    name: "toronto_etobicoke_york",
    keywords: [
      "toronto",
      "etobicoke",
      "york",
      "east york",
      "liberty village",
      "high park",
      "roncesvalles",
      "the beaches",
      "leslieville",
    ],
  },
  {
    name: "north_york_vaughan_richmond_hill",
    keywords: [
      "north york",
      "vaughan",
      "richmond hill",
      "thornhill",
      "maple",
      "woodbridge",
      "concord",
      "king city",
    ],
  },
  {
    name: "markham_scarborough_pickering_ajax",
    keywords: [
      "markham",
      "scarborough",
      "pickering",
      "ajax",
      "whitby",
      "oshawa",
      "stouffville",
      "uxbridge",
    ],
  },
  {
    name: "newmarket_aurora_barrie",
    keywords: [
      "newmarket",
      "aurora",
      "bradford",
      "innisfil",
      "barrie",
      "east gwillimbury",
      "georgina",
    ],
  },
];

function getTomorrowDateToronto() {
  const now = new Date();

  const torontoParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = torontoParts.find((p) => p.type === "year")?.value;
  const month = torontoParts.find((p) => p.type === "month")?.value;
  const day = torontoParts.find((p) => p.type === "day")?.value;

  const torontoDate = new Date(`${year}-${month}-${day}T12:00:00`);
  torontoDate.setDate(torontoDate.getDate() + 1);

  const yyyy = torontoDate.getFullYear();
  const mm = String(torontoDate.getMonth() + 1).padStart(2, "0");
  const dd = String(torontoDate.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
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
  if (service === "bbq" || service.includes("bbq")) return "bbq";
  if (service === "oven" || service.includes("oven") || service.includes("stove")) return "oven";
  if (service === "carpet" || service.includes("carpet")) return "carpet";

  if (
    service === "windows" ||
    service === "window" ||
    service.includes("window") ||
    service.includes("eaves")
  ) {
    return "windows";
  }

  if (service === "gutter" || service.includes("gutter")) return "gutter";

  if (
    service === "pressure-washing" ||
    service === "pressure washing" ||
    service === "power washing" ||
    service.includes("pressure") ||
    service.includes("power wash")
  ) {
    return "pressure-washing";
  }

  if (
    service === "deep-clean" ||
    service === "deep clean" ||
    service.includes("deep clean")
  ) {
    return "deep-clean";
  }

  if (service === "lawn" || service.includes("lawn")) return "lawn";

  return service;
}

function getDayKeyFromServiceDate(serviceDate) {
  const date = new Date(`${serviceDate}T12:00:00`);
  const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return keys[date.getDay()];
}

function getWorkingDays(tech) {
  if (!Array.isArray(tech.working_days) || tech.working_days.length === 0) {
    return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  }

  return tech.working_days
    .map((d) => normalizeText(d))
    .filter(Boolean)
    .map((d) => d.slice(0, 3));
}

function techWorksOnServiceDate(tech, serviceDate) {
  const dayKey = getDayKeyFromServiceDate(serviceDate);
  return getWorkingDays(tech).includes(dayKey);
}

function extractPostalPrefix(address) {
  const text = String(address || "").toUpperCase();
  const match = text.match(/\b([A-Z]\d[A-Z])\s?\d[A-Z]\d\b/);
  return match ? match[1] : null;
}

function getCorridorName(address) {
  const text = normalizeText(address);

  for (const corridor of CORRIDOR_KEYWORDS) {
    for (const keyword of corridor.keywords) {
      if (text.includes(keyword)) {
        return corridor.name;
      }
    }
  }

  const postal = extractPostalPrefix(address);

  if (!postal) return "unknown";

  if (/^L[0-9][A-Z]/.test(postal)) {
    return "hamilton_burlington_oakville";
  }

  if (/^M[0-9][A-Z]/.test(postal)) {
    return "toronto_etobicoke_york";
  }

  if (/^L6[A-Z]/.test(postal) || /^L7[A-Z]/.test(postal)) {
    return "mississauga_brampton_milton";
  }

  return "unknown";
}

function tokenizeAddress(address) {
  const cleaned = normalizeText(address)
    .replace(
      /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|place|pl|crescent|cres|circle|cir|parkway|pkwy|unit|suite|ste|apt|apartment)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return [];

  const stopWords = new Set([
    "on",
    "ontario",
    "canada",
    "north",
    "south",
    "east",
    "west",
    "the",
    "and",
  ]);

  return cleaned
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token && token.length > 1 && !stopWords.has(token));
}

function overlapScore(a, b) {
  const aTokens = new Set(tokenizeAddress(a));
  const bTokens = new Set(tokenizeAddress(b));

  let score = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) score += 1;
  }

  const aPostal = extractPostalPrefix(a);
  const bPostal = extractPostalPrefix(b);
  if (aPostal && bPostal && aPostal === bPostal) score += 5;

  return score;
}

function getServiceDurationMinutes(serviceType, title, description) {
  const service = normalizeServiceKey(serviceType);
  const combined = normalizeText(`${title || ""} ${description || ""}`);

  if (service === "bbq") return 150;
  if (service === "oven") return 120;
  if (service === "carpet") return 120;
  if (service === "windows") return 180;
  if (service === "gutter") return 180;
  if (service === "pressure-washing") return 180;
  if (service === "deep-clean") return 240;
  if (service === "lawn") return 90;

  if (service === "general") {
    if (combined.includes("bbq")) return 150;
    if (combined.includes("oven")) return 120;
    if (combined.includes("carpet")) return 120;
    if (combined.includes("window")) return 180;
    if (combined.includes("gutter")) return 180;
    if (combined.includes("pressure")) return 180;
    if (combined.includes("power wash")) return 180;
    if (combined.includes("deep clean")) return 240;
  }

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
  const name = getTechName(tech);
  return String(name || "Tech").trim().split(/\s+/)[0] || "Tech";
}

function getOrdinal(n) {
  const value = Number(n);
  if (value === 1) return "1st";
  if (value === 2) return "2nd";
  if (value === 3) return "3rd";
  return `${value}th`;
}

function stripExistingRoutePrefix(title) {
  return String(title || "")
    .replace(/^\s*\d+(st|nd|rd|th)\s+[a-zA-Z]+\s+/i, "")
    .trim();
}

function buildRoutedTitle({ order, tech, originalTitle }) {
  const cleanTitle = stripExistingRoutePrefix(originalTitle);
  const firstName = getTechFirstName(tech);
  return `${getOrdinal(order)} ${firstName} ${cleanTitle}`;
}

function getTechServiceKeys(tech) {
  if (!Array.isArray(tech.services)) return [];
  return tech.services.map(normalizeServiceKey).filter(Boolean);
}

function techCanDoService(tech, job) {
  const techServices = getTechServiceKeys(tech);
  if (!techServices.length) return true;

  const jobService = normalizeServiceKey(job.service_type);
  if (!jobService || jobService === "general") return true;

  return techServices.includes(jobService);
}

function getTechShiftStart(tech, serviceDate) {
  return parseTimeOnDate(
    serviceDate,
    tech.work_start_time || "08:00:00",
    "08:00:00"
  );
}

function getTechShiftEnd(tech, serviceDate) {
  return parseTimeOnDate(
    serviceDate,
    tech.work_end_time || "17:00:00",
    "17:00:00"
  );
}

function getTechMaxJobs(tech) {
  const value = Number(tech.max_jobs_per_day);
  if (Number.isFinite(value) && value > 0) return value;
  return 5;
}

function buildTechStates(techs, serviceDate) {
  return techs.map((tech, index) => {
    const shiftStart = getTechShiftStart(tech, serviceDate);
    const shiftEnd = getTechShiftEnd(tech, serviceDate);
    const homeCorridor = getCorridorName(tech.home_address || "");

    return {
      tech,
      techId: tech.id,
      techName: getTechName(tech),
      homeAddress: tech.home_address || "",
      homeCorridor,
      activeCorridors: new Set(homeCorridor !== "unknown" ? [homeCorridor] : []),
      clusterAnchor: tech.home_address || "",
      sequence: index,
      route: [],
      shiftStart,
      shiftEnd,
      nextAvailable: shiftStart,
      maxJobs: getTechMaxJobs(tech),
    };
  });
}

function sortJobsForPlanning(jobs, serviceDate) {
  return [...jobs]
    .filter((job) => job?.address && job?.arrival_window_start)
    .sort((a, b) => {
      const aStart = parseTimeOnDate(
        serviceDate,
        a.arrival_window_start,
        "09:00:00"
      ).getTime();

      const bStart = parseTimeOnDate(
        serviceDate,
        b.arrival_window_start,
        "09:00:00"
      ).getTime();

      return aStart - bStart;
    });
}

function jobIsEligibleForTech(job, state, serviceDate) {
  if (!techCanDoService(state.tech, job)) return false;
  if (!techWorksOnServiceDate(state.tech, serviceDate)) return false;
  if (state.route.length >= state.maxJobs) return false;
  return true;
}

function corridorScore(job, state) {
  const jobCorridor = getCorridorName(job.address || "");
  let score = 0;

  if (jobCorridor !== "unknown" && jobCorridor === state.homeCorridor) {
    score += 250;
  }

  if (jobCorridor !== "unknown" && state.activeCorridors.has(jobCorridor)) {
    score += 400;
  }

  if (state.activeCorridors.size > 0 && jobCorridor !== "unknown" && !state.activeCorridors.has(jobCorridor)) {
    score -= 350;
  }

  return score;
}

function addressProximityScore(job, address) {
  const base = overlapScore(job.address || "", address || "") * 40;

  const jobPostal = extractPostalPrefix(job.address || "");
  const addressPostal = extractPostalPrefix(address || "");

  const postalBoost =
    jobPostal && addressPostal && jobPostal === addressPostal ? 150 : 0;

  return base + postalBoost;
}

function timeWindowSoftPenalty(job, plannedStart, serviceDate) {
  const windowStart = parseTimeOnDate(
    serviceDate,
    job.arrival_window_start,
    "09:00:00"
  );

  const windowEnd = parseTimeOnDate(
    serviceDate,
    job.arrival_window_end || job.arrival_window_start,
    "12:00:00"
  );

  if (plannedStart >= windowStart && plannedStart <= windowEnd) return 0;

  const earlyMinutes = Math.max(
    0,
    Math.round((windowStart.getTime() - plannedStart.getTime()) / 60000)
  );

  const lateMinutes = Math.max(
    0,
    Math.round((plannedStart.getTime() - windowEnd.getTime()) / 60000)
  );

  if (earlyMinutes > 0) {
    return Math.min(earlyMinutes, 90) * 0.6;
  }

  if (lateMinutes > 0) {
    return Math.min(lateMinutes, 90) * 1.2 + Math.max(0, lateMinutes - 90) * 3;
  }

  return 0;
}

function chooseBestTech(job, techStates, serviceDate) {
  const eligibleTechStates = techStates.filter((state) =>
    jobIsEligibleForTech(job, state, serviceDate)
  );

  if (!eligibleTechStates.length) return null;

  let best = null;

  for (const state of eligibleTechStates) {
    const lastStopAddress =
      state.route.length > 0
        ? state.route[state.route.length - 1].address
        : state.homeAddress;

    const plannedStart = state.nextAvailable;

    const score =
      corridorScore(job, state) +
      addressProximityScore(job, lastStopAddress) * 1.4 +
      addressProximityScore(job, state.clusterAnchor) * 1.2 +
      addressProximityScore(job, state.homeAddress) * 0.7 -
      timeWindowSoftPenalty(job, plannedStart, serviceDate) -
      state.route.length * 20;

    if (!best || score > best.score) {
      best = {
        state,
        score,
      };
    }
  }

  return best;
}

function addJobToStateRoute({ state, job, serviceDate, existing }) {
  const durationMinutes = getServiceDurationMinutes(
    job.service_type,
    job.title,
    job.raw_description
  );

  const plannedStart = state.nextAvailable;
  const plannedEnd = addMinutes(plannedStart, durationMinutes);
  const routeOrder = state.route.length + 1;

  const jobCorridor = getCorridorName(job.address || "");
  if (jobCorridor !== "unknown") {
    state.activeCorridors.add(jobCorridor);
  }

  if (!state.clusterAnchor || state.clusterAnchor === state.homeAddress) {
    state.clusterAnchor = job.address || state.clusterAnchor;
  }

  state.route.push({
    jobId: job.id,
    title: job.title,
    originalTitle: job.title,
    service_type: normalizeServiceKey(job.service_type),
    address: job.address,
    plannedStart: plannedStart.toISOString(),
    plannedEnd: plannedEnd.toISOString(),
    existing,
    routeOrder,
  });

  state.nextAvailable = addMinutes(plannedEnd, DEFAULT_TRAVEL_BUFFER_MINUTES);

  return {
    job_id: job.id,
    tech_id: state.techId,
    tech_name: state.techName,
    tech_email: state.tech.email || null,
    address: job.address,
    service_type: normalizeServiceKey(job.service_type),
    google_event_id: job.google_event_id || null,
    calendar_name: job.calendar_name || null,
    route_order: routeOrder,
    planned_start: plannedStart.toISOString(),
    planned_end: plannedEnd.toISOString(),
    skipped: existing,
  };
}

function seedFirstJobForEachTech(remainingJobs, techStates, serviceDate, assignments) {
  for (const state of techStates) {
    if (!techWorksOnServiceDate(state.tech, serviceDate)) continue;
    if (state.route.length > 0) continue;
    if (state.route.length >= state.maxJobs) continue;

    let best = null;

    for (const job of remainingJobs) {
      if (!jobIsEligibleForTech(job, state, serviceDate)) continue;

      const score =
        corridorScore(job, state) +
        addressProximityScore(job, state.homeAddress) * 2 -
        timeWindowSoftPenalty(job, state.nextAvailable, serviceDate);

      if (!best || score > best.score) {
        best = { job, score };
      }
    }

    if (!best) continue;

    const assignment = addJobToStateRoute({
      state,
      job: best.job,
      serviceDate,
      existing: false,
    });

    assignments.push(assignment);

    const index = remainingJobs.findIndex(
      (job) => String(job.id) === String(best.job.id)
    );

    if (index >= 0) remainingJobs.splice(index, 1);
  }
}

function planRoutes(jobs, techs, serviceDate, forceReassign) {
  const techStates = buildTechStates(techs, serviceDate);
  const orderedJobs = sortJobsForPlanning(jobs, serviceDate);
  const assignments = [];
  const unassignedJobs = [];

  if (!forceReassign) {
    for (const job of orderedJobs) {
      if (!job?.address || !job?.arrival_window_start) continue;
      if (!job.assigned_technician_id) continue;

      const existingTech = techStates.find(
        (state) => String(state.techId) === String(job.assigned_technician_id)
      );

      if (!existingTech) continue;

      const assignment = addJobToStateRoute({
        state: existingTech,
        job,
        serviceDate,
        existing: true,
      });

      assignments.push(assignment);
    }
  }

  const assignedJobIds = new Set(assignments.map((a) => String(a.job_id)));

  const remainingJobs = orderedJobs.filter((job) => {
    if (!job?.address || !job?.arrival_window_start) return false;
    if (!forceReassign && job.assigned_technician_id) return false;
    return !assignedJobIds.has(String(job.id));
  });

  seedFirstJobForEachTech(remainingJobs, techStates, serviceDate, assignments);

  let guard = 0;

  while (remainingJobs.length > 0 && guard < 1000) {
    guard += 1;

    let bestMove = null;

    for (const job of remainingJobs) {
      const best = chooseBestTech(job, techStates, serviceDate);
      if (!best) continue;

      if (!bestMove || best.score > bestMove.score) {
        bestMove = {
          job,
          state: best.state,
          score: best.score,
        };
      }
    }

    if (!bestMove) {
      for (const job of remainingJobs) {
        unassignedJobs.push({
          job_id: job.id,
          title: job.title,
          address: job.address,
          service_type: normalizeServiceKey(job.service_type),
          corridor: getCorridorName(job.address || ""),
          reason: "No eligible technician found within skill/day/capacity constraints",
        });
      }
      break;
    }

    const assignment = addJobToStateRoute({
      state: bestMove.state,
      job: bestMove.job,
      serviceDate,
      existing: false,
    });

    assignments.push(assignment);

    const index = remainingJobs.findIndex(
      (job) => String(job.id) === String(bestMove.job.id)
    );

    if (index >= 0) remainingJobs.splice(index, 1);
  }

  return {
    assignments,
    unassignedJobs,
    routes: techStates.map((state) => ({
      tech_id: state.techId,
      tech_name: state.techName,
      tech_email: state.tech.email || null,
      home_address: state.homeAddress,
      home_corridor: state.homeCorridor,
      active_corridors: Array.from(state.activeCorridors),
      services: getTechServiceKeys(state.tech),
      working_days: getWorkingDays(state.tech),
      work_start_time: state.tech.work_start_time || null,
      work_end_time: state.tech.work_end_time || null,
      max_jobs_per_day: state.maxJobs,
      assigned_jobs_count: state.route.length,
      stops: state.route,
    })),
  };
}

async function optimizeRouteWithGoogleMaps(route) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return {
      route,
      result: {
        success: false,
        tech_name: route.tech_name,
        reason: "Missing GOOGLE_MAPS_API_KEY, skipped optimization",
      },
    };
  }

  if (!route || !Array.isArray(route.stops) || route.stops.length <= 2) {
    return {
      route,
      result: {
        success: true,
        tech_name: route?.tech_name || null,
        reason: "Two or fewer stops, no optimization needed",
      },
    };
  }

  const validStops = route.stops.filter((stop) => stop.address);

  if (validStops.length <= 2) {
    return {
      route,
      result: {
        success: true,
        tech_name: route.tech_name,
        reason: "Two or fewer valid addresses, no optimization needed",
      },
    };
  }

  const origin = route.home_address || validStops[0].address;
  const destination = validStops[validStops.length - 1].address;
  const waypointStops = validStops.slice(0, -1);

  const params = new URLSearchParams({
    origin,
    destination,
    waypoints: `optimize:true|${waypointStops.map((s) => s.address).join("|")}`,
    mode: "driving",
    key: apiKey,
  });

  const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK") {
      return {
        route,
        result: {
          success: false,
          tech_name: route.tech_name,
          status: data.status,
          reason: data.error_message || "Google Directions optimization failed",
        },
      };
    }

    const waypointOrder = data.routes?.[0]?.waypoint_order;

    if (!Array.isArray(waypointOrder)) {
      return {
        route,
        result: {
          success: false,
          tech_name: route.tech_name,
          reason: "No waypoint_order returned by Google",
        },
      };
    }

    const reorderedWaypointStops = waypointOrder
      .map((index) => waypointStops[index])
      .filter(Boolean);

    const finalStop = validStops[validStops.length - 1];

    const optimizedStops = [...reorderedWaypointStops, finalStop].map(
      (stop, index) => ({
        ...stop,
        routeOrder: index + 1,
      })
    );

    route.stops = optimizedStops;
    route.assigned_jobs_count = optimizedStops.length;

    return {
      route,
      result: {
        success: true,
        tech_name: route.tech_name,
        original_order: validStops.map((s) => s.title || s.address),
        optimized_order: optimizedStops.map((s) => s.title || s.address),
      },
    };
  } catch (err) {
    return {
      route,
      result: {
        success: false,
        tech_name: route.tech_name,
        reason: err.message || "Google Maps optimization failed",
      },
    };
  }
}

async function optimizeAllRoutesWithGoogleMaps(routes) {
  const optimizationResults = [];

  for (let i = 0; i < routes.length; i++) {
    const { route, result } = await optimizeRouteWithGoogleMaps(routes[i]);
    routes[i] = route;
    optimizationResults.push(result);
  }

  return {
    routes,
    optimizationResults,
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
  if (!job?.google_event_id) {
    return { success: false, reason: "Missing google_event_id" };
  }

  if (!job?.calendar_name) {
    return { success: false, reason: "Missing calendar_name" };
  }

  if (!assignedTech?.email) {
    return { success: false, reason: "Assigned technician missing email" };
  }

  const calendarId = calendarIdByName.get(String(job.calendar_name).trim());
  if (!calendarId) {
    return {
      success: false,
      reason: `Calendar not found for ${job.calendar_name}`,
    };
  }

  const existingEventResponse = await calendarApi.events.get({
    calendarId,
    eventId: job.google_event_id,
  });

  const existingEvent = existingEventResponse.data || {};
  const existingAttendees = Array.isArray(existingEvent.attendees)
    ? existingEvent.attendees
    : [];

  const filteredAttendees = existingAttendees.filter((attendee) => {
    const email = String(attendee?.email || "").toLowerCase().trim();
    return email && !allTechnicianEmails.has(email);
  });

  const assignedEmail = String(assignedTech.email).toLowerCase().trim();

  const mergedAttendees = [
    ...filteredAttendees,
    {
      email: assignedEmail,
      displayName: getTechName(assignedTech),
      responseStatus: "needsAction",
    },
  ];

  await calendarApi.events.patch({
    calendarId,
    eventId: job.google_event_id,
    sendUpdates: "all",
    requestBody: {
      attendees: mergedAttendees,
    },
  });

  return {
    success: true,
    calendar_name: job.calendar_name,
    google_event_id: job.google_event_id,
    tech_email: assignedEmail,
  };
}

async function renameGoogleCalendarEvent({
  calendarApi,
  calendarIdByName,
  job,
  tech,
  order,
}) {
  if (!job?.google_event_id || !job?.calendar_name) {
    return {
      success: false,
      reason: "Missing google_event_id or calendar_name",
    };
  }

  const calendarId = calendarIdByName.get(String(job.calendar_name).trim());
  if (!calendarId) {
    return {
      success: false,
      reason: `Calendar not found for ${job.calendar_name}`,
    };
  }

  const newTitle = buildRoutedTitle({
    order,
    tech,
    originalTitle: job.title,
  });

  await calendarApi.events.patch({
    calendarId,
    eventId: job.google_event_id,
    requestBody: {
      summary: newTitle,
    },
  });

  const { error: updateError } = await supabaseAdmin
    .from("jobs")
    .update({
      title: newTitle,
    })
    .eq("id", job.id);

  if (updateError) {
    throw updateError;
  }

  return {
    success: true,
    job_id: job.id,
    google_event_id: job.google_event_id,
    calendar_name: job.calendar_name,
    new_title: newTitle,
    route_order: order,
  };
}

async function renameRoutedCalendarEvents({
  calendarApi,
  calendarIdByName,
  routes,
  jobs,
  technicianById,
}) {
  const results = [];

  for (const route of routes) {
    if (!route.stops || route.stops.length === 0) continue;

    const tech = technicianById.get(String(route.tech_id));
    if (!tech) continue;

    for (let index = 0; index < route.stops.length; index++) {
      const stop = route.stops[index];
      const order = index + 1;

      const job = (jobs || []).find(
        (j) => String(j.id) === String(stop.jobId)
      );

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
          order,
        });

        stop.title = result.new_title;
        stop.routeOrder = order;

        results.push({
          ...result,
          tech_name: getTechName(tech),
        });
      } catch (err) {
        results.push({
          success: false,
          job_id: job.id,
          tech_name: getTechName(tech),
          title: job.title || "",
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
  if (!route || !Array.isArray(route.stops) || route.stops.length === 0) return "";

  const addresses = [];

  if (route.home_address) {
    addresses.push(route.home_address);
  }

  for (const stop of route.stops) {
    if (stop.address) addresses.push(stop.address);
  }

  const cleaned = addresses
    .map((a) => String(a || "").trim())
    .filter(Boolean);

  if (cleaned.length < 2) return "";

  const origin = encodeURIComponent(cleaned[0]);
  const destination = encodeURIComponent(cleaned[cleaned.length - 1]);
  const waypoints = cleaned.slice(1, -1).map(encodeURIComponent).join("|");

  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;

  if (waypoints) {
    url += `&waypoints=${waypoints}`;
  }

  return url;
}

function escapeHeader(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function buildRouteEmailBody({ serviceDate, route }) {
  const techName = route.tech_name || "Technician";
  const mapsLink = buildGoogleMapsLinkForRoute(route);

  const lines = [];
  lines.push(`Hi ${techName},`);
  lines.push("");
  lines.push(`Here is your optimized route for ${serviceDate}:`);
  lines.push("");

  if (!route.stops || route.stops.length === 0) {
    lines.push("No jobs assigned.");
  } else {
    route.stops.forEach((stop, index) => {
      lines.push(`${index + 1}. ${formatTime12h(stop.plannedStart)} - ${stop.title || "Job"}`);
      lines.push(`   Service: ${normalizeServiceKey(stop.service_type)}`);
      lines.push(`   Address: ${stop.address || "-"}`);
      lines.push("");
    });
  }

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

  const subject = `Your Optimized Route for ${serviceDate}`;
  const body = buildRouteEmailBody({ serviceDate, route });
  const raw = buildRawEmail({
    from: fromEmail,
    to: route.tech_email,
    subject,
    body,
  });

  await gmailApi.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
    },
  });

  return {
    success: true,
    tech_name: route.tech_name,
    tech_email: route.tech_email,
    subject,
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

    if (!techs || !techs.length) {
      return res.status(400).json({
        success: false,
        message: "No active technicians found",
      });
    }

    const { assignments, unassignedJobs, routes: plannedRoutes } = planRoutes(
      jobs || [],
      techs,
      serviceDate,
      forceReassign
    );

    const { routes, optimizationResults } = await optimizeAllRoutesWithGoogleMaps(
      plannedRoutes
    );

    for (const assignment of assignments) {
      if (assignment.skipped) continue;

      const { error: updateError } = await supabaseAdmin
        .from("jobs")
        .update({
          assigned_technician_id: assignment.tech_id,
        })
        .eq("id", assignment.job_id);

      if (updateError) throw updateError;
    }

    const auth = buildOAuthClient();
    const calendarApi = google.calendar({ version: "v3", auth });
    const gmailApi = google.gmail({ version: "v1", auth });
    const calendars = await listTargetCalendars(calendarApi);

    const senderEmail =
      process.env.GOOGLE_SENDER_EMAIL ||
      process.env.GMAIL_SENDER_EMAIL;

    if (!senderEmail) {
      throw new Error("Missing GOOGLE_SENDER_EMAIL");
    }

    const calendarIdByName = new Map(
      calendars.map((cal) => [String(cal.summary || "").trim(), cal.id])
    );

    const technicianById = new Map(
      techs.map((tech) => [String(tech.id), tech])
    );

    const allTechnicianEmails = new Set(
      techs
        .map((tech) => String(tech.email || "").toLowerCase().trim())
        .filter(Boolean)
    );

    const inviteResults = [];

    for (const assignment of assignments) {
      const sourceJob = (jobs || []).find(
        (job) => String(job.id) === String(assignment.job_id)
      );

      const assignedTech = technicianById.get(String(assignment.tech_id));

      if (!sourceJob || !assignedTech) {
        inviteResults.push({
          success: false,
          job_id: assignment.job_id,
          reason: "Missing source job or technician",
        });
        continue;
      }

      try {
        const result = await syncTechnicianGuestToGoogleEvent({
          calendarApi,
          calendarIdByName,
          allTechnicianEmails,
          job: sourceJob,
          assignedTech,
        });

        inviteResults.push({
          ...result,
          job_id: assignment.job_id,
          tech_name: getTechName(assignedTech),
          title: sourceJob.title || "",
        });
      } catch (inviteError) {
        inviteResults.push({
          success: false,
          job_id: assignment.job_id,
          tech_name: assignedTech ? getTechName(assignedTech) : null,
          title: sourceJob?.title || "",
          reason: inviteError.message || "Failed to sync Google guest",
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
      if (!route.tech_email || !route.stops || route.stops.length === 0) {
        continue;
      }

      try {
        const result = await sendRouteEmail({
          gmailApi,
          fromEmail: senderEmail,
          route,
          serviceDate,
        });

        emailResults.push(result);
      } catch (emailError) {
        emailResults.push({
          success: false,
          tech_name: route.tech_name,
          tech_email: route.tech_email || null,
          reason: emailError.message || "Failed to send route email",
        });
      }
    }

    return res.status(200).json({
      success: true,
      service_date: serviceDate,
      force_reassign: forceReassign,
      total_jobs: jobs.length,
      total_technicians: techs.length,
      assigned_count: assignments.filter((a) => !a.skipped).length,
      preserved_count: assignments.filter((a) => a.skipped).length,
      unassigned_count: unassignedJobs.length,
      assignments,
      unassigned_jobs: unassignedJobs,
      routes,
      google_route_optimization_results: optimizationResults,
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
