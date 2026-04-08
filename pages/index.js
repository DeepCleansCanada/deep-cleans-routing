import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

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

  return d.toISOString().split("T")[0];
}

function formatTime(time) {
  if (!time) return "-";
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${suffix}`;
}

function getServiceColor(type) {
  const map = {
    bbq: "#ff6b6b",
    windows: "#4dabf7",
    carpet: "#51cf66",
    oven: "#f59f00",
    "deep-clean": "#845ef7",
  };
  return map[type] || "#999";
}

function getTechName(t) {
  return (
    t.display_name ||
    [t.first_name, t.last_name].filter(Boolean).join(" ") ||
    t.id
  );
}

export default function Home() {
  const [jobs, setJobs] = useState([]);
  const [techs, setTechs] = useState([]);
  const [tomorrow, setTomorrow] = useState("");

  useEffect(() => {
    const t = getTomorrowDateToronto();
    setTomorrow(t);
  }, []);

  useEffect(() => {
    if (tomorrow) loadData();
  }, [tomorrow]);

  async function loadData() {
    const { data: jobsData } = await supabase
      .from("jobs")
      .select("*")
      .eq("service_date", tomorrow)
      .order("arrival_window_start");

    const { data: techData } = await supabase
      .from("technicians")
      .select("*")
      .eq("is_active", true);

    setJobs(jobsData || []);
    setTechs(techData || []);
  }

  function groupByTech() {
    const map = {};

    techs.forEach((t) => {
      map[t.id] = {
        tech: t,
        jobs: [],
      };
    });

    jobs.forEach((job) => {
      const techId = job.assigned_technician_id;

      if (!techId || !map[techId]) {
        if (!map["unassigned"]) {
          map["unassigned"] = { tech: null, jobs: [] };
        }
        map["unassigned"].jobs.push(job);
      } else {
        map[techId].jobs.push(job);
      }
    });

    return map;
  }

  const grouped = groupByTech();

  return (
    <div style={{ padding: 24, fontFamily: "Arial" }}>
      <h1>Deep Cleans Routing</h1>
      <p>Tomorrow: {tomorrow}</p>

      <button onClick={() => fetch("/api/route-tomorrow?force=true").then(loadData)}>
        Re-Route
      </button>

      <div style={{ marginTop: 30 }}>
        {Object.values(grouped).map((group, i) => (
          <div key={i} style={{ marginBottom: 30 }}>
            <h2>
              {group.tech
                ? getTechName(group.tech)
                : "⚠️ UNASSIGNED JOBS"}
            </h2>

            {group.tech && (
              <div style={{ marginBottom: 10, color: "#666" }}>
                Skills: {(group.tech.services || []).join(", ") || "-"}
              </div>
            )}

            {group.jobs.length === 0 ? (
              <div style={{ color: "#999" }}>No jobs</div>
            ) : (
              group.jobs.map((job) => (
                <div
                  key={job.id}
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: 10,
                    padding: 12,
                    marginBottom: 10,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {job.title}
                  </div>

                  <div
                    style={{
                      display: "inline-block",
                      padding: "4px 8px",
                      borderRadius: 6,
                      background: getServiceColor(job.service_type),
                      color: "#fff",
                      fontSize: 12,
                      marginTop: 4,
                    }}
                  >
                    {job.service_type}
                  </div>

                  <div style={{ marginTop: 6 }}>
                    {job.address}
                  </div>

                  <div style={{ marginTop: 6 }}>
                    🕒 {formatTime(job.arrival_window_start)} →{" "}
                    {formatTime(job.arrival_window_end)}
                  </div>
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
