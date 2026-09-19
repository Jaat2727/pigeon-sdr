import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'
import logoImg from '../logo.png'
import './Login.css'

/* ────────────────────────────────────────────
   Clean Professional SVG Icons
──────────────────────────────────────────── */
function MailIcon({ className = 'lp-svg-icon' }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  )
}

function LockIcon({ className = 'lp-svg-icon' }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function UserIcon({ className = 'lp-svg-icon' }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function EyeIcon({ className = 'lp-svg-icon' }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon({ className = 'lp-svg-icon' }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  )
}



function GoogleIcon({ className = 'lp-google-icon' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function FacebookIcon({ className = 'lp-social-svg' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20" fill="#1877F2">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  )
}

function TwitterIcon({ className = 'lp-social-svg' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20" fill="#1DA1F2">
      <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.936 9.936 0 0024 4.59z"/>
    </svg>
  )
}

function LinkedInIcon({ className = 'lp-social-svg' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20" fill="#0A66C2">
      <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 8.76a1.64 1.64 0 1 0 0-3.28 1.64 1.64 0 0 0 0 3.28m1.39 9.74v-8.37H5.07v8.37h2.78z"/>
    </svg>
  )
}

/* ────────────────────────────────────────────
   Pupil – tracks mouse or accepts forced direction
──────────────────────────────────────────── */
/**
 * Offset of an element's centre towards the cursor, clamped to maxDistance.
 * Measuring happens inside an effect rather than during render: reading a ref
 * while rendering is not safe under concurrent React, and it was flagged by the
 * hooks linter on every eye in this illustration.
 */
function useLookAt(ref, mouse, maxDistance, forceLookX, forceLookY) {
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (forceLookX !== undefined && forceLookY !== undefined) {
      setPos({ x: forceLookX, y: forceLookY })
      return
    }
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const dx = mouse.x - (r.left + r.width / 2)
    const dy = mouse.y - (r.top + r.height / 2)
    const dist = Math.min(Math.hypot(dx, dy), maxDistance)
    const angle = Math.atan2(dy, dx)
    setPos({ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist })
  }, [ref, mouse, maxDistance, forceLookX, forceLookY])

  return pos
}

/** Cursor position, shared by every eye rather than one listener each. */
function useMousePosition() {
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  useEffect(() => {
    const onMove = (e) => setMouse({ x: e.clientX, y: e.clientY })
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])
  return mouse
}

function Pupil({ size = 12, maxDistance = 5, pupilColor = '#2D2D2D', forceLookX, forceLookY }) {
  const mouse = useMousePosition()
  const ref = useRef(null)
  const pos = useLookAt(ref, mouse, maxDistance, forceLookX, forceLookY)

  return (
    <div
      ref={ref}
      style={{
        width: size, height: size, borderRadius: '50%',
        backgroundColor: pupilColor,
        transform: `translate(${pos.x}px, ${pos.y}px)`,
        transition: 'transform 0.1s ease-out',
      }}
    />
  )
}

/* ────────────────────────────────────────────
   EyeBall – white sclera + tracking pupil
──────────────────────────────────────────── */
function EyeBall({
  size = 48, pupilSize = 16, maxDistance = 10,
  eyeColor = 'white', pupilColor = '#2D2D2D',
  isBlinking = false, forceLookX, forceLookY,
}) {
  const mouse = useMousePosition()
  const ref = useRef(null)
  const pos = useLookAt(ref, mouse, maxDistance, forceLookX, forceLookY)

  return (
    <div
      ref={ref}
      style={{
        width: size, height: isBlinking ? 2 : size,
        borderRadius: '50%', backgroundColor: eyeColor,
        overflow: 'hidden', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        transition: 'height 0.15s ease',
      }}
    >
      {!isBlinking && (
        <div style={{
          width: pupilSize, height: pupilSize, borderRadius: '50%',
          backgroundColor: pupilColor,
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          transition: 'transform 0.1s ease-out',
        }} />
      )}
    </div>
  )
}

/* ────────────────────────────────────────────
   Main Login Page
──────────────────────────────────────────── */
export default function Login({
  brandName = 'Pigeon SDR',
  taglineDesc = 'Autonomous SDR agents that research prospects, qualify them against your ICP, and write every message from what they found.',
  onLoginSuccess,
} = {}) {
  // Auth mode
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'

  // Form fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [fullName, setFullName] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Feedback
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Character animation state (Preserved exactly as designed)
  const [isPurpleBlinking, setIsPurpleBlinking] = useState(false)
  const [isBlackBlinking, setIsBlackBlinking] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false)
  const [isPurplePeeking, setIsPurplePeeking] = useState(false)

  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const purpleRef = useRef(null)
  const blackRef  = useRef(null)
  const yellowRef = useRef(null)
  const orangeRef = useRef(null)

  useEffect(() => {
    const onMove = (e) => setMouse({ x: e.clientX, y: e.clientY })
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  /* Random blinking – purple */
  useEffect(() => {
    const schedule = () => {
      const t = setTimeout(() => {
        setIsPurpleBlinking(true)
        setTimeout(() => { setIsPurpleBlinking(false); schedule() }, 150)
      }, Math.random() * 4000 + 3000)
      return t
    }
    const t = schedule()
    return () => clearTimeout(t)
  }, [])

  /* Random blinking – black */
  useEffect(() => {
    const schedule = () => {
      const t = setTimeout(() => {
        setIsBlackBlinking(true)
        setTimeout(() => { setIsBlackBlinking(false); schedule() }, 150)
      }, Math.random() * 4000 + 3000)
      return t
    }
    const t = schedule()
    return () => clearTimeout(t)
  }, [])

  /* Characters look at each other when typing starts */
  useEffect(() => {
    if (isTyping) {
      setIsLookingAtEachOther(true)
      const t = setTimeout(() => setIsLookingAtEachOther(false), 800)
      return () => clearTimeout(t)
    } else {
      setIsLookingAtEachOther(false)
    }
  }, [isTyping])

  /* Purple sneaky peek when password is visible */
  useEffect(() => {
    if (password.length > 0 && showPassword) {
      const schedule = () => {
        const t = setTimeout(() => {
          setIsPurplePeeking(true)
          setTimeout(() => setIsPurplePeeking(false), 800)
        }, Math.random() * 3000 + 2000)
        return t
      }
      const t = schedule()
      return () => clearTimeout(t)
    } else {
      setIsPurplePeeking(false)
    }
  }, [password, showPassword, isPurplePeeking])

  /**
   * How far each character leans and turns towards the cursor. Measured inside
   * an effect for the same reason as the eyes: reading a ref during render is
   * not safe under concurrent React.
   */
  const REST = { faceX: 0, faceY: 0, bodySkew: 0 }
  const [leans, setLeans] = useState({ purple: REST, black: REST, yellow: REST, orange: REST })

  useEffect(() => {
    const measure = (targetRef) => {
      const el = targetRef?.current
      if (!el) return REST
      const r = el.getBoundingClientRect()
      const dx = mouse.x - (r.left + r.width / 2)
      const dy = mouse.y - (r.top + r.height / 3)
      return {
        faceX: Math.max(-15, Math.min(15, dx / 20)),
        faceY: Math.max(-10, Math.min(10, dy / 30)),
        bodySkew: Math.max(-6, Math.min(6, -dx / 120)),
      }
    }
    setLeans({
      purple: measure(purpleRef),
      black: measure(blackRef),
      yellow: measure(yellowRef),
      orange: measure(orangeRef),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mouse])

  const purplePos = leans.purple
  const blackPos  = leans.black
  const yellowPos = leans.yellow
  const orangePos = leans.orange

  const passwordVisible = password.length > 0 && showPassword
  const passwordHidden  = password.length > 0 && !showPassword

  /* ── Auth handlers ── */

  const handleEmailSignIn = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setIsLoading(true)

    const { data: signInData, error: err } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (err) {
      setError(err.message)
    } else if (onLoginSuccess && signInData?.user) {
      onLoginSuccess(signInData.user)
    }
    setIsLoading(false)
  }

  const handleEmailSignUp = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (password !== confirmPw) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setIsLoading(true)

    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    })

    if (signUpErr) {
      setError(signUpErr.message)
      setIsLoading(false)
      return
    }

    // If auto-confirmed session exists
    if (signUpData?.session) {
      if (onLoginSuccess && signUpData?.user) {
        onLoginSuccess(signUpData.user)
      }
      setIsLoading(false)
      return
    }

    if (signUpData?.user?.identities?.length === 0) {
      setError('An account with this email already exists. Please sign in instead.')
      setMode('signin')
      setIsLoading(false)
      return
    }

    // Fallback sign-in attempt
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInErr) {
      setSuccess('Account created! Please check your email to confirm, then sign in.')
      setMode('signin')
    }
    setIsLoading(false)
  }

  const handleSocialLogin = async (provider) => {
    setIsLoading(true)
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    })
    setIsLoading(false)
  }

  const switchMode = () => {
    setMode(mode === 'signin' ? 'signup' : 'signin')
    setError('')
    setSuccess('')
    setPassword('')
    setConfirmPw('')
  }

  const onFocusField = () => setIsTyping(true)
  const onBlurField  = () => setIsTyping(false)

  const isSignUp = mode === 'signup'

  return (
    <div className="lp-root theme-light">
      {/* ── Left panel ── */}
      <div className="lp-left">
        <div className="lp-brand">
          <div className="lp-brand-emblem">
            <img src={logoImg} alt={brandName} className="lp-brand-logo" />
          </div>
          <div className="lp-brand-info">
            <div className="lp-brand-name-wrap">
              <span className="lp-brand-name">Pigeon</span>
              <span className="lp-brand-badge">SDR</span>
            </div>
            <span className="lp-brand-sub">Autonomous Sales Intelligence</span>
          </div>
        </div>

        {/* Animated Characters Stage */}
        <div className="lp-stage-wrap">
          <div className="lp-stage">

            {/* Purple Character */}
            <div
              ref={purpleRef}
              className="lp-char lp-purple"
              style={{
                height: (isTyping || passwordHidden) ? 440 : 400,
                transform: passwordVisible
                  ? 'skewX(0deg)'
                  : (isTyping || passwordHidden)
                    ? `skewX(${purplePos.bodySkew - 12}deg) translateX(40px)`
                    : `skewX(${purplePos.bodySkew}deg)`,
              }}
            >
              <div
                className="lp-eyes"
                style={{
                  left: passwordVisible ? 20 : isLookingAtEachOther ? 55 : 45 + purplePos.faceX,
                  top:  passwordVisible ? 35 : isLookingAtEachOther ? 65 : 40 + purplePos.faceY,
                  gap: 32,
                }}
              >
                <EyeBall size={18} pupilSize={7} maxDistance={5}
                  eyeColor="white" pupilColor="#2D2D2D"
                  isBlinking={isPurpleBlinking}
                  forceLookX={passwordVisible ? (isPurplePeeking ? 4 : -4) : isLookingAtEachOther ? 3 : undefined}
                  forceLookY={passwordVisible ? (isPurplePeeking ? 5 : -4) : isLookingAtEachOther ? 4 : undefined}
                />
                <EyeBall size={18} pupilSize={7} maxDistance={5}
                  eyeColor="white" pupilColor="#2D2D2D"
                  isBlinking={isPurpleBlinking}
                  forceLookX={passwordVisible ? (isPurplePeeking ? 4 : -4) : isLookingAtEachOther ? 3 : undefined}
                  forceLookY={passwordVisible ? (isPurplePeeking ? 5 : -4) : isLookingAtEachOther ? 4 : undefined}
                />
              </div>
            </div>

            {/* Black Character */}
            <div
              ref={blackRef}
              className="lp-char lp-black"
              style={{
                transform: passwordVisible
                  ? 'skewX(0deg)'
                  : isLookingAtEachOther
                    ? `skewX(${blackPos.bodySkew * 1.5 + 10}deg) translateX(20px)`
                    : `skewX(${blackPos.bodySkew}deg)`,
              }}
            >
              <div
                className="lp-eyes"
                style={{
                  left: passwordVisible ? 10 : isLookingAtEachOther ? 32 : 26 + blackPos.faceX,
                  top:  passwordVisible ? 28 : isLookingAtEachOther ? 12 : 32 + blackPos.faceY,
                  gap: 24,
                }}
              >
                <EyeBall size={16} pupilSize={6} maxDistance={4}
                  eyeColor="white" pupilColor="#2D2D2D"
                  isBlinking={isBlackBlinking}
                  forceLookX={passwordVisible ? -4 : isLookingAtEachOther ? 0 : undefined}
                  forceLookY={passwordVisible ? -4 : isLookingAtEachOther ? -4 : undefined}
                />
                <EyeBall size={16} pupilSize={6} maxDistance={4}
                  eyeColor="white" pupilColor="#2D2D2D"
                  isBlinking={isBlackBlinking}
                  forceLookX={passwordVisible ? -4 : isLookingAtEachOther ? 0 : undefined}
                  forceLookY={passwordVisible ? -4 : isLookingAtEachOther ? -4 : undefined}
                />
              </div>
            </div>

            {/* Orange Character */}
            <div
              ref={orangeRef}
              className="lp-char lp-orange"
              style={{
                transform: passwordVisible ? 'skewX(0deg)' : `skewX(${orangePos.bodySkew}deg)`,
              }}
            >
              <div
                className="lp-eyes"
                style={{
                  left: passwordVisible ? 50 : 82 + orangePos.faceX,
                  top:  passwordVisible ? 85 : 90 + orangePos.faceY,
                  gap: 32,
                }}
              >
                <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D"
                  forceLookX={passwordVisible ? -5 : undefined}
                  forceLookY={passwordVisible ? -4 : undefined}
                />
                <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D"
                  forceLookX={passwordVisible ? -5 : undefined}
                  forceLookY={passwordVisible ? -4 : undefined}
                />
              </div>
            </div>

            {/* Yellow Character */}
            <div
              ref={yellowRef}
              className="lp-char lp-yellow"
              style={{
                transform: passwordVisible ? 'skewX(0deg)' : `skewX(${yellowPos.bodySkew}deg)`,
              }}
            >
              <div
                className="lp-eyes"
                style={{
                  left: passwordVisible ? 20 : 52 + yellowPos.faceX,
                  top:  passwordVisible ? 35 : 40 + yellowPos.faceY,
                  gap: 24,
                }}
              >
                <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D"
                  forceLookX={passwordVisible ? -5 : undefined}
                  forceLookY={passwordVisible ? -4 : undefined}
                />
                <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D"
                  forceLookX={passwordVisible ? -5 : undefined}
                  forceLookY={passwordVisible ? -4 : undefined}
                />
              </div>
              <div
                className="lp-mouth"
                style={{
                  left: passwordVisible ? 10 : 40 + yellowPos.faceX,
                  top:  passwordVisible ? 88 : 88 + yellowPos.faceY,
                }}
              />
            </div>

          </div>
        </div>

        {/* Tagline */}
        <div className="lp-left-tagline">
          <h2 className="lp-hero-heading">
            Autonomous Sales Intelligence<span className="lp-dot-accent">.</span>
          </h2>
          <p className="lp-hero-desc">{taglineDesc}</p>
        </div>

        {/* Footer */}
        <div className="lp-left-footer">
          <span>© 2025 Pigeon SDR • Outbound Intelligence</span>
        </div>

        {/* Decorative elements */}
        <div className="lp-blob lp-blob-1" />
        <div className="lp-blob lp-blob-2" />
        <div className="lp-grid-overlay" />
      </div>

      {/* ── Right panel ── */}
      <div className="lp-right">
        {/* Mobile brand header */}
        <div className="lp-brand lp-brand-mobile">
          <div className="lp-brand-emblem">
            <img src={logoImg} alt={brandName} className="lp-brand-logo" />
          </div>
          <div className="lp-brand-info">
            <div className="lp-brand-name-wrap">
              <span className="lp-brand-name">Pigeon</span>
              <span className="lp-brand-badge">SDR</span>
            </div>
            <span className="lp-brand-sub">Autonomous Sales Intelligence</span>
          </div>
        </div>

        <div className="lp-form-card">
          <div className="lp-header">
            <h1 className="lp-aesthetic-title">{isSignUp ? 'Create Account' : 'Welcome Back'}</h1>
            <p className="lp-aesthetic-sub">
              {isSignUp ? 'Sign up to start automating your outbound pipeline.' : 'Sign in to access your SDR intelligence dashboard.'}
            </p>
          </div>

          {/* Segmented Sign In / Sign Up Pills */}
          <div className="lp-mode-pills">
            <button
              type="button"
              className={`lp-mode-pill ${!isSignUp ? 'active' : ''}`}
              onClick={() => { setMode('signin'); setError(''); setSuccess(''); }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`lp-mode-pill ${isSignUp ? 'active' : ''}`}
              onClick={() => { setMode('signup'); setError(''); setSuccess(''); }}
            >
              Sign Up
            </button>
          </div>

          {/* ── Form with Pill Aesthetics ── */}
          <form onSubmit={isSignUp ? handleEmailSignUp : handleEmailSignIn} className="lp-form">

            {isSignUp && (
              <div className="lp-field">
                <div className="lp-input-wrap lp-pill-wrap">
                  <span className="lp-input-icon">
                    <UserIcon />
                  </span>
                  <input
                    id="lp-name"
                    type="text"
                    placeholder="Full Name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    onFocus={onFocusField}
                    onBlur={onBlurField}
                    className="lp-input lp-input-pill"
                    autoComplete="name"
                    required
                  />
                </div>
              </div>
            )}

            <div className="lp-field">
              <div className="lp-input-wrap lp-pill-wrap">
                <span className="lp-input-icon">
                  <MailIcon />
                </span>
                <input
                  id="lp-email"
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={onFocusField}
                  onBlur={onBlurField}
                  className="lp-input lp-input-pill"
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div className="lp-field">
              <div className="lp-input-wrap lp-pill-wrap">
                <span className="lp-input-icon">
                  <LockIcon />
                </span>
                <input
                  id="lp-pw"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={onFocusField}
                  onBlur={onBlurField}
                  className="lp-input lp-input-pill"
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  required
                />
                <button
                  type="button"
                  className="lp-pw-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            {isSignUp && (
              <div className="lp-field">
                <div className="lp-input-wrap lp-pill-wrap">
                  <span className="lp-input-icon">
                    <LockIcon />
                  </span>
                  <input
                    id="lp-cpw"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Confirm Password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    onFocus={onFocusField}
                    onBlur={onBlurField}
                    className="lp-input lp-input-pill"
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>
            )}

            {!isSignUp && (
              <div className="lp-row-between lp-remember-row">
                <label className="lp-checkbox-label">
                  <input type="checkbox" className="lp-checkbox" />
                  <span>Remember me</span>
                </label>
                <a href="#forgot" onClick={(e) => { e.preventDefault(); alert('Password recovery link sent.'); }} className="lp-link">Forgot password?</a>
              </div>
            )}

            {error && <div className="lp-alert lp-alert-error">{error}</div>}
            {success && <div className="lp-alert lp-alert-success">{success}</div>}

            <div className="lp-submit-center">
              <button
                type="submit"
                className="lp-submit-btn lp-submit-pill"
                disabled={isLoading}
              >
                {isLoading ? 'PLEASE WAIT…' : (isSignUp ? 'SIGN UP' : 'LOGIN')}
              </button>
            </div>
          </form>

          {/* ── Social Platforms Row ── */}
          <div className="lp-social-section">
            <p className="lp-social-title">Or sign in with social platforms</p>
            <div className="lp-social-row">
              <button
                type="button"
                className="lp-social-circle"
                onClick={() => handleSocialLogin('google')}
                title="Google"
                aria-label="Continue with Google"
              >
                <GoogleIcon />
              </button>
            </div>
          </div>

          {/* Mode toggle */}
          <p className="lp-switch-mode">
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button type="button" className="lp-link-btn" onClick={switchMode}>
              {isSignUp ? 'Sign In' : 'Sign Up'}
            </button>
          </p>

        </div>
      </div>
    </div>
  )
}