import { supabaseAdmin } from "../../lib/supabaseAdmin";

function getTomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

export default async function handler(req, res) {
  try {
    const tomorrow = getTomorrowDate();

    // 1. Get jobs
    const { data: jobs, error: jobsError } = await supabaseAdmin
      .from("jobs")
      .select("*")
      .eq("service_date", tomorrow);

    if (jobsError) throw jobsError;

    // 2. Get technicians (USING YOUR REAL COLUMNS)
    const { data: techs, error: techError } = await supabaseAdmin
      .from("technicians")
      .select("*")
      .eq("is_active", true);

    if (techError) throw techError;

    if (!techs.length) {
      return res.status(400).json({
        success: false,
        message: "No technicians found",
      });
    }

    // 3. Simple assignment logic (we’ll upgrade later)
    let assignments = [];

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const tech = techs[i % techs.length]; // round-robin for now

      assignments.push({
        job_id: job.id,
        tech_id: tech.id,
        tech_name: tech.display_name || `${tech.first_name} ${tech.last_name}`,
        address: job.address,
      });

      // update DB
      await supabaseAdmin
        .from("jobs")
        .update({
          assigned_technician_id: tech.id,
        })
        .eq("id", job.id);
    }

    return res.status(200).json({
      success: true,
      total_jobs: jobs.length,
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
