import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(<App />)

Once these are in GitHub, go to the Vercel Dashboard, select "New Project," and import this repo. It will detect it as a **Vite** project and deploy it for you! 

**One Final Check:** Don't forget to add your Vercel link to the "Authorized JavaScript Origins" in your Google Cloud Console so the login works!
