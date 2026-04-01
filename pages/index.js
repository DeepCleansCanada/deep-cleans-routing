import { createClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default function Home() {
  const [techs, setTechs] = useState([])
  const [jobs, setJobs] = useState([])

  useEffect(() => {
    fetchTechs()
    fetchJobs()
  }, [])

  async function fetchTechs() {
    const { data, error } = await supabase
      .from('technicians')
      .select('*')
      .order('rank_position', { ascending: true })

    if (!error) setTechs(data || [])
  }

  async function fetchJobs() {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .order('service_date', { ascending: true })

    if (!error) setJobs(data || [])
  }

  return (
    <div style={{ padding: 40, fontFamily: 'Arial' }}>
      <h1>Deep Cleans Routing App</h1>

      <h2>Technicians</h2>
      {techs.length === 0 ? (
        <p>No technicians yet</p>
      ) : (
        techs.map((tech) => (
          <div key={tech.id} style={{ marginBottom: 10 }}>
            {tech.display_name} ({tech.email || 'no email'})
          </div>
        ))
      )}

      <h2 style={{ marginTop: 30 }}>Jobs</h2>
      {jobs.length === 0 ? (
        <p>No jobs yet</p>
      ) : (
        jobs.map((job) => (
          <div key={job.id} style={{ marginBottom: 12 }}>
            <div><strong>{job.customer_name || 'Unnamed Job'}</strong></div>
            <div>Service: {job.service_type || '-'}</div>
            <div>Address: {job.address || '-'}</div>
            <div>Date: {job.service_date || '-'}</div>
          </div>
        ))
      )}
    </div>
  )
}
