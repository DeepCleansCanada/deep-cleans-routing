import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

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

function getTechName(tech) {
  if (!tech) return "-";
  return (
    tech.display_name ||
    [tech.first_name, tech.last_name].filter(Boolean).join(" ") ||
    tech.legal_name ||
    tech.email ||
    tech.id ||
    "-"
  );
}

export default function Home() {
  const [jobs, setJobs] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [routeResult, setRouteResult] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [error, setError] = useState("");
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [loadingImport, setLoadingImport] = useState(false);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [tomorrow, setTomorrow] = useState("");

  useEffect(() => {
    const t = getTomorrowDateToronto();
    setTomorrow(t);
  }, []);

  useEffect(() => {
    if (tomorrow) {
      loadPage();
    }
  }, [tomorrow]);

  async function loadPage() {
    await Promise.all([fetchJobs(), fetchTechnicians()]);
  }

  async function fetchJobs() {
    try {
      setLoadingJobs(true);
      setError("");

      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .eq("service_date", tomorrow)
        .order("arrival_window_start", { ascending: true });

      if (error) throw error;
      setJobs(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load jobs");
      setJobs([]);
    } finally {
      setLoadingJobs(false);
    }
  }

  async function fetchTechnicians() {
    try {
      const { data, error } = await supabase
        .from("technicians")
        .select("*")
        .eq("is_active", true);

      if (error) throw error;
      setTechnicians(Array.isArray(data) ? data : []);
    } catch (err) {
      setTechnicians([]);
    }
  }

  function resolveTechName(assignedTechnicianId) {
    if (!assignedTechnicianId) return "-";
    const tech = technicians.find(
      (t) => String(t.id) === String(assignedTechnicianId)
    );
    return tech ? getTechName(tech) : String(assignedTechnicianId);
  }

  async function handleImportTomorrow() {
    try {
      setLoadingImport(true);
      setError("");

      const res = await fetch("/api/google/import-tomorrow");
      const text = await res.text();

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("Import API did not return JSON");
      }

      if (!res.ok) {
        throw new Error(json.error || "Import failed");
      }

      setImportResult(json);
      await fetchJobs();
    } catch (err) {
      setError(err.message || "Import failed");
      setImportResult({
        success: false,
        error: err.message || "Import failed",
      });
    } finally {
      setLoadingImport(false);
    }
  }

  async function handleRouteTomorrow() {
    try {
      setLoadingRoute(true);
      setError("");

      const res = await fetch("/api/route-tomorrow");
      const text = await res.text();

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("Route API did not return JSON");
      }

      if (!res.ok) {
        throw new Error(json.error || "Routing failed");
      }

      setRouteResult(json);
      await fetchJobs();
    } catch (err) {
      setError(err.message || "Routing failed");
      setRouteResult({
        success: false,
        error: err.message || "Routing failed",
      });
    } finally {
      setLoadingRoute(false);
    }
  }

  return (
    <div
      style={{
        padding: 24,
        maxWidth: 1100,
        margin: "0 auto",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1>Deep Cleans Routing</h1>
      <p>Tomorrow: {tomorrow || "-"}</p>

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={handleRouteTomorrow} disabled={loadingRoute}>
          {loadingRoute ? "Routing..." : "Route Tomorrow"}
        </button>

        <button onClick={fetchJobs} disabled={loadingJobs}>
          {loadingJobs ? "Refreshing..." : "Refresh Jobs"}
        </button>

        <button onClick={handleImportTomorrow} disabled={loadingImport}>
          {loadingImport ? "Importing..." : "Import Tomorrow from Google"}
        </button>
      </div>

      {error ? (
        <div
          style={{
            marginBottom: 20,
            padding: 12,
            border: "1px solid #f5c2c7",
            background: "#f8d7da",
            color: "#842029",
            borderRadius: 8,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 0.8fr",
          gap: 20,
          alignItems: "start",
        }}
      >
        <div>
          <h2>Jobs for Tomorrow</h2>

          {jobs.length === 0 ? (
            <div>No jobs found.</div>
          ) : (
            jobs.map((job) => (
              <div
                key={job.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 10,
                  padding: 14,
                  marginBottom: 12,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 18 }}>
                  {job.title || "Untitled Job"}
                </div>
                <div>Service Type: {job.service_type || "-"}</div>
                <div>Address: {job.address || "-"}</div>
                <div>Assigned Tech: {resolveTechName(job.assigned_technician_id)}</div>
                <div>Start: {job.arrival_window_start || "-"}</div>
                <div>End: {job.arrival_window_end || "-"}</div>
              </div>
            ))
          )}
        </div>

        <div>
          <h2>Last Route Result</h2>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 14,
              minHeight: 140,
            }}
          >
            {routeResult ? JSON.stringify(routeResult, null, 2) : "No routing run yet."}
          </pre>

          <h2 style={{ marginTop: 20 }}>Last Import Result</h2>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 14,
              minHeight: 140,
            }}
          >
            {importResult ? JSON.stringify(importResult, null, 2) : "No import run yet."}
          </pre>
        </div>
      </div>
    </div>
  );
}
