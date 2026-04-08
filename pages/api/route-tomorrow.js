import { google } from "googleapis";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

function getTomorrowRangeToronto() {
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

  const torontoDate = new Date(`${year}-${month}-${day}T12:00:00`);
  torontoDate.setDate(torontoDate.getDate() + 1);

  const yyyy = torontoDate.getFullYear();
  const mm = String(torontoDate.getMonth() + 1).padStart(2, "0");
  const dd = String(torontoDate.getDate()).padStart(2, "0");

  const date = `${yyyy}-${mm}-${dd}`;

  return {
    date,
    timeMin: `${date}T00:00:00-04:00`,
    timeMax: `${date}T23:59:59-04:00`,
  };
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text, phrases = []) {
  return phrases.some((phrase) => text.includes(phrase));
}

function detectServiceType({ title, description, calendarName }) {
  const t = normalizeText(title);
  const d = normalizeText(description);
  const c = normalizeText(calendarName);

  const scores = {
    bbq: 0,
    oven: 0,
    carpet: 0,
    windows: 0,
    "deep-clean": 0,
    "pressure-washing": 0,
    gutter: 0,
    lawn: 0,
    general: 0,
  };

  const add = (service, amount) => {
    scores[service] = (scores[service] || 0) + amount;
  };

  // title gets strongest weight
  if (includesAny(t, ["deep clean", "deep cleaning", "interior and exterior deep cleaning"])) add("deep-clean", 12);
  if (includesAny(t, ["bbq", "barbecue", "grill"])) add("bbq", 12);
  if (includesAny(t, ["oven", "stove"])) add("oven", 12);
  if (includesAny(t, ["carpet"])) add("carpet", 12);
  if (includesAny(t, ["window", "windows", "eaves"])) add("windows", 12);
  if (includesAny(t, ["pressure washing", "power washing", "pressure-washing"])) add("pressure-washing", 12);
  if (includesAny(t, ["gutter", "eavestrough"])) add("gutter", 12);
  if (includesAny(t, ["lawn", "grass cutting", "mowing"])) add("lawn", 12);

  // description gets medium weight
  if (includesAny(d, ["deep clean", "deep cleaning", "entire unit detailing", "top to bottom"])) add("deep-clean", 6);
  if (includesAny(d, ["grout", "bathrooms floor", "shower grout", "fridge detailing", "microwave detailing", "stove", "garage top to bottom"])) add("deep-clean", 5);
  if (includesAny(d, ["bbq", "barbecue", "grill", "4 burner"])) add("bbq", 6);
  if (includesAny(d, ["oven"])) add("oven", 6);
  if (includesAny(d, ["carpet"])) add("carpet", 6);
  if (includesAny(d, ["window", "windows", "canopy", "awning"])) add("windows", 5);
  if (includesAny(d, ["pressure wash", "power wash", "powerwashing", "patio powerwash"])) add("pressure-washing", 6);
  if (includesAny(d, ["gutter", "eavestrough"])) add("gutter", 6);
  if (includesAny(d, ["lawn", "mow", "grass"])) add("lawn", 6);

  // calendar name gets weakest weight
  if (includesAny(c, ["bbq"])) add("bbq", 2);
  if (includesAny(c, ["oven"])) add("oven", 2);
  if (includesAny(c, ["carpet"])) add("carpet", 2);
  if (includesAny(c, ["window", "windows", "eaves"])) add("windows", 2);
  if (includesAny(c, ["deep clean"])) add("deep-clean", 2);
  if (includesAny(c, ["pressure", "power washing"])) add("pressure-washing", 2);
  if (includesAny(c, ["gutter"])) add("gutter", 2);
  if (includesAny(c, ["lawn"])) add("lawn", 2);

  // hard overrides so calendar name cannot beat the title
  if (includesAny(t, ["deep clean", "deep cleaning", "interior and exterior deep cleaning"])) return "deep-clean";
  if (includesAny(t, ["carpet"])) return "carpet";
  if (includesAny(t, ["window", "windows", "eaves"])) return "windows";
  if (includesAny(t, ["oven", "stove"])) return "oven";
  if (includesAny(t, ["bbq", "barbecue", "grill"])) return "bbq";

  const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (!winner || winner[1] <= 0) return "general";

  return winner[0];
}

function extractAddress(event) {
  const location = String(event.location || "").trim();
  if (location) return location;

  const description = String(event.description || "");
  const lines = description.split("\n").map((line) => line.trim()).filter(Boolean);

  const addressLine = lines.find((line) => {
    const text = line.toLowerCase();
    return (
      text.includes(" toronto") ||
      text.includes(" mississauga") ||
      text.includes(" brampton") ||
      text.includes(" scarborough") ||
      text.includes(" etobicoke") ||
      text.includes(" burlington") ||
      text.includes(" oakville") ||
      text.includes(" north york") ||
      text.includes(" on ")
    );
  });

  return addressLine || "";
}

