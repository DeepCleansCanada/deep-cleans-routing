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
      .select('*')
      .order('rank_position', { ascending: true })

    if (error) {
      console.error('TECH ERROR:', error)
      return
    }

    setTechs(data || [])
  }

  async function fetchJobs() {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .order('service_date', { ascending: true })

    if (error) {
  console.error('ADD JOB ERROR:', error)
  alert(error.message)
  return
    }
    }

    setJobs(data || [])
  }

  async function addJob() {
    if (!customerName || !serviceType || !address) {
      alert('Please fill in customer name, service type, and address.')
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
      console.error('ADD JOB ERROR:', error)
      alert('Could not add job.')
      return
    }

    setCustomerName('')
    setServiceType('')
    setAddress('')
    fetchJobs()
  }

  return (
    <div style={{ padding: 40, fontFamily: 'Arial, sans-serif' }}>
      <h1>Deep Cleans Routing App</h1>

      <h2>Technicians</h2>
      {techs.length === 0 ? (
        <p>No technicians yet</p>
      ) : (
        techs.map((tech) => (
          <div key={tech.id} style={{ marginBottom: 12 }}>
            <strong>{tech.display_name}</strong> ({tech.email || 'no email'})
          </div>
        ))
      )}

      <h2 style={{ marginTop: 32 }}>Add Job</h2>

      <div style={{ marginBottom: 30, maxWidth: 420 }}>
        <input
          type="text"
          placeholder="Customer Name"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          style={{
            display: 'block',
            width: '100%',
            marginBottom: 10,
            padding: 10,
            fontSize: 16
          }}
        />

        <select
  value={serviceType}
  onChange={(e) => setServiceType(e.target.value)}
  style={{
    display: 'block',
    width: '100%',
    marginBottom: 10,
    padding: 10,
    fontSize: 16
  }}
>
  <option value="">Select Service Type</option>
  <option value="BBQ">BBQ</option>
  <option value="WINDOWS">WINDOWS</option>
  <option value="GUTTERS">GUTTERS</option>
  <option value="CARPET_UPHOLSTERY">CARPET & UPHOLSTERY</option>
  <option value="PRESSURE_WASHING">PRESSURE WASHING</option>
  <option value="OVEN_CLEANING">OVEN CLEANING</option>
</select>

        <input
          type="text"
          placeholder="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          style={{
            display: 'block',
            width: '100%',
            marginBottom: 10,
            padding: 10,
            fontSize: 16
          }}
        />

        <button
          onClick={addJob}
          style={{
            padding: '10px 16px',
            fontSize: 16,
            cursor: 'pointer'
          }}
        >
          Add Job
        </button>
      </div>

      <h2>Jobs</h2>
      {jobs.length === 0 ? (
        <p>No jobs yet</p>
      ) : (
        jobs.map((job) => (
          <div key={job.id} style={{ marginBottom: 18 }}>
            <div>
              <strong>{job.customer_name || 'Unnamed Job'}</strong>
            </div>
            <div>Service: {job.service_type || '-'}</div>
            <div>Address: {job.address || '-'}</div>
            <div>Date: {job.service_date || '-'}</div>
          </div>
        ))
      )}
    </div>
  )
}
