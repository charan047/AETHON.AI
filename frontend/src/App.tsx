import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WsProvider } from './contexts/WebSocketContext'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Agents } from './pages/Agents'
import { Workflows } from './pages/Workflows'
import { Monitoring } from './pages/Monitoring'
import { Templates } from './pages/Templates'
import { WorkflowChat } from './pages/WorkflowChat'
import { Tools } from './pages/Tools'

export default function App() {
  return (
    <WsProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="agents" element={<Agents />} />
            <Route path="workflows" element={<Workflows />} />
            <Route path="monitoring" element={<Monitoring />} />
            <Route path="templates" element={<Templates />} />
            <Route path="chat/:workflowId" element={<WorkflowChat />} />
            <Route path="tools" element={<Tools />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </WsProvider>
  )
}
