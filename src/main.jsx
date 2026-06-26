import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import MMLPlanner from './MMLPlanner.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MMLPlanner />
  </StrictMode>,
)
