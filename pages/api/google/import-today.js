import importTomorrowHandler from "./import-tomorrow";

function getTodayDateToronto() {
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

  return `${year}-${month}-${day}`;
}

export default async function handler(req, res) {
  req.method = "POST";
  req.body = {
    ...(req.body || {}),
    service_date: getTodayDateToronto(),
  };

  req.query = {
    ...(req.query || {}),
    service_date: getTodayDateToronto(),
  };

  return importTomorrowHandler(req, res);
}
