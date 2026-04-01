import { createClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default function Home() {
  const [techs, setTechs] = useState([])
  const [jobs, setJobs] = useState([])

  const [customerName, setCustomerName] = useState('')
  const [serviceType, setServiceType] = useState('')
  const [address, setAddress] = useState('')

  useEffect(() => {
    fetchTechs()
    fetchJobs()
  }, [])

  async function fetchTechs() {
    const { data } = await supabase
      .from('technicians')
      .select('*')
      .order('rank_position', { ascending: true })

    setTechs(data || [])
  }

  async function fetchJobs() {
    const { data } = await supabase
      .from('jobs')
      .select('*')
      .order('service_date', { ascending: true })

    setJobs(data || [])
  }

  async function addJob() {
    if (!customerName || !serviceType || !address) {
      alert('Fill all fields')
      return
    }

    const { error } = await supabase.from('jobs').insert([
      {
        google_event_id: `manual-${Date.now()}`,
        customer_name: customerName,
        service_type: serviceType,
        address,
        service_date: new Date().toISOString().split('T')[0],
        job_source: 'OTHER'
      }
    ])

    if (error) {
      alert(error.message)
      return
    }

    setCustomerName('')
    setServiceType('')
    setAddress('')
    fetchJobs()
  }

  async function assignTech(jobId, techId) {
    const { error } = await supabase
      .from('jobs')
      .update({ technician_id: techId || null })
      .eq('id', jobId)

    if (error) {
      alert(error.message)
      return
    }

    fetchJobs()
  }

  // 🔥 ROUND ROBIN AUTO ASSIGN
  async function autoAssign() {
    if (techs.length === 0) {
      alert('No technicians available')
      return
    }

    let techIndex = 0

    for (let job of jobs) {
      const tech = techs[techIndex]

      await supabase
        .from('jobs')
        .update({ technician_id: tech.id })
        .eq('id', job.id)

      techIndex++
      if (techIndex >= techs.length) techIndex = 0
    }

    fetchJobs()
    alert('Jobs auto-assigned')
  }

  return (
    <div style={{ padding: 40, fontFamily: 'Arial' }}>
      <h1>Deep Cleans Routing App</h1>

      <h2>Technicians</h2>
      {techs.map((t) => (
        <div key={t.id}>
          <strong>{t.display_name}</strong> ({t.email})
        </div>
      ))}

      <h2 style={{ marginTop: 30 }}>Add Job</h2>

      <input
        placeholder="Customer Name"
        value={customerName}
        onChange={(e) => setCustomerName(e.target.value)}
        style={{ display: 'block', marginBottom: 10, padding: 10 }}
      />

      <select
        value={serviceType}
        onChange={(e) => setServiceType(e.target.value)}
        style={{ display: 'block', marginBottom: 10, padding: 10 }}
      >
        <option value="">Select Service Type</option>
        <option value="BBQ">BBQ</option>
        <option value="WINDOWS">WINDOWS</option>
        <option value="GUTTERS">GUTTERS</option>
        <option value="OVEN">OVEN</option>
      </select>

      <input
        placeholder="Address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        style={{ display: 'block', marginBottom: 10, padding: 10 }}
      />

      <button onClick={addJob}>Add Job</button>

      <h2 style={{ marginTop: 40 }}>Jobs</h2>

      {/* 🔥 AUTO ASSIGN BUTTON */}
      <button
        onClick={autoAssign}
        style={{
          marginBottom: 20,
          padding: '10px 16px',
          fontWeight: 'bold'
        }}
      >
        Auto Assign Jobs
      </button>

      {jobs.map((job) => (
        <div key={job.id} style={{ marginBottom: 20 }}>
          <div><strong>{job.customer_name}</strong></div>
          <div>Service: {job.service_type}</div>
          <div>Address: {job.address}</div>
          <div>Date: {job.service_date}</div>

          <select
            value={job.technician_id || ''}
            onChange={(e) => assignTech(job.id, e.target.value)}
            style={{ marginTop: 8, padding: 10 }}
          >
            <option value="">Assign Technician</option>
            {techs.map((tech) => (
              <option key={tech.id} value={tech.id}>
                {tech.display_name}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
        }
