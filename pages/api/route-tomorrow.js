import { supabaseAdmin } from "../../lib/supabaseAdmin";

const DEFAULT_TRAVEL_BUFFER_MINUTES = 25;

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

function getServiceDurationMinutes(serviceType) {
  const service = normalizeText(serviceType);

  if (service === "bbq") return 150;
  if (service === "oven") return 120;
  if (service === "carpet") return 120;
  if (service === "windows") return 180;
  if (service === "deep-clean") return 240;

  return 120;
}

function parseTimeOnDate(dateString, timeValue, fallback = "09:00:00") {
  const raw = String(timeValue || fallback).trim();
  return new Date(`${dateString}T${raw}`);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function getTechName(tech) {
  return (
    tech.display_name ||
    [tech.first_name, tech.last_name].filter(Boolean).join(" ") ||
    tech.email ||
    `Tech ${tech.id}`
  );
}

function buildTechStates(techs, serviceDate) {
  return techs.map((tech) => ({
    tech,
    techId: tech.id,
    techName: getTechName(tech),
    services: tech.services || [], // 👈 IMPORTANT
    route: [],
    nextAvailable: parseTimeOnDate(serviceDate, "08:00:00"),
  }));
}

function chooseBestTech(job, techStates, serviceDate) {
  const windowStart = parseTimeOnDate(
    serviceDate,
    job.arrival_window_start
  );

  const durationMinutes = getServiceDurationMinutes(job.service_type);

  // 🔥 FILTER BASED ON SERVICES
  const eligibleTechs = techStates.filter((state) => {
    if (!state.services || state.services.length === 0) return true;
    return state.services.includes(job.service_type);
  });

  if (!eligibleTechs.length) {
    console.log(`❌ No eligible tech for service: ${job.service_type}`);
    return null;
  }

  let best = null;

  for (const state of eligibleTechs) {
    const earliestStart = new Date(
      Math.max(state.nextAvailable.getTime(), windowStart.getTime())
    );

    const workloadPenalty = state.route.length * 10;

    const score = workloadPenalty;

    if (!best || score < best.score) {
      best = {
        state,
        score,
        durationMinutes,
        plannedStart: earliestStart,
      };
    }
  }

  return best;
}

function planRoutes(jobs, techs, serviceDate, forceReassign) {
  const techStates = buildTechStates(techs, serviceDate);
  const assignments = [];

  for (const job of jobs) {
    if (!job?.arrival_window_start) continue;

    if (job.assigned_technician_id && !forceReassign) continue;

    const best = chooseBestTech(job, techStates, serviceDate);
    if (!best) continue;

    const plannedStart = best.plannedStart;
    const plannedEnd = addMinutes(plannedStart, best.durationMinutes);

    best.state.route.push({
      jobId: job.id,
      address: job.address,
      service_type: job.service_type,
      plannedStart: plannedStart.toISOString(),
      plannedEnd: plannedEnd.toISOString(),
    });

    best.state.nextAvailable = addMinutes(
      plannedEnd,
      DEFAULT_TRAVEL_BUFFER_MINUTES
    );

    assignments.push({
      job_id: job.id,
      tech_id: best.state.techId,
      tech_name: best.state.techName,
      service_type: job.service_type,
    });
  }

  return { assignments };
}

export default async function handler(req, res) {
  try {
    const serviceDate = getTomorrowDateToronto();

    const forceReassign =
      String(req.query?.force || "").toLowerCase() === "true";

    const { data: jobs } = await supabaseAdmin
      .from("jobs")
      .select("*")
      .eq("service_date", serviceDate);

    const { data: techs } = await supabaseAdmin
      .from("technicians")
      .select("*")
      .eq("is_active", true);

    const { assignments } = planRoutes(
      jobs || [],
      techs || [],
      serviceDate,
      forceReassign
    );

    for (const a of assignments) {
      await supabaseAdmin
        .from("jobs")
        .update({ assigned_technician_id: a.tech_id })
        .eq("id", a.job_id);
    }

    return res.status(200).json({
      success: true,
      assignments,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}
