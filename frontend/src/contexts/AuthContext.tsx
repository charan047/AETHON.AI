import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api/client'

export interface AuthState {
  accessToken: string | null
  userId: string | null
  role: string | null
  isAuthenticated: boolean
}

interface AuthContextValue extends AuthState {
  email: string | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, fullName?: string) => Promise<void>
  logout: () => void
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  user_id: string
  role: string
  email?: string
}

const initialState: AuthState = {
  accessToken: null,
  userId: null,
  role: null,
  isAuthenticated: false,
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(initialState)
  const [email, setEmail] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const setTokens = (tokens: TokenResponse, nextEmail?: string) => {
    api.defaults.headers.common.Authorization = `Bearer ${tokens.access_token}`
    setAuth({
      accessToken: tokens.access_token,
      userId: tokens.user_id,
      role: tokens.role,
      isAuthenticated: true,
    })
    setEmail(nextEmail || tokens.email || null)
  }

  const login = async (emailValue: string, password: string) => {
    const { data } = await api.post<TokenResponse>('/auth/login', { email: emailValue, password })
    setTokens(data, emailValue)
  }

  const register = async (emailValue: string, password: string, fullName?: string) => {
    const { data } = await api.post<TokenResponse>('/auth/register', {
      email: emailValue,
      password,
      full_name: fullName || undefined,
    })
    setTokens(data, emailValue)
  }

  const logout = () => {
    void api.post('/auth/logout').catch(() => undefined)
    setAuth(initialState)
    setEmail(null)
    delete api.defaults.headers.common.Authorization
  }

  useEffect(() => {
    const refresh = async () => {
      try {
        const { data } = await api.post<TokenResponse>('/auth/refresh', {})
        setTokens(data)
      } catch {
        // Stay logged out when silent refresh is unavailable or expired.
      } finally {
        setIsLoading(false)
      }
    }

    refresh()
  }, [])

  return (
    <AuthContext.Provider value={{ ...auth, email, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
