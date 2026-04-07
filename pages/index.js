import React, { useEffect, useMemo, useState } from "react";

function getTorontoTomorrowLabel() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);

  const torontoNow = new Date(Date.UTC(year, month - 1, day));
  torontoNow.setUTCDate(torontoNow.getUTCDate() + 1);

  const y = torontoNow.getUTCFullYear();
  const m = String(torontoNow.getUTCMonth() + 1).padStart(2, "0");
  const d = String(torontoNow.getUTCDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

export default function IndexPage() {
  const tomorrowLabel = useMemo(() => getTorontoTomorrowLabel(), []);

  const bookingCalendars = [
    "BBQ Bookings",
    "Carpet Cleaning Bookings",
    "Internal Booking",
    "Jiffy Lawn Bookings",
    "Power Washing",
    "Residential Deep Clean Bookings",
    "Windows/Eaves",
  ];

  const [jobs, setJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [routingTomorrow, setRoutingTomorrow] = useState(false);
  const [googleStatus, setGoogleStatus] = useState(null);
  const [debugLog, setDebugLog] = useState([]);
  const [lastImportResult, setLastImportResult] = useState(null);
  const [lastRouteResult, setLastRouteResult] = useState(null);
  const [error, setError] = useState("");

  const addLog = (message) => {
    setDebugLog((prev) =>
      [`${new Date().toLocaleTimeString()}: ${message}`, ...prev].slice(0, 60)
    );
  };

  const fetchGoogleStatus = async () => {
    try {
      addLog("Checking Google connection status...");
      const res = await fetch("/api/google/status");
      const data = await res.json();
      setGoogleStatus(data);

      if (data?.connected) {
        addLog(`Google connected${data.email ? ` as ${data.email}` : ""}`);
      } else {
        addLog("Google not connected");
      }
    } catch (err) {
      addLog("Failed to check Google status");
    }
  };

  const fetchTomorrowJobs = async () => {
    try {
      setLoadingJobs(true);
      setError("");
      addLog(`Fetching jobs for ${tomorrowLabel}...`);

      const res = await fetch(`/api/jobs?date=${tomorrowLabel}`);
      const data = await res.json();

      const nextJobs = Array.isArray(data?.jobs) ? data.jobs : [];
      setJobs(nextJobs);

      addLog(`Loaded ${nextJobs.length} job(s) for tomorrow`);
    } catch (err) {
      console.error(err);
      setError("Failed to load tomorrow's jobs.");
      addLog("Failed to load tomorrow's jobs");
    } finally {
      setLoadingJobs(false);
    }
  };

  const importTomorrowFromGoogle = async () => {
    try {
      addLog("Starting Google Calendar import for tomorrow...");
      addLog(`Calendars selected: ${bookingCalendars.join(", ")}`);

      const res = await fetch("/api/google/import-tomorrow", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timeZone: "America/Toronto",
          date: tomorrowLabel,
          calendarNames: bookingCalendars,
        }),
      });

      const data = await res.json();
      setLastImportResult(data);

      if (!res.ok || data?.error) {
        throw new Error(data?.error || "Google import failed");
      }

      addLog(
        `Google import finished. fetched=${data.fetched ?? 0}, imported=${data.imported ?? 0}, skipped=${data.skipped ?? 0}`
      );

      if (Array.isArray(data?.calendarNames) && data.calendarNames.length > 0) {
        addLog(`Imported from: ${data.calendarNames.join(", ")}`);
      }

      if ((data?.fetched ?? 0) === 0) {
        addLog("IMPORTANT: Google returned 0 events for tomorrow");
      }

      if ((data?.fetched ?? 0) > 0 && (data?.imported ?? 0) === 0) {
        addLog("IMPORTANT: events were fetched but none were imported");
      }

      return data;
    } catch (err) {
      console.error(err);
      const msg = err?.message || "Google import failed";
      setError(msg);
      addLog(`Import error: ${msg}`);
      throw err;
    }
  };

  const routeTomorrow = async () => {
    try {
      setRoutingTomorrow(true);
      setError("");
      setLastImportResult(null);
      setLastRouteResult(null);

      addLog("Route Tomorrow clicked");
      addLog("Step 1: import tomorrow's Google Calendar events from all booking calendars");

      await importTomorrowFromGoogle();

      addLog("Step 2: reload tomorrow's jobs after import");
      await fetchTomorrowJobs();

      addLog("Step 3: run route tomorrow");
      const res = await fetch("/api/jobs/route-tomorrow", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timeZone: "America/Toronto",
          date: tomorrowLabel,
        }),
      });

      const data = await res.json();
      setLastRouteResult(data);

      if (!res.ok || data?.error) {
        throw new Error(data?.error || "Route tomorrow failed");
      }

      addLog(`Routing finished. routedCount=${data?.routedCount ?? 0}`);

      await fetchTomorrowJobs();
    } catch (err) {
      console.error(err);
      const msg = err?.message || "Failed to route tomorrow";
      setError(msg);
      addLog(`Routing error: ${msg}`);
    } finally {
      setRoutingTomorrow(false);
    }
  };

  useEffect(() => {
    fetchGoogleStatus();
    fetchTomorrowJobs();
  }, []);

  const manualJobs = jobs.filter((j) => (j.source || "").toLowerCase() === "manual");
  const googleJobs = jobs.filter((j) => (j.source || "").toLowerCase() === "google");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f7f7f8",
        padding: 24,
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          display: "grid",
          gap: 20,
        }}
      >
        <div
          style={{
            background: "white",
            borderRadius: 16,
            padding: 20,
            boxShadow: "0 1px 3px rgba(0,0,0,.08)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 28 }}>Deep Cleans Routing</h1>
          <p style={{ marginTop: 8, color: "#666" }}>
            Tomorrow: <strong>{tomorrowLabel}</strong> (America/Toronto)
          </p>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, color: "#555", marginBottom: 8 }}>
              Booking calendars included
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {bookingCalendars.map((name) => (
                <span
                  key={name}
                  style={{
                    fontSize: 12,
                    padding: "6px 10px",
                    borderRadius: 999,
                    background: "#eef3ff",
                    border: "1px solid #d8e2ff",
                  }}
                >
                  {name}
                </span>
              ))}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              marginTop: 18,
            }}
          >
            <button
              onClick={routeTomorrow}
              disabled={routingTomorrow}
              style={{
                background: routingTomorrow ? "#999" : "#111",
                color: "white",
                border: "none",
                borderRadius: 10,
                padding: "12px 18px",
                cursor: routingTomorrow ? "not-allowed" : "pointer",
                fontWeight: 600,
              }}
            >
              {routingTomorrow ? "Routing Tomorrow..." : "Route Tomorrow"}
            </button>

            <button
              onClick={fetchTomorrowJobs}
              disabled={loadingJobs}
              style={{
                background: "white",
                color: "#111",
                border: "1px solid #ddd",
                borderRadius: 10,
                padding: "12px 18px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Refresh Jobs
            </button>

            <button
              onClick={async () => {
                try {
                  setError("");
                  await importTomorrowFromGoogle();
                  await fetchTomorrowJobs();
                } catch {}
              }}
              style={{
                background: "white",
                color: "#111",
                border: "1px solid #ddd",
                borderRadius: 10,
                padding: "12px 18px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Import Tomorrow from Google
            </button>
          </div>

          {error ? (
            <div
              style={{
                marginTop: 16,
                background: "#fff1f1",
                color: "#b00020",
                border: "1px solid #ffd1d1",
                borderRadius: 12,
                padding: 12,
              }}
            >
              {error}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: 20,
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: 16,
              padding: 20,
              boxShadow: "0 1px 3px rgba(0,0,0,.08)",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Google Status</h2>
            <div style={{ fontSize: 14, lineHeight: 1.8 }}>
              <div>
                Connected: <strong>{googleStatus?.connected ? "Yes" : "No"}</strong>
              </div>
              <div>
                Email: <strong>{googleStatus?.email || "-"}</strong>
              </div>
              <div>
                Default Calendar ID: <strong>{googleStatus?.calendarId || "-"}</strong>
              </div>
            </div>
          </div>

          <div
            style={{
              background: "white",
              borderRadius: 16,
              padding: 20,
              boxShadow: "0 1px 3px rgba(0,0,0,.08)",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Tomorrow Summary</h2>
            <div style={{ fontSize: 14, lineHeight: 1.8 }}>
              <div>
                Total Jobs: <strong>{jobs.length}</strong>
              </div>
              <div>
                Manual Jobs: <strong>{manualJobs.length}</strong>
              </div>
              <div>
                Google Jobs: <strong>{googleJobs.length}</strong>
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.3fr .9fr",
            gap: 20,
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: 16,
              padding: 20,
              boxShadow: "0 1px 3px rgba(0,0,0,.08)",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Jobs for Tomorrow</h2>

            {loadingJobs ? (
              <p>Loading jobs...</p>
            ) : jobs.length === 0 ? (
              <p style={{ color: "#666" }}>No jobs loaded for tomorrow.</p>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    style={{
                      border: "1px solid #e6e6e6",
                      borderRadius: 12,
                      padding: 14,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "center",
                      }}
                    >
                      <strong>{job.title || job.customerName || "Untitled Job"}</strong>
                      <span
                        style={{
                          fontSize: 12,
                          padding: "4px 8px",
                          borderRadius: 999,
                          background:
                            (job.source || "").toLowerCase() === "google"
                              ? "#eef6ff"
                              : "#f3f3f3",
                        }}
                      >
                        {job.source || "unknown"}
                      </span>
                    </div>

                    <div style={{ marginTop: 8, fontSize: 14, color: "#555" }}>
                      <div>Calendar: {job.calendarName || "-"}</div>
                      <div>Address: {job.address || "-"}</div>
                      <div>Assigned To: {job.assignedTo || "-"}</div>
                      <div>Start: {job.start || "-"}</div>
                      <div>End: {job.end || "-"}</div>
                      <div>Date: {job.date || "-"}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 20 }}>
            <div
              style={{
                background: "white",
                borderRadius: 16,
                padding: 20,
                boxShadow: "0 1px 3px rgba(0,0,0,.08)",
              }}
            >
              <h2 style={{ marginTop: 0 }}>Last Import Result</h2>
              {!lastImportResult ? (
                <p style={{ color: "#666" }}>No import run yet.</p>
              ) : (
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 12,
                    background: "#f8f8f8",
                    padding: 12,
                    borderRadius: 10,
                    overflow: "auto",
                  }}
                >
                  {JSON.stringify(lastImportResult, null, 2)}
                </pre>
              )}
            </div>

            <div
              style={{
                background: "white",
                borderRadius: 16,
                padding: 20,
                boxShadow: "0 1px 3px rgba(0,0,0,.08)",
              }}
            >
              <h2 style={{ marginTop: 0 }}>Last Route Result</h2>
              {!lastRouteResult ? (
                <p style={{ color: "#666" }}>No routing run yet.</p>
              ) : (
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 12,
                    background: "#f8f8f8",
                    padding: 12,
                    borderRadius: 10,
                    overflow: "auto",
                  }}
                >
                  {JSON.stringify(lastRouteResult, null, 2)}
                </pre>
              )}
            </div>

            <div
              style={{
                background: "white",
                borderRadius: 16,
                padding: 20,
                boxShadow: "0 1px 3px rgba(0,0,0,.08)",
              }}
            >
              <h2 style={{ marginTop: 0 }}>Debug Log</h2>
              {debugLog.length === 0 ? (
                <p style={{ color: "#666" }}>No logs yet.</p>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    fontSize: 13,
                    color: "#333",
                  }}
                >
                  {debugLog.map((line, i) => (
                    <div
                      key={`${line}-${i}`}
                      style={{
                        background: "#f8f8f8",
                        borderRadius: 8,
                        padding: "8px 10px",
                      }}
                    >
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
