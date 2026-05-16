import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './fix-scroll.css'
import App from './App.jsx'
import Toast from './Toast.jsx'
import ConfirmModal from './ConfirmModal.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <Toast />
    <ConfirmModal />
  </StrictMode>,
)
