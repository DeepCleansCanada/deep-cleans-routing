import { supabaseAdmin } from "../../lib/supabaseAdmin";

function getTomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

export default async function handler(req, res) {
  try {
    const tomorrow = getTomorrowDate();

    const { data: jobs, error: jobsError } = await supabaseAdmin
      .from("jobs")
      .select("*")
      .eq("service_date", tomorrow);

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

    const assignments = [];

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];

      if (job.assigned_technician_id) {
        assignments.push({
          job_id: job.id,
          tech_id: job.assigned_technician_id,
          tech_name: "Already assigned",
          address: job.address,
          skipped: true,
        });
        continue;
      }

      const tech = techs[i % techs.length];
      const techName =
        tech.display_name ||
        [tech.first_name, tech.last_name].filter(Boolean).join(" ") ||
        tech.email ||
        `Tech ${tech.id}`;

      const { error: updateError } = await supabaseAdmin
        .from("jobs")
        .update({
          assigned_technician_id: tech.id,
        })
        .eq("id", job.id);

      if (updateError) throw updateError;

      assignments.push({
        job_id: job.id,
        tech_id: tech.id,
        tech_name: techName,
        address: job.address,
      });
    }

    return res.status(200).json({
      success: true,
      total_jobs: jobs.length,
      total_technicians: techs.length,
      assignments,
    });
  } catch (err) {
    console.error("route-tomorrow error:", err);

    return res.status(500).json({
      success: false,
      error: err.message || "Unknown server error",
    });
  }
}
