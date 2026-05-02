import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ACTIVE_ORG_STORAGE_KEY, api, organizationsApi } from '../api/client'
import type { Organization } from '../types'

export interface AuthState {
  accessToken: string | null
  userId: string | null
  role: string | null
  isAuthenticated: boolean
}

interface AuthContextValue extends AuthState {
  email: string | null
  isLoading: boolean
  activeOrg: Organization | null
  userOrgs: Organization[]
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, fullName?: string) => Promise<void>
  logout: () => void
  switchOrg: (orgId: string) => void
  refreshOrganizations: (preferredOrgId?: string | null) => Promise<Organization[]>
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
const SESSION_HINT_STORAGE_KEY = 'ai-company-os-has-session'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [auth, setAuth] = useState<AuthState>(initialState)
  const [email, setEmail] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activeOrg, setActiveOrg] = useState<Organization | null>(null)
  const [userOrgs, setUserOrgs] = useState<Organization[]>([])

  const applyOrgHeader = (orgId: string | null) => {
    if (orgId) {
      api.defaults.headers.common['X-Org-Id'] = orgId
      localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId)
    } else {
      delete api.defaults.headers.common['X-Org-Id']
      localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY)
    }
  }

  const setTokens = (tokens: TokenResponse, nextEmail?: string) => {
    api.defaults.headers.common.Authorization = `Bearer ${tokens.access_token}`
    localStorage.setItem(SESSION_HINT_STORAGE_KEY, '1')
    setAuth({
      accessToken: tokens.access_token,
      userId: tokens.user_id,
      role: tokens.role,
      isAuthenticated: true,
    })
    setEmail(nextEmail || tokens.email || null)
  }

  const loadOrganizations = async (preferredOrgId?: string | null) => {
    const orgs = await organizationsApi.mine()
    setUserOrgs(orgs)
    const storedOrgId = preferredOrgId || localStorage.getItem(ACTIVE_ORG_STORAGE_KEY)
    const selected = orgs.find(org => org.id === storedOrgId) || orgs[0] || null
    setActiveOrg(selected)
    applyOrgHeader(selected?.id || null)
    return orgs
  }

  const login = async (emailValue: string, password: string) => {
    const { data } = await api.post<TokenResponse>('/auth/login', { email: emailValue, password })
    setTokens(data, emailValue)
    await loadOrganizations()
  }

  const register = async (emailValue: string, password: string, fullName?: string) => {
    const { data } = await api.post<TokenResponse>('/auth/register', {
      email: emailValue,
      password,
      full_name: fullName || undefined,
    })
    setTokens(data, emailValue)
    await loadOrganizations()
  }

  const logout = () => {
    void api.post('/auth/logout').catch(() => undefined)
    setAuth(initialState)
    setEmail(null)
    setActiveOrg(null)
    setUserOrgs([])
    delete api.defaults.headers.common.Authorization
    localStorage.removeItem(SESSION_HINT_STORAGE_KEY)
    applyOrgHeader(null)
    queryClient.clear()
  }

  const switchOrg = (orgId: string) => {
    const nextOrg = userOrgs.find(org => org.id === orgId)
    if (!nextOrg) return
    setActiveOrg(nextOrg)
    applyOrgHeader(nextOrg.id)
    void queryClient.invalidateQueries()
  }

  useEffect(() => {
    const refresh = async () => {
      if (!localStorage.getItem(SESSION_HINT_STORAGE_KEY)) {
        applyOrgHeader(null)
        setIsLoading(false)
        return
      }

      try {
        const { data } = await api.post<TokenResponse>('/auth/refresh', {})
        setTokens(data)
        await loadOrganizations()
      } catch {
        // Stay logged out when silent refresh is unavailable or expired.
        localStorage.removeItem(SESSION_HINT_STORAGE_KEY)
        applyOrgHeader(null)
      } finally {
        setIsLoading(false)
      }
    }

    refresh()
  }, [])

  return (
    <AuthContext.Provider value={{
      ...auth,
      email,
      isLoading,
      activeOrg,
      userOrgs,
      login,
      register,
      logout,
      switchOrg,
      refreshOrganizations: loadOrganizations,
    }}>
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
