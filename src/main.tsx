import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { HelpTopicProvider } from './lib/help'
import './global.css'
import { applySavedAppearance } from './lib/theme'

// Light or dark before the first paint (the account's choice is applied
// again once the profile loads).
applySavedAppearance()
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><HelpTopicProvider><App /></HelpTopicProvider></React.StrictMode>
)
