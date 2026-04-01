import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Home() {
  const [techs, setTechs] = useState([]);

  useEffect(() => {
    fetchTechs();
  }, []);

  async function fetchTechs() {
    const { data, error } = await supabase.from("technicians").select("*");

    if (error) {
      console.error(error);
    } else {
      setTechs(data);
    }
  }

  return (
    <div style={{ padding: 40, fontFamily: "Arial" }}>
      <h1>Deep Cleans Routing App</h1>

      <h2>Technicians</h2>

      {techs.length === 0 ? (
        <p>No technicians yet</p>
      ) : (
        techs.map((t) => (
          <div key={t.id}>
            {t.display_name} (Rank: {t.rank_position})
          </div>
        ))
      )}
    </div>
  );
}
