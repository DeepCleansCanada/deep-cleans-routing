const { google } = require("googleapis");
const { createClient } = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { date, calendarNames = [] } = req.body || {};

    if (!date) {
      return res.status(400).json({ error: "Missing date" });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const calendarListResponse = await calendar.calendarList.list();
    const allCalendars = calendarListResponse.data.items || [];

    const targetCalendars =
      calendarNames.length > 0
        ? allCalendars.filter((cal) => calendarNames.includes(cal.summary))
        : allCalendars;

    const timeMin = `${date}T00:00:00-04:00`;
    const timeMax = `${date}T23:59:59-04:00`;

    const allEvents = [];

    for (const cal of targetCalendars) {
      const eventsResponse = await calendar.events.list({
        calendarId: cal.id,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
      });

      const items = eventsResponse.data.items || [];

      for (const event of items) {
        allEvents.push({
          id: event.id,
          title: event.summary || "Untitled Job",
          start: event.start?.dateTime || event.start?.date || "",
          end: event.end?.dateTime || event.end?.date || "",
          address: event.location || "",
          description: event.description || "",
          calendarName: cal.summary,
          source: "google",
          date,
        });
      }
    }

    const rowsToInsert = allEvents.map((event) => ({
      id: event.id,
      title: event.title,
      address: event.address,
      start: event.start,
      end: event.end,
      date: event.date,
      source: event.source,
      calendar_name: event.calendarName,
      description: event.description,
      assigned_to: null,
    }));

    let saved = 0;
    let dbError = null;

    if (rowsToInsert.length > 0) {
      const result = await supabase
        .from("jobs")
        .upsert(rowsToInsert, { onConflict: "id" })
        .select();

      if (result.error) {
        dbError = result.error.message;
      } else {
        saved = Array.isArray(result.data) ? result.data.length : 0;
      }
    }

    return res.status(200).json({
      success: true,
      fetched: allEvents.length,
      imported: rowsToInsert.length,
      saved,
      skipped: 0,
      calendarNames: targetCalendars.map((c) => c.summary),
      timeMin,
      timeMax,
      samples: allEvents.slice(0, 5),
      events: allEvents,
      dbError,
    });
  } catch (error) {
    console.error("import-tomorrow error:", error);

    return res.status(500).json({
      error: error.message || "Import failed",
    });
  }
};
