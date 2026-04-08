import { useEffect, useMemo, useState } from "react";
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

function normalizeServiceType(value) {
  const service = String(value || "").toLowerCase().trim();

  if (!service) return "general";
  if (service.includes("bbq")) return "bbq";
  if (service.includes("window")) return "windows";
  if (service.includes("eaves")) return "windows";
  if (service.includes("carpet")) return "carpet";
  if (service.includes("oven")) return "oven";
  if (service.includes("stove")) return "oven";
  if (service.includes("deep")) return "deep-clean";

  return service;
}

function getServiceBadgeStyle(serviceType) {
  const service = normalizeServiceType(serviceType);

  const colors = {
    bbq: { bg: "#FEE2E2", text: "#991B1B", border: "#FCA5A5" },
    windows: { bg: "#DBEAFE", text: "#1D4ED8", border: "#93C5FD" },
    carpet: { bg: "#DCFCE7", text: "#166534", border: "#86EFAC" },
    oven: { bg: "#FFEDD5", text: "#9A3412", border: "#FDBA74" },
    "deep-clean": { bg: "#F3E8FF", text: "#7E22CE", border: "#D8B4FE" },
    general: { bg: "#F3F4F6", text: "#374151", border: "#D1D5DB" },
  };

  return colors[service] || colors.general;
}

function formatTime12h(timeValue) {
  if (!timeValue) return "-";

  const raw = String(timeValue).trim();

  if (raw.includes("T")) {
    const dt = new Date(raw);
    if (!Number.isNaN(dt.getTime())) {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Toronto",
        hour: "numeric",
        minute: "2-digit",
      }).format(dt);
    }
  }

  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return raw;

  const hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;

  return `${hour12}:${minute} ${suffix}`;
}

function sortJobsByStart(jobs) {
  return [...jobs].sort((a, b) => {
    const aTime = String(a.arrival_window_start || "");
    const bTime = String(b.arrival_window_start || "");
    return aTime.localeCompare(bTime);
  });
}

function buildGoogleMapsLink(group) {
  if (!group || !Array.isArray(group.jobs) || group.jobs.length === 0) return "";

  const addresses = [];

  if (group.tech?.home_address) {
    addresses.push(group.tech.home_address);
  }

  for (const job of group.jobs) {
    if (job.address) addresses.push(job.address);
  }

  const cleaned = addresses
    .map((a) => String(a || "").trim())
    .filter(Boolean);

  if (cleaned.length < 2) return "";

  const origin = encodeURIComponent(cleaned[0]);
  const destination = encodeURIComponent(cleaned[cleaned.length - 1]);
  const waypoints = cleaned.slice(1, -1).map(encodeURIComponent).join("|");

  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;

  if (waypoints) {
    url += `&waypoints=${waypoints}`;
  }

  return url;
}

