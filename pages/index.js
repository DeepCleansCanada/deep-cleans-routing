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
    const { data, error } = await supabase
      .from('technicians')
      .select(`*, technician_services(service_type)`)

    if (error) {
      alert(error.message)
      return
    }

    setTechs(data || [])
  }

  async function fetchJobs() {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')

    if (error) {
      alert(error.message)
      return
    }

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
        address: address,
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

  function getEligibleTechs(service) {
    return techs.filter((t) =>
      (t.technician_services || []).some(
        (s) => s.service_type === service
      )
    )
  }

  function getJobCounts() {
    const counts = {}

    jobs.forEach((job) => {
      if (job.technician_id) {
        counts[job.technician_id] = (counts[job.technician_id] || 0) + 1
      }
    })

    return counts
  }

  async function autoAssign() {
    const jobCounts = getJobCounts()

    for (const job of jobs) {
      const eligible = getEligibleTechs(job.service_type)

      if (eligible.length === 0) continue

      let bestTech = eligible[0]
      let lowestCount = jobCounts[bestTech.id] || 0

      for (const tech of eligible) {
        const count = jobCounts[tech.id] || 0
        if (count < lowestCount) {
          bestTech = tech
          lowestCount = count
        }
      }

      await supabase
        .from('jobs')
        .update({ technician_id: bestTech.id })
        .eq('id', job.id)

      jobCounts[bestTech.id] = (jobCounts[bestTech.id] || 0) + 1
    }

    fetchJobs()
    alert('Smart assignment complete')
  }

  return (
    <div style={{ padding: 40 }}>
      <h1>Deep Cleans Routing App</h1>

      <h2>Technicians</h2>
      {techs.map((t) => (
        <div key={t.id} style={{ marginBottom: 12 }}>
          <div><strong>{t.display_name}</strong></div>
          <div style={{ fontSize: 14 }}>
            Skills: {(t.technician_services || []).map((s) => s.service_type).join(', ') || 'None'}
          </div>
        </div>
      ))}

      <h2>Add Job</h2>

      <input
        placeholder="Customer Name"
        value={customerName}
        onChange={(e) => setCustomerName(e.target.value)}
        style={{ display: 'block', marginBottom: 10, padding: 10, width: '100%', maxWidth: 420 }}
      />

      <select
        value={serviceType}
        onChange={(e) => setServiceType(e.target.value)}
        style={{ display: 'block', marginBottom: 10, padding: 10, width: '100%', maxWidth: 420 }}
      >
        <option value="">Select Service Type</option>
        <option value="BBQ">BBQ</option>
        <option value="WINDOWS">WINDOWS</option>
        <option value="GUTTERS">GUTTERS</option>
        <option value="CARPET_UPHOLSTERY">CARPET &amp; UPHOLSTERY</option>
        <option value="PRESSURE_WASHING">PRESSURE WASHING</option>
        <option value="OVEN_CLEANING">OVEN CLEANING</option>
      </select>

      <input
        placeholder="Address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        style={{ display: 'block', marginBottom: 10, padding: 10, width: '100%', maxWidth: 420 }}
      />

      <button onClick={addJob} style={{ marginBottom: 30 }}>
        Add Job
      </button>

      <h2>Jobs</h2>

      <button onClick={autoAssign} style={{ marginBottom: 20 }}>
        Auto Assign Jobs
      </button>

      {jobs.map((job) => (
        <div key={job.id} style={{ marginTop: 20 }}>
          <strong>{job.customer_name}</strong>
          <div>Service: {job.service_type}</div>
          <div>Address: {job.address}</div>
          <div>
            Assigned:{' '}
            {techs.find((t) => t.id === job.technician_id)?.display_name || 'None'}
          </div>
        </div>
      ))}
    </div>
  )
        }
