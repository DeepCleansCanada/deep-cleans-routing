import { google } from "googleapis";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

const TARGET_CALENDAR_NAMES = [
  "Jiffy Lawn Bookings",
  "Internal Booking",
  "Windows/Eaves",
  "Carpet Cleaning Bookings",
  "Residential Deep Clean Bookings",
  "BBQ Bookings",
  "Power Washing",
];

function getTorontoDayBoundsForTomorrow() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);

  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));

  const yyyy = tomorrow.getUTCFullYear();
  const mm = String(tomorrow.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(tomorrow.getUTCDate()).padStart(2, "0");

  return {
    serviceDate: `${yyyy}-${mm}-${dd}`,
    timeMin: `${yyyy}-${mm}-${dd}T00:00:00-04:00`,
    timeMax: `${yyyy}-${mm}-${dd}T23:59:59-04:00`,
  };
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9/&\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectServiceType({ title = "", description = "", calendarName = "" }) {
  const combined = normalizeText(`${title} ${description}`);
  const calendar = normalizeText(calendarName);

  if (combined.includes("bbq")) return "bbq";
  if (combined.includes("oven")) return "oven";
  if (combined.includes("carpet")) return "carpet";
  if (combined.includes("window")) return "windows";
  if (combined.includes("eaves")) return "windows";
  if (combined.includes("gutter")) return "gutter";
  if (combined.includes("pressure wash")) return "pressure-washing";
  if (combined.includes("power wash")) return "pressure-washing";
  if (combined.includes("deep clean")) return "deep-clean";
  if (combined.includes("residential deep clean")) return "deep-clean";
  if (combined.includes("move out")) return "deep-clean";
  if (combined.includes("move-in")) return "deep-clean";
  if (combined.includes("lawn")) return "lawn";

  if (calendar.includes("bbq")) return "bbq";
  if (calendar.includes("carpet")) return "carpet";
  if (calendar.includes("windows")) return "windows";
  if (calendar.includes("eaves")) return "windows";
  if (calendar.includes("power wash")) return "pressure-washing";
  if (calendar.includes("deep clean")) return "deep-clean";
  if (calendar.includes("lawn")) return "lawn";

  return "general";
}

function extractAddress(event) {
  if (event.location && String(event.location).trim()) {
    return String(event.location).trim();
  }

  const description = String(event.description || "");
  const lines = description
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const addressLine =
    lines.find((line) => /^address\s*:/i.test(line)) ||
    lines.find((line) => /,\s*(ON|Ontario)\b/i.test(line)) ||
    lines.find((line) => /,\s*Canada\b/i.test(line));

  if (!addressLine) return "";

  return addressLine.replace(/^address\s*:/i, "").trim();
}

function extractDescription(event) {
  return String(event.description || "").trim();
}

function toDbTime(value) {
  if (!value) return null;

  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;

  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  const ss = String(dt.getSeconds()).padStart(2, "0");

  return `${hh}:${mm}:${ss}`;
}

function getEventStart(event) {
  return event?.start?.dateTime || null;
}

function getEventEnd(event) {
  return event?.end?.dateTime || null;
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

async function fetchEventsForCalendar(calendarApi, calendarId, timeMin, timeMax) {
  const response = await calendarApi.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
  });

  return response.data.items || [];
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const { serviceDate, timeMin, timeMax } = getTorontoDayBoundsForTomorrow();

    const auth = buildOAuthClient();
    const calendarApi = google.calendar({ version: "v3", auth });

    const calendars = await listTargetCalendars(calendarApi);

    const allEvents = [];

    for (const cal of calendars) {
      const events = await fetchEventsForCalendar(
        calendarApi,
        cal.id,
        timeMin,
        timeMax
      );

      for (const event of events) {
        const start = getEventStart(event);
        const end = getEventEnd(event);

        if (!start || !end) continue;

        const title = String(event.summary || "").trim();
        const address = extractAddress(event);
        const description = extractDescription(event);
        const calendarName = String(cal.summary || "").trim();
        const serviceType = detectServiceType({
          title,
          description,
          calendarName,
        });

        allEvents.push({
          id: event.id,
          title,
          start,
          end,
          address,
          description,
          calendarName,
          source: "google",
          date: serviceDate,
          serviceType,
        });
      }
    }

    let saved = 0;
    let skipped = 0;
    let dbError = null;

    for (const event of allEvents) {
      const payload = {
        google_event_id: event.id,
        title: event.title,
        address: event.address,
        arrival_window_start: toDbTime(event.start),
        arrival_window_end: toDbTime(event.end),
        service_date: event.date,
        raw_description: event.description,
        job_source: "google",
        service_type: event.serviceType || "general",
        calendar_name: event.calendarName,
      };

      const { error } = await supabaseAdmin
        .from("jobs")
        .upsert(payload, {
          onConflict: "google_event_id",
          ignoreDuplicates: false,
        });

      if (error) {
        dbError = error.message;
        skipped += 1;
      } else {
        saved += 1;
      }
    }

    return res.status(200).json({
      success: true,
      fetched: allEvents.length,
      imported: allEvents.length,
      saved,
      skipped,
      calendarNames: calendars.map((c) => c.summary),
      timeMin,
      timeMax,
      samples: allEvents.slice(0, 5),
      events: allEvents,
      dbError,
    });
  } catch (error) {
    console.error("import-tomorrow error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Import failed",
    });
  }
}
