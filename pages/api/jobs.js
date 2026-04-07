import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: "Missing date" });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("date", date)
      .order("start", { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      jobs: data || [],
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message || "Failed to fetch jobs",
    });
  }
}
