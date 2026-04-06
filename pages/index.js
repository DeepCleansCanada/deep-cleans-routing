import { createClient } from '@supabase/supabase-js'
import { useEffect, useMemo, useState } from 'react'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const GOOGLE_CLIENT_ID =
  '666287584933-5mio8k83tmh829rnd22728q37snt71mk.apps.googleusercontent.com'

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar'

function getTomorrowDateString() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

function getTomorrowDateRange() {
  const start = new Date()
  start.setDate(start.getDate() + 1)
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  return {
    timeMin: start.toISOString(),
    timeMax: end.toISOString()
  }
}

function parseServiceType(text) {
  const upper = (text || '').toUpperCase()

  if (upper.includes('BBQ')) return 'BBQ'
  if (upper.includes('WINDOW')) return 'WINDOWS'
  if (upper.includes('GUTTER')) return 'GUTTERS'
  if (upper.includes('CARPET') || upper.includes('UPHOLSTERY')) return 'CARPET_UPHOLSTERY'
  if (upper.includes('PRESSURE')) return 'PRESSURE_WASHING'
  if (upper.includes('OVEN')) return 'OVEN_CLEANING'

  return 'BBQ'
}

export default function Home() {
  const [techs, setTechs] = useState([])
  const [jobs, setJobs] = useState([])
  const [customerName, setCustomerName] = useState('')
  const [serviceType, setServiceType] = useState('')
  const [address, setAddress] = useState('')
  const [serviceDate, setServiceDate] = useState(getTomorrowDateString())
  const [googleReady, setGoogleReady] = useState(false)
  const [accessToken, setAccessToken] = useState('')

  const tomorrow = useMemo(() => getTomorrowDateString(), [])

  useEffect(() => {
    fetchTechs()
    fetchJobs()
    loadGoogleScript()
  }, [])

  async function fetchTechs() {
    const { data, error } = await supabase
      .from('technicians')
      .select(`*, technician_services(service_type)`)
      .order('rank_position', { ascending: true })

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
      .order('service_date', { ascending: true })

    if (error) {
      alert(error.message)
      return
    }

    setJobs(data || [])
  }

  function loadGoogleScript() {
    if (window.google && window.google.accounts) {
      setGoogleReady(true)
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => setGoogleReady(true)
    document.body.appendChild(script)
  }

  function connectGoogleCalendar() {
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
      alert('Google API not ready yet')
      return
    }

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPE,
      callback: (response) => {
        if (response.access_token) {
          setAccessToken(response.access_token)
          alert('Google Calendar connected')
        }
      }
    })

    tokenClient.requestAccessToken()
  }

  async function importTomorrowFromGoogleCalendar() {
    if (!accessToken) {
      alert('Connect Google Calendar first')
      return
    }

    const { timeMin, timeMax } = getTomorrowDateRange()

    const url =
      `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
      `?timeMin=${encodeURIComponent(timeMin)}` +
      `&timeMax=${encodeURIComponent(timeMax)}` +
      `&singleEvents=true&orderBy=startTime`

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    const result = await response.json()

    if (!response.ok) {
      alert(result.error?.message || 'Failed to fetch calendar events')
      return
    }

    const events = result.items || []

    for (const event of events) {
      const customerNameFromEvent = event.summary || 'Calendar Job'
      const description = event.description || ''
      const location = event.location || ''
      const serviceTypeFromEvent = parseServiceType(
        `${event.summary || ''} ${description}`
      )

      const { error } = await supabase
        .from('jobs')
        .upsert(
          [
            {
              google_event_id: event.id,
              customer_name: customerNameFromEvent,
              service_type: serviceTypeFromEvent,
              address: location,
              service_date: tomorrow,
              job_source: 'GOOGLE_CALENDAR'
            }
          ],
          { onConflict: 'google_event_id' }
        )

      if (error) {
        console.error('IMPORT ERROR:', error)
      }
    }

    fetchJobs()
    alert(`Imported ${events.length} calendar events for tomorrow`)
  }

  async function addJob() {
    if (!customerName || !serviceType || !address || !serviceDate) {
      alert('Fill all fields')
      return
    }

    const { error } = await supabase.from('jobs').insert([
      {
        google_event_id: `manual-${Date.now()}`,
        customer_name: customerName,
        service_type: serviceType,
        address,
        service_date: serviceDate,
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
    setServiceDate(getTomorrowDateString())
    fetchJobs()
  }

  function getEligibleTechs(service) {
    return techs.filter((t) =>
      (t.technician_services || []).some(
        (s) => s.service_type === service
      )
    )
  }

  function getJobCountsForJobs(targetJobs) {
    const counts = {}

    targetJobs.forEach((job) => {
      if (job.technician_id) {
        counts[job.technician_id] = (counts[job.technician_id] || 0) + 1
      }
    })

    return counts
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

  async function routeTomorrow() {
    const tomorrowJobs = jobs.filter((job) => job.service_date === tomorrow)

    if (tomorrowJobs.length === 0) {
      alert('No jobs scheduled for tomorrow')
      return
    }

    const jobCounts = getJobCountsForJobs(tomorrowJobs)

    for (const job of tomorrowJobs) {
      const eligible = getEligibleTechs(job.service_type)

      if (eligible.length === 0) {
        await supabase
          .from('jobs')
          .update({ technician_id: null })
          .eq('id', job.id)
        continue
      }

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
    alert('Tomorrow jobs routed')
  }

  const tomorrowJobs = jobs.filter((job) => job.service_date === tomorrow)
  const otherJobs = jobs.filter((job) => job.service_date !== tomorrow)

  return (
    <div style={{ padding: 40 }}>
      <h1>Deep Cleans Routing App</h1>

      <div style={{ marginBottom: 20 }}>
        <button onClick={connectGoogleCalendar} disabled={!googleReady} style={{ marginRight: 10 }}>
          {accessToken ? 'Google Calendar Connected' : 'Connect Google Calendar'}
        </button>

        <button onClick={importTomorrowFromGoogleCalendar} disabled={!accessToken}>
          Pull Tomorrow From Google Calendar
        </button>
      </div>

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
        type="date"
        value={serviceDate}
        onChange={(e) => setServiceDate(e.target.value)}
        style={{ display: 'block', marginBottom: 10, padding: 10, width: '100%', maxWidth: 420 }}
      />

      <input
        placeholder="Address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        style={{ display: 'block', marginBottom: 10, padding: 10, width: '100%', maxWidth: 420 }}
      />

      <button onClick={addJob} style={{ marginBottom: 30 }}>
        Add Job
      </button>

      <h2>Tomorrow's Jobs</h2>

      <button onClick={routeTomorrow} style={{ marginBottom: 20 }}>
        Route Tomorrow
      </button>

      {tomorrowJobs.length === 0 ? (
        <p>No jobs scheduled for tomorrow.</p>
      ) : (
        tomorrowJobs.map((job) => (
          <div key={job.id} style={{ marginTop: 20 }}>
            <strong>{job.customer_name}</strong>
            <div>Service: {job.service_type}</div>
            <div>Address: {job.address || 'No address'}</div>
            <div>Date: {job.service_date}</div>
            <div>
              Assigned:{' '}
              {techs.find((t) => t.id === job.technician_id)?.display_name || 'None'}
            </div>

            <select
              value={job.technician_id || ''}
              onChange={(e) => assignTech(job.id, e.target.value)}
              style={{ display: 'block', marginTop: 8, padding: 10, width: '100%', maxWidth: 320 }}
            >
              <option value="">Assign Technician</option>
              {getEligibleTechs(job.service_type).map((tech) => (
                <option key={tech.id} value={tech.id}>
                  {tech.display_name}
                </option>
              ))}
            </select>
          </div>
        ))
      )}

      <h2 style={{ marginTop: 40 }}>Other Jobs</h2>

      {otherJobs.length === 0 ? (
        <p>No other jobs.</p>
      ) : (
        otherJobs.map((job) => (
          <div key={job.id} style={{ marginTop: 20, opacity: 0.8 }}>
            <strong>{job.customer_name}</strong>
            <div>Service: {job.service_type}</div>
            <div>Address: {job.address || 'No address'}</div>
            <div>Date: {job.service_date}</div>
            <div>
              Assigned:{' '}
              {techs.find((t) => t.id === job.technician_id)?.display_name || 'None'}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
