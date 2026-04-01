import { createClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default function Home() {
  const [techs, setTechs] = useState([])

  useEffect(() => {
    async function fetchTechs() {
      const { data, error } = await supabase
        .from('technicians')
        .select('*')

      if (!error) setTechs(data)
    }

    fetchTechs()
  }, [])

  return (
    <div style={{ padding: 40 }}>
      <h1>Deep Cleans Routing App</h1>

      <h2>Technicians</h2>

      {techs.length === 0 && <p>No technicians yet</p>}

      {techs.map((tech) => (
        <div key={tech.id}>
          {tech.display_name} ({tech.email})
        </div>
      ))}
    </div>
  )
}
