import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const { data, error } = await supabase.from("jobs").select("*");

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      jobs: data || [],
    });
  } catch (err) {
    console.error("Jobs API error:", err);
    return res.status(500).json({
      error: err.message || "Failed to fetch jobs",
    });
  }
}
