import { FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Loader2, LogIn } from 'lucide-react'
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
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell eyebrow="Obsidian AI OS" title="Welcome back" subtitle="Sign in to command your autonomous company.">
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</div>}
        <FloatingField label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} required />
        <FloatingField label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} required />
        <button className="btn-primary h-12 w-full" type="submit" disabled={loading}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
          {loading ? 'Signing in...' : 'Enter Command Center'}
        </button>
        <div className="pt-2 text-center text-sm text-obsidian-400">
          New here? <Link className="font-medium text-accent-300 hover:text-accent-200" to="/register">Create your AI company</Link>
        </div>
      </form>
    </AuthShell>
  )
}
