import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { HelpTopicProvider } from './lib/help'
import './global.css'
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><HelpTopicProvider><App /></HelpTopicProvider></React.StrictMode>
)
