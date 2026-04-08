import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

function getTomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function safeTime(value) {
  if (!value) return "-";
  if (typeof value === "string" && !value.includes("T")) return value;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function safeJson(value, fallback = "No data yet.") {
  try {
    if (value == null) return fallback;
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return fallback;
  }
}

function techNameFromRow(tech) {
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
  const tomorrow = useMemo(() => getTomorrowDate(), []);

  const [jobs, setJobs] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [lastImportResult, setLastImportResult] = useState(null);
  const [lastRouteResult, setLastRouteResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [loadingImport, setLoadingImport] = useState(false);
  const [loadingRoute, setLoadingRoute] = useState(false);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    await Promise.all([fetchJobs(), fetchTechnicians()]);
  }

  async function fetchJobs() {
    try {
      setLoadingJobs(true);
      setErrorMessage("");

      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .eq("service_date", tomorrow)
        .order("arrival_window_start", { ascending: true });

      if (error) throw error;
      setJobs(Array.isArray(data) ? data : []);
    } catch (error) {
      setErrorMessage(error.message || "Failed to load jobs");
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
    } catch (error) {
      setTechnicians([]);
    }
  }

  function resolveTechName(assignedTechnicianId) {
    if (!assignedTechnicianId) return "-";
    const tech = technicians.find(
      (t) => String(t.id) === String(assignedTechnicianId)
    );
    return tech ? techNameFromRow(tech) : String(assignedTechnicianId);
  }

  async function handleImportTomorrow() {
    try {
      setLoadingImport(true);
      setErrorMessage("");

      const res = await fetch("/api/google/import-tomorrow");
      const text = await res.text();

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("Import API returned HTML instead of JSON");
      }

      if (!res.ok) {
        throw new Error(json.error || "Import failed");
      }

      setLastImportResult(json);
      await fetchJobs();
    } catch (error) {
      setLastImportResult({
        success: false,
        error: error.message || "Import failed",
      });
      setErrorMessage(error.message || "Import failed");
    } finally {
      setLoadingImport(false);
    }
  }

  async function handleRouteTomorrow() {
    try {
      setLoadingRoute(true);
      setErrorMessage("");

      const res = await fetch("/api/route-tomorrow");
      const text = await res.text();

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("Route API returned HTML instead of JSON");
      }

      if (!res.ok) {
        throw new Error(json.error || "Routing failed");
      }

      setLastRouteResult(json);
      setRoutes(Array.isArray(json.routes) ? json.routes : []);
      await fetchJobs();
    } catch (error) {
      setLastRouteResult({
        success: false,
        error: error.message || "Routing failed",
      });
      setRoutes([]);
      setErrorMessage(error.message || "Routing failed");
    } finally {
      setLoadingRoute(false);
    }
  }

  const totalJobs = Array.isArray(jobs) ? jobs.length : 0;
  const googleJobs = Array.isArray(jobs)
    ? jobs.filter(
        (job) => String(job?.job_source || "").toLowerCase() === "google"
      ).length
    : 0;
  const manualJobs = totalJobs - googleJobs;
  const calendarNames = Array.isArray(lastImportResult?.calendarNames)
    ? lastImportResult.calendarNames
    : [];

  return (
    <div
      style={{
        padding: 24,
        maxWidth: 1200,
        margin: "0 auto",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        background: "#f6f7fb",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          background: "#fff",
          border: "1px solid #e6e8ef",
          borderRadius: 20,
          padding: 20,
          marginBottom: 20,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28 }}>Deep Cleans Routing</h1>
        <p style={{ marginTop: 10, marginBottom: 18, color: "#555" }}>
          Tomorrow: <strong>{tomorrow}</strong> (America/Toronto)
        </p>

        {calendarNames.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ marginBottom: 8, color: "#555" }}>
              Booking calendars included
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {calendarNames.map((name) => (
                <span
                  key={name}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 999,
                    background: "#eef2ff",
                    border: "1px solid #d9e0ff",
                    fontSize: 14,
                  }}
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            onClick={handleRouteTomorrow}
            disabled={loadingRoute}
            style={{
              background: "#111",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              padding: "14px 18px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {loadingRoute ? "Routing..." : "Route Tomorrow"}
          </button>

          <button
            onClick={fetchJobs}
            disabled={loadingJobs}
            style={{
              background: "#fff",
              color: "#111",
              border: "1px solid #d9dce5",
              borderRadius: 12,
              padding: "14px 18px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {loadingJobs ? "Refreshing..." : "Refresh Jobs"}
          </button>

          <button
            onClick={handleImportTomorrow}
            disabled={loadingImport}
            style={{
              background: "#fff",
              color: "#111",
              border: "1px solid #d9dce5",
              borderRadius: 12,
              padding: "14px 18px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {loadingImport ? "Importing..." : "Import Tomorrow from Google"}
          </button>
        </div>

        {errorMessage ? (
          <div
            style={{
              marginTop: 16,
              padding: "14px 16px",
              borderRadius: 12,
              background: "#fff1f2",
              border: "1px solid #fecdd3",
              color: "#b91c1c",
              fontWeight: 500,
            }}
          >
            {errorMessage}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            background: "#fff",
            border: "1px solid #e6e8ef",
            borderRadius: 20,
            padding: 20,
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 14 }}>Google Status</h2>
          <div style={{ marginBottom: 8 }}>
            Connected: <strong>{lastImportResult ? "Yes" : "No"}</strong>
          </div>
          <div style={{ marginBottom: 8 }}>Email: -</div>
          <div>Default Calendar ID: -</div>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #e6e8ef",
            borderRadius: 20,
            padding: 20,
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 14 }}>Tomorrow Summary</h2>
          <div style={{ marginBottom: 8 }}>Total Jobs: {totalJobs}</div>
          <div style={{ marginBottom: 8 }}>Manual Jobs: {manualJobs}</div>
          <div>Google Jobs: {googleJobs}</div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 0.8fr",
          gap: 20,
          alignItems: "start",
        }}
      >
        <div style={{ display: "grid", gap: 20 }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid #e6e8ef",
              borderRadius: 20,
              padding: 20,
            }}
          >
            <h2 style={{ marginTop: 0 }}>Jobs for Tomorrow</h2>

            {jobs.length === 0 ? (
              <div style={{ color: "#666" }}>No jobs found.</div>
            ) : (
              jobs.map((job) => (
                <div
                  key={job.id}
                  style={{
                    border: "1px solid #e6e8ef",
                    borderRadius: 16,
                    padding: 16,
                    marginBottom: 14,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                      marginBottom: 12,
                    }}
                  >
                    <div style={{ fontSize: 18, fontWeight: 700 }}>
                      {job.title || "Untitled job"}
                    </div>
                    <div
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: "#f3f4f6",
                        fontSize: 13,
                        color: "#444",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {job.service_type || job.job_source || "unknown"}
                    </div>
                  </div>

                  <div>Service Type: {job.service_type || "-"}</div>
                  <div>Customer: {job.customer_name || "-"}</div>
                  <div>Address: {job.address || "-"}</div>
                  <div>Assigned Tech: {resolveTechName(job.assigned_technician_id)}</div>
                  <div>Start: {job.arrival_window_start || "-"}</div>
                  <div>End: {job.arrival_window_end || "-"}</div>
                  <div>Date: {job.service_date || "-"}</div>
                </div>
              ))
            )}
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #e6e8ef",
              borderRadius: 20,
              padding: 20,
            }}
          >
            <h2 style={{ marginTop: 0 }}>Routes</h2>

            {routes.length === 0 ? (
              <div style={{ color: "#666" }}>No routing run yet.</div>
            ) : (
              routes.map((route) => (
                <div
                  key={route.tech_id}
                  style={{
                    border: "1px solid #e6e8ef",
                    borderRadius: 16,
                    padding: 16,
                    marginBottom: 14,
                  }}
                >
                  <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
                    {route.tech_name || "-"}
                  </div>
                  <div style={{ color: "#666", marginBottom: 12 }}>
                    Home Base: {route.home_address || "-"}
                  </div>

                  {Array.isArray(route.stops) && route.stops.length > 0 ? (
                    route.stops.map((stop, index) => (
                      <div
                        key={`${route.tech_id}-${stop.jobId || index}`}
                        style={{
                          borderTop: index === 0 ? "none" : "1px solid #edf0f5",
                          paddingTop: index === 0 ? 0 : 10,
                          marginTop: index === 0 ? 0 : 10,
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>
                          {index + 1}. {stop.title || "Untitled stop"}
                        </div>
                        <div>{stop.address || "-"}</div>
                        <div style={{ color: "#555" }}>
                          {safeTime(stop.plannedStart)} - {safeTime(stop.plannedEnd)}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "#666" }}>No stops assigned.</div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div style={{ display: "grid", gap: 20 }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid #e6e8ef",
              borderRadius: 20,
              padding: 20,
            }}
          >
            <h2 style={{ marginTop: 0 }}>Last Import Result</h2>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              {safeJson(lastImportResult, "No import run yet.")}
            </pre>
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #e6e8ef",
              borderRadius: 20,
              padding: 20,
            }}
          >
            <h2 style={{ marginTop: 0 }}>Last Route Result</h2>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              {safeJson(lastRouteResult, "No routing run yet.")}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
