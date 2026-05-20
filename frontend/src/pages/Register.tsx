import { FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Loader2, UserPlus } from 'lucide-react'
import { extractApiError } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { AuthShell, FloatingField } from '../components/AuthShell'

export function Register() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await auth.register(email, password, fullName)
      const from = (location.state as any)?.from?.pathname || '/'
      navigate(from)
    } catch (err) {
      setError(extractApiError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      mode="signup"
      title="Start your AI agency"
      subtitle="Your workspace is ready in 2 minutes."
    >
      <form onSubmit={submit} className="space-y-4">
        <FloatingField label="Full name" type="text" autoComplete="name" value={fullName} onChange={setFullName} />
        <FloatingField label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} required />
        <FloatingField label="Password" type="password" autoComplete="new-password" value={password} onChange={setPassword} required />
        {error ? <p className="-mt-1 text-xs text-[var(--red)]">{error}</p> : null}
        <button className="btn-runner btn-primary btn-lg w-full justify-center" type="submit" disabled={loading}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
          {loading ? 'Creating account...' : 'Create account'}
        </button>
        <div className="pt-2 text-center text-sm text-[var(--text-3)]">
          Already have an account?{' '}
          <Link className="font-medium text-[var(--text-2)] transition-colors hover:text-indigo-300 hover:underline" to="/login">
            Sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}
