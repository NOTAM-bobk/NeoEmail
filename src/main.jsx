import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// This is the entry point that connects our App component to the index.html file
// We removed the .jsx extension from the import to help the bundler resolve the file path correctly
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
