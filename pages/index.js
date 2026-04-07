import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Home() {
  const [jobs, setJobs] = useState([]);
  const [techs, setTechs] = useState([]);
  const [routes, setRoutes] = useState([]);

  const getTomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  };

  useEffect(() => {
    fetchJobs();
    fetchTechs();
  }, []);

  async function fetchJobs() {
    const tomorrow = getTomorrow();

    const { data } = await supabase
      .from("jobs")
      .select("*")
      .eq("service_date", tomorrow)
      .order("arrival_window_start");

    setJobs(data || []);
  }

  async function fetchTechs() {
    const { data } = await supabase
      .from("technicians")
      .select("*");

    setTechs(data || []);
  }

  function getTechName(id) {
    const tech = techs.find((t) => t.id === id);
    if (!tech) return "Unassigned";

    return (
      tech.display_name ||
      `${tech.first_name || ""} ${tech.last_name || ""}`.trim()
    );
  }

  async function runRouting() {
    const res = await fetch("/api/route-tomorrow");
    const json = await res.json();

    console.log("ROUTES:", json);

    setRoutes(json.routes || []);

    await fetchJobs();
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Tomorrow Routing</h1>

      <button onClick={runRouting}>
        🚀 Run Route Optimization
      </button>

      <h2 style={{ marginTop: 30 }}>Jobs</h2>

      {jobs.map((job) => (
        <div
          key={job.id}
          style={{
            border: "1px solid #ccc",
            padding: 10,
            marginBottom: 10,
          }}
        >
          <strong>{job.title}</strong>
          <div>{job.address}</div>
          <div>
            Assigned Tech:{" "}
            <b>{getTechName(job.assigned_technician_id)}</b>
          </div>
        </div>
      ))}

      <h2 style={{ marginTop: 40 }}>Routes</h2>

      {routes.map((route) => (
        <div
          key={route.tech_id}
          style={{
            border: "2px solid black",
            padding: 15,
            marginBottom: 20,
          }}
        >
          <h3>{route.tech_name}</h3>

          {route.stops.map((stop, i) => (
            <div key={stop.jobId} style={{ marginBottom: 10 }}>
              <b>{i + 1}.</b> {stop.address}
              <div style={{ fontSize: 12 }}>
                {new Date(stop.plannedStart).toLocaleTimeString()} →{" "}
                {new Date(stop.plannedEnd).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