function groupJobsByTech(jobs, technicians) {
  const techMap = new Map(
    technicians.map((tech) => [String(tech.id), { tech, jobs: [] }])
  );

  const unassigned = [];

  for (const job of jobs) {
    const techId = job.assigned_technician_id
      ? String(job.assigned_technician_id)
      : null;

    if (techId && techMap.has(techId)) {
      techMap.get(techId).jobs.push(job);
    } else {
      unassigned.push(job);
    }
  }

  const groups = Array.from(techMap.values()).map((group) => ({
    ...group,
    jobs: sortJobsByStart(group.jobs),
  }));

  groups.sort((a, b) =>
    getTechName(a.tech).localeCompare(getTechName(b.tech))
  );

  return {
    groups,
    unassigned: sortJobsByStart(unassigned),
  };
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
        .eq("is_active", true)
        .order("display_name", { ascending: true });

      if (error) throw error;
      setTechnicians(Array.isArray(data) ? data : []);
    } catch (err) {
      setTechnicians([]);
    }
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

  async function handleRouteTomorrow(force = false) {
    try {
      setLoadingRoute(true);
      setError("");

      const url = force
        ? "/api/route-tomorrow?force=true"
        : "/api/route-tomorrow";

      const res = await fetch(url);
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

  const groupedData = useMemo(() => {
    return groupJobsByTech(jobs, technicians);
  }, [jobs, technicians]);

  return (
    <div
      style={{
        padding: 24,
        maxWidth: 1280,
        margin: "0 auto",
        fontFamily: "Arial, sans-serif",
        color: "#111827",
      }}
    >
      <h1 style={{ marginBottom: 8 }}>Deep Cleans Routing</h1>
      <p style={{ marginTop: 0, color: "#4B5563" }}>Tomorrow: {tomorrow || "-"}</p>

      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <button onClick={() => handleRouteTomorrow(false)} disabled={loadingRoute}>
          {loadingRoute ? "Routing..." : "Route Tomorrow"}
        </button>

        <button onClick={() => handleRouteTomorrow(true)} disabled={loadingRoute}>
          {loadingRoute ? "Routing..." : "Force Re-Route"}
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
            border: "1px solid #FCA5A5",
            background: "#FEF2F2",
            color: "#991B1B",
            borderRadius: 8,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.35fr 0.9fr",
          gap: 20,
          alignItems: "start",
        }}
      >
        <div>
          <h2 style={{ marginTop: 0 }}>Dispatch Board</h2>

          {groupedData.unassigned.length > 0 ? (
            <div
              style={{
                border: "1px solid #FCA5A5",
                background: "#FEF2F2",
                borderRadius: 12,
                padding: 16,
                marginBottom: 20,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 10 }}>
                Unassigned Jobs
              </div>

              {groupedData.unassigned.map((job) => {
                const badgeStyle = getServiceBadgeStyle(job.service_type);

                return (
                  <div
                    key={job.id}
                    style={{
                      border: "1px solid #F3CACA",
                      borderRadius: 10,
                      padding: 12,
                      marginBottom: 10,
                      background: "#FFFFFF",
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{job.title || "Untitled Job"}</div>

                    <div style={{ marginTop: 6 }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "4px 8px",
                          borderRadius: 999,
                          border: `1px solid ${badgeStyle.border}`,
                          background: badgeStyle.bg,
                          color: badgeStyle.text,
                          fontSize: 12,
                          fontWeight: 700,
                          textTransform: "capitalize",
                        }}
                      >
                        {normalizeServiceType(job.service_type)}
                      </span>
                    </div>

                    <div style={{ marginTop: 8 }}>{job.address || "-"}</div>
                    <div style={{ marginTop: 6, color: "#4B5563" }}>
                      {formatTime12h(job.arrival_window_start)} →{" "}
                      {formatTime12h(job.arrival_window_end)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {groupedData.groups.map((group) => {
            const routeLink = buildGoogleMapsLink(group);

            return (
              <div
                key={group.tech.id}
                style={{
                  border: "1px solid #E5E7EB",
                  borderRadius: 14,
                  padding: 16,
                  marginBottom: 18,
                  background: "#FFFFFF",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 20 }}>
                      {getTechName(group.tech)}
                    </div>
                    <div style={{ color: "#6B7280", marginTop: 4 }}>
                      {group.tech.home_address || "No home address"}
                    </div>
                    <div style={{ color: "#4B5563", marginTop: 6 }}>
                      Skills:{" "}
                      {Array.isArray(group.tech.services) && group.tech.services.length
                        ? group.tech.services.join(", ")
                        : "-"}
                    </div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700 }}>
                      {group.jobs.length} job{group.jobs.length === 1 ? "" : "s"}
                    </div>
                    {routeLink ? (
                      <a
                        href={routeLink}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "inline-block",
                          marginTop: 8,
                          textDecoration: "none",
                          color: "#1D4ED8",
                          fontWeight: 700,
                        }}
                      >
                        Open Route in Google Maps
                      </a>
                    ) : null}
                  </div>
                </div>

                {group.jobs.length === 0 ? (
                  <div style={{ color: "#9CA3AF" }}>No jobs assigned.</div>
                ) : (
                  group.jobs.map((job, index) => {
                    const badgeStyle = getServiceBadgeStyle(job.service_type);

                    return (
                      <div
                        key={job.id}
                        style={{
                          borderTop: index === 0 ? "1px solid #F3F4F6" : "1px solid #F3F4F6",
                          paddingTop: 12,
                          marginTop: 12,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: 12,
                            flexWrap: "wrap",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 16 }}>
                              {index + 1}. {job.title || "Untitled Job"}
                            </div>

                            <div style={{ marginTop: 6 }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "4px 8px",
                                  borderRadius: 999,
                                  border: `1px solid ${badgeStyle.border}`,
                                  background: badgeStyle.bg,
                                  color: badgeStyle.text,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  textTransform: "capitalize",
                                }}
                              >
                                {normalizeServiceType(job.service_type)}
                              </span>
                            </div>

                            <div style={{ marginTop: 8 }}>{job.address || "-"}</div>
                          </div>

                          <div
                            style={{
                              minWidth: 120,
                              textAlign: "right",
                              fontWeight: 700,
                              color: "#111827",
                            }}
                          >
                            {formatTime12h(job.arrival_window_start)} →{" "}
                            {formatTime12h(job.arrival_window_end)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>

        <div>
          <h2 style={{ marginTop: 0 }}>System Results</h2>

          <div
            style={{
              border: "1px solid #E5E7EB",
              borderRadius: 12,
              padding: 14,
              marginBottom: 20,
              background: "#FFFFFF",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Last Route Result</div>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                margin: 0,
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              {routeResult
                ? JSON.stringify(routeResult, null, 2)
                : "No routing run yet."}
            </pre>
          </div>

          <div
            style={{
              border: "1px solid #E5E7EB",
              borderRadius: 12,
              padding: 14,
              background: "#FFFFFF",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Last Import Result</div>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                margin: 0,
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              {importResult
                ? JSON.stringify(importResult, null, 2)
                : "No import run yet."}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
