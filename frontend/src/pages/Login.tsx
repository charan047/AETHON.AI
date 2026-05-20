import { FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Loader2, LogIn } from 'lucide-react'
import { extractApiError } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { AuthShell, FloatingField } from '../components/AuthShell'

export function Login() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await auth.login(email, password)
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
      mode="signin"
      title="Welcome back"
      subtitle="Sign in to your agency dashboard."
    >
      <form onSubmit={submit} className="space-y-4">
        <FloatingField label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} required />
        <FloatingField label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} required />
        {error ? <p className="-mt-1 text-xs text-[var(--red)]">{error}</p> : null}
        <button className="btn-runner btn-primary btn-lg w-full justify-center text-sm font-semibold" type="submit" disabled={loading}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
        <div className="pt-2 text-center text-sm text-[var(--text-3)]">
          Don&apos;t have an account?{' '}
          <Link className="font-medium text-[var(--text-2)] transition-colors hover:text-indigo-300 hover:underline" to="/register">
            Start your agency <span aria-hidden="true">→</span>
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}
