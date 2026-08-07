import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import Auditoria from './pages/Auditoria'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/auditoria" element={<Auditoria />} />
    </Routes>
  )
}
