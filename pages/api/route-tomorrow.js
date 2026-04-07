import { supabaseAdmin } from "../../lib/supabaseAdmin";

const DEFAULT_JOB_DURATION_MINUTES = 120;
const DEFAULT_TRAVEL_MINUTES = 25;

function getTomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPostalPrefix(address) {
  const text = String(address || "").toUpperCase();
  const match = text.match(/\b([A-Z]\d[A-Z])\s?\d[A-Z]\d\b/);
  return match ? match[1] : null;
}

function tokenizeAddress(address) {
  const text = normalizeText(address)
    .replace(
      /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|place|pl|crescent|cres|circle|cir|parkway|pkwy|unit|suite|ste|apt|apartment)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return [];

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

  return text
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part && part.length > 1 && !stopWords.has(part));
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

function inferDurationMinutes(job) {
  const combined = normalizeText(`${job?.title || ""} ${job?.raw_description || ""}`);

  const minutesMatch = combined.match(/\b(\d{2,3})\s*(min|mins|minute|minutes)\b/);
  if (minutesMatch) return Number(minutesMatch[1]);

  const hoursMatch = combined.match(/\b(\d+(?:\.\d+)?)\s*(hr|hrs|hour|hours)\b/);
  if (hoursMatch) return Math.round(Number(hoursMatch[1]) * 60);

  if (combined.includes("move out")) return 300;
  if (combined.includes("move-in")) return 300;
  if (combined.includes("deep clean")) return 240;
  if (combined.includes("post construction")) return 360;
  if (combined.includes("window")) return 180;
  if (combined.includes("bbq")) return 150;
  if (combined.includes("pressure wash")) return 180;
  if (combined.includes("power wash")) return 180;
  if (combined.includes("gutter")) return 180;
  if (combined.includes("carpet")) return 120;
  if (combined.includes("oven")) return 120;

  return DEFAULT_JOB_DURATION_MINUTES;
}

function parseTimeOnDate(dateString, timeValue, fallback = "09:00") {
  const raw = String(timeValue || fallback).trim();

  if (raw.includes("T")) {
    const dt = new Date(raw);
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match) {
    const hh = String(match[1]).padStart(2, "0");
    const mm = match[2];
    return new Date(`${dateString}T${hh}:${mm}:00`);
  }

  return new Date(`${dateString}T${fallback}:00`);
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

function buildTechStates(techs, serviceDate) {
  return techs.map((tech, index) => ({
    tech,
    techId: tech.id,
    techName: getTechName(tech),
    homeAddress: tech.home_address || "",
    clusterAnchor: tech.home_address || "",
    sequence: index,
    route: [],
    nextAvailable: parseTimeOnDate(serviceDate, "08:00", "08:00"),
  }));
}

function sortJobsForPlanning(jobs, serviceDate) {
  return [...jobs]
    .filter((job) => job?.address && job?.arrival_window_start)
    .sort((a, b) => {
      const aStart = parseTimeOnDate(serviceDate, a.arrival_window_start, "09:00").getTime();
      const bStart = parseTimeOnDate(serviceDate, b.arrival_window_start, "09:00").getTime();
      return aStart - bStart;
    });
}

function chooseBestTech(job, techStates, serviceDate) {
  const windowStart = parseTimeOnDate(
    serviceDate,
    job.arrival_window_start,
    "09:00"
  );
  const windowEnd = parseTimeOnDate(
    serviceDate,
    job.arrival_window_end || job.arrival_window_start,
    "17:00"
  );
  const durationMinutes = inferDurationMinutes(job);

  let best = null;

  for (const state of techStates) {
    const lastStopAddress =
      state.route.length > 0
        ? state.route[state.route.length - 1].address
        : state.homeAddress;

    const anchorScore = overlapScore(job.address || "", state.clusterAnchor || "");
    const routeScore = overlapScore(job.address || "", lastStopAddress || "");
    const homeScore = overlapScore(job.address || "", state.homeAddress || "");

    const proximityScore = anchorScore * 6 + routeScore * 4 + homeScore * 3;
    const travelPenalty = Math.max(
      0,
      DEFAULT_TRAVEL_MINUTES - routeScore * 3 - anchorScore * 2
    );

    const earliestStart = new Date(
      Math.max(state.nextAvailable.getTime(), windowStart.getTime())
    );
    const latePenalty = Math.max(
      0,
      Math.round((earliestStart.getTime() - windowEnd.getTime()) / 60000)
    );

    const workloadPenalty = state.route.length * 15;
    const score = travelPenalty + latePenalty * 10 + workloadPenalty - proximityScore * 5;

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

function planRoutes(jobs, techs, serviceDate) {
  const techStates = buildTechStates(techs, serviceDate);
  const orderedJobs = sortJobsForPlanning(jobs, serviceDate);
  const assignments = [];

  for (const job of orderedJobs) {
    if (!job?.address || !job?.arrival_window_start) {
      continue;
    }

    if (job.assigned_technician_id) {
      const existingTech = techStates.find(
        (state) => String(state.techId) === String(job.assigned_technician_id)
      );

      if (existingTech) {
        const plannedStart = parseTimeOnDate(
          serviceDate,
          job.arrival_window_start,
          "09:00"
        );
        const durationMinutes = inferDurationMinutes(job);
        const plannedEnd = addMinutes(plannedStart, durationMinutes);

        existingTech.route.push({
          jobId: job.id,
          title: job.title,
          address: job.address,
          plannedStart: plannedStart.toISOString(),
          plannedEnd: plannedEnd.toISOString(),
          existing: true,
        });
        existingTech.nextAvailable = plannedEnd;

        assignments.push({
          job_id: job.id,
          tech_id: existingTech.techId,
          tech_name: existingTech.techName,
          address: job.address,
          skipped: true,
        });
      }

      continue;
    }

    const best = chooseBestTech(job, techStates, serviceDate);
    if (!best) continue;

    const plannedStart = best.plannedStart;
    const plannedEnd = addMinutes(plannedStart, best.durationMinutes);

    best.state.route.push({
      jobId: job.id,
      title: job.title,
      address: job.address,
      plannedStart: plannedStart.toISOString(),
      plannedEnd: plannedEnd.toISOString(),
      existing: false,
    });

    if (!best.state.clusterAnchor) {
      best.state.clusterAnchor = job.address || best.state.homeAddress || "";
    }

    best.state.nextAvailable = addMinutes(plannedEnd, DEFAULT_TRAVEL_MINUTES);

    assignments.push({
      job_id: job.id,
      tech_id: best.state.techId,
      tech_name: best.state.techName,
      address: job.address,
      planned_start: plannedStart.toISOString(),
      planned_end: plannedEnd.toISOString(),
    });
  }

  return {
    assignments,
    routes: techStates.map((state) => ({
      tech_id: state.techId,
      tech_name: state.techName,
      home_address: state.homeAddress,
      stops: state.route,
    })),
  };
}

export default async function handler(req, res) {
  try {
    const serviceDate =
      req.method === "POST" && req.body?.service_date
        ? req.body.service_date
        : getTomorrowDate();

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

    const { assignments, routes } = planRoutes(jobs || [], techs, serviceDate);

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

    return res.status(200).json({
      success: true,
      service_date: serviceDate,
      total_jobs: jobs.length,
      total_technicians: techs.length,
      assignments,
      routes,
    });
  } catch (err) {
    console.error("route-tomorrow error:", err);

    return res.status(500).json({
      success: false,
      error: err.message || "Unknown server error",
    });
  }
}