function toTimeStringFromEventDateTime(dateTimeString) {
  if (!dateTimeString) return null;
  const dt = new Date(dateTimeString);
  if (Number.isNaN(dt.getTime())) return null;

  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  const ss = String(dt.getSeconds()).padStart(2, "0");

  return `${hh}:${mm}:${ss}`;
}

function getCalendarName(calendar) {
  return calendar.summary || calendar.id || "Unknown Calendar";
}

function buildJobPayload(event, calendarName, serviceDate) {
  const title = String(event.summary || "").trim();
  const rawDescription = String(event.description || "").trim();
  const address = extractAddress(event);

  const startDateTime = event.start?.dateTime || null;
  const endDateTime = event.end?.dateTime || null;

  const arrivalWindowStart = toTimeStringFromEventDateTime(startDateTime) || "09:00:00";
  const arrivalWindowEnd = toTimeStringFromEventDateTime(endDateTime) || "11:00:00";

  const serviceType = detectServiceType({
    title,
    description: rawDescription,
    calendarName,
  });

  return {
    google_event_id: event.id,
    title,
    raw_description: rawDescription || null,
    address: address || null,
    service_date: serviceDate,
    arrival_window_start: arrivalWindowStart,
    arrival_window_end: arrivalWindowEnd,
    calendar_name: calendarName,
    job_source: "google",
    service_type: serviceType,
    customer_name: null,
  };
}

async function getGoogleCalendarClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing Google OAuth env vars");
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  return google.calendar({ version: "v3", auth: oauth2Client });
}

export default async function handler(req, res) {
  try {
    const { date, timeMin, timeMax } = getTomorrowRangeToronto();
    const calendarApi = await getGoogleCalendarClient();

    const calendarListResponse = await calendarApi.calendarList.list();
    const calendars = calendarListResponse.data.items || [];

    const allEvents = [];
    const calendarNames = [];

    for (const calendar of calendars) {
      const calendarId = calendar.id;
      const calendarName = getCalendarName(calendar);

      calendarNames.push(calendarName);

      const eventsResponse = await calendarApi.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
      });

      const events = eventsResponse.data.items || [];

      for (const event of events) {
        if (event.status === "cancelled") continue;
        if (!event.start?.dateTime) continue;

        allEvents.push({
          ...event,
          _calendarName: calendarName,
          _source: "google",
          _date: date,
        });
      }
    }

    const transformedJobs = allEvents.map((event) =>
      buildJobPayload(event, event._calendarName, date)
    );

    const samples = transformedJobs.slice(0, 5).map((job) => ({
      id: job.google_event_id,
      title: job.title,
      start: `${job.service_date}T${job.arrival_window_start}-04:00`,
      end: `${job.service_date}T${job.arrival_window_end}-04:00`,
      address: job.address,
      description: job.raw_description || "",
      calendarName: job.calendar_name,
      source: job.job_source,
      date: job.service_date,
      serviceType: job.service_type,
    }));

    let saved = 0;
    let skipped = 0;
    let dbError = null;

    for (const job of transformedJobs) {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from("jobs")
        .select("id")
        .eq("google_event_id", job.google_event_id)
        .maybeSingle();

      if (existingError) {
        throw existingError;
      }

      if (existing) {
        skipped += 1;
        continue;
      }

      const { error: insertError } = await supabaseAdmin
        .from("jobs")
        .insert(job);

      if (insertError) {
        dbError = insertError.message;
        console.error("import-tomorrow insert error:", insertError);
        continue;
      }

      saved += 1;
    }

    return res.status(200).json({
      success: true,
      fetched: allEvents.length,
      imported: transformedJobs.length,
      saved,
      skipped,
      calendarNames,
      timeMin,
      timeMax,
      samples,
      events: transformedJobs.map((job) => ({
        id: job.google_event_id,
        title: job.title,
        start: `${job.service_date}T${job.arrival_window_start}-04:00`,
        end: `${job.service_date}T${job.arrival_window_end}-04:00`,
        address: job.address,
        description: job.raw_description || "",
        calendarName: job.calendar_name,
        source: job.job_source,
        date: job.service_date,
        serviceType: job.service_type,
      })),
      dbError,
    });
  } catch (err) {
    console.error("import-tomorrow error:", err);

    return res.status(500).json({
      success: false,
      error: err.message || "Unknown server error",
    });
  }
}
