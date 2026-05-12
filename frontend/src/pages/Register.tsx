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
      subtitle="Set up your workspace in 2 minutes."
    >
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
        <FloatingField label="Full name" type="text" autoComplete="name" value={fullName} onChange={setFullName} />
        <FloatingField label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} required />
        <FloatingField label="Password" type="password" autoComplete="new-password" value={password} onChange={setPassword} required />
        <button className="btn-primary h-12 w-full" type="submit" disabled={loading}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
          {loading ? 'Creating account...' : 'Create account'}
        </button>
        <div className="pt-2 text-center text-sm text-obsidian-400">
          Already have an account?{' '}
          <Link className="font-medium text-blue-300 hover:text-blue-200" to="/login">
            Sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}
