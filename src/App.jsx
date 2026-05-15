import React, { useState, useEffect } from 'react';
import { Mail, Send, PenSquare, LogOut, ArrowLeft, RefreshCw, AlertTriangle } from 'lucide-react';

// Using the provided Client ID
const CLIENT_ID = '277464695359-fvqp46kdkqjqvkv0ur0208t0uo349eas.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';

export default function App() {
  const [token, setToken] = useState(null);
  const [isGoogleLoaded, setIsGoogleLoaded] = useState(false);
  const [view, setView] = useState('login'); // 'login', 'inbox', 'compose'
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Compose State
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  // Load Google Identity Services Script
  useEffect(() => {
    if (window.google) {
      setIsGoogleLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = () => setIsGoogleLoaded(true);
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  }, []);

  const handleLogin = () => {
    if (!isGoogleLoaded) return;
    
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) {
          setError('Login failed. Ensure Authorized JavaScript Origins is set in Google Cloud Console.');
          return;
        }
        setToken(response.access_token);
        setView('inbox');
        fetchEmails(response.access_token);
      },
    });
    client.requestAccessToken();
  };

  const handleLogout = () => {
    if (token) {
      // Revoke token
      window.google.accounts.oauth2.revoke(token, () => {
        setToken(null);
        setView('login');
        setEmails([]);
      });
    } else {
      setToken(null);
      setView('login');
    }
  };

  const fetchEmails = async (currentToken) => {
    setLoading(true);
    setError('');
    try {
      // 1. Fetch list of message IDs
      const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10', {
        headers: { Authorization: `Bearer ${currentToken}` }
      });
      const listData = await listRes.json();

      if (!listData.messages) {
        setEmails([]);
        setLoading(false);
        return;
      }

      // 2. Fetch details for each message
      const emailDetailsPromises = listData.messages.map(async (msg) => {
        const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`, {
          headers: { Authorization: `Bearer ${currentToken}` }
        });
        return await msgRes.json();
      });

      const fullEmails = await Promise.all(emailDetailsPromises);
      
      // 3. Format the data for our UI
      const formattedEmails = fullEmails.map(email => {
        const headers = email.payload.headers;
        const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject');
        const fromHeader = headers.find(h => h.name.toLowerCase() === 'from');
        
        return {
          id: email.id,
          snippet: email.snippet,
          subject: subjectHeader ? subjectHeader.value : '(No Subject)',
          from: fromHeader ? fromHeader.value : 'Unknown Sender',
        };
      });

      setEmails(formattedEmails);
    } catch (err) {
      console.error(err);
      setError('Failed to fetch emails. Token may have expired.');
    }
    setLoading(false);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!to || !subject || !body) {
      setError('Please fill out all fields.');
      return;
    }
    setSending(true);
    setError('');

    try {
      // Format as RFC 2822 message
      const emailContent = `To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`;
      
      // Base64Url encode it
      const encodedEmail = btoa(unescape(encodeURIComponent(emailContent)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw: encodedEmail })
      });

      if (!res.ok) throw new Error('Send failed');

      // Clear form and go back to inbox
      setTo('');
      setSubject('');
      setBody('');
      setView('inbox');
      fetchEmails(token);
    } catch (err) {
      console.error(err);
      setError('Failed to send email.');
    }
    setSending(false);
  };

  // --- UI COMPONENTS ---

  if (view === 'login') {
    return (
      <div className="min-h-screen bg-[#f4f4f0] flex flex-col items-center justify-center p-6 font-sans">
        <div className="max-w-md w-full bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-8 flex flex-col items-center text-center">
          <div className="bg-[#ff90e8] p-4 border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded-full mb-6">
            <Mail size={48} className="text-black" />
          </div>
          <h1 className="text-4xl font-black uppercase mb-2 tracking-tight text-black">NeoMail</h1>
          <p className="text-lg font-bold text-gray-700 mb-8 border-b-4 border-black pb-4 inline-block">
            Connect your Gmail.
          </p>
          
          {error && (
            <div className="bg-[#ff6b6b] border-4 border-black p-4 w-full mb-6 flex items-start text-left font-bold">
              <AlertTriangle className="mr-2 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={!isGoogleLoaded}
            className="w-full bg-[#fcd53f] hover:bg-[#ffeb85] border-4 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-1 hover:translate-x-1 transition-all py-4 px-6 text-xl font-black uppercase flex items-center justify-center gap-3 disabled:opacity-50"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f4f0] font-sans text-black selection:bg-[#ff90e8]">
      {/* Header */}
      <header className="bg-white border-b-4 border-black p-4 sticky top-0 z-10 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="bg-[#23a094] p-2 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
            <Mail className="text-white" size={24} />
          </div>
          <h1 className="text-2xl font-black uppercase tracking-tighter">NeoMail</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setView('compose')}
            className="hidden sm:flex bg-[#ff90e8] hover:bg-[#ffb3f0] border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] transition-all px-4 py-2 font-bold flex items-center gap-2"
          >
            <PenSquare size={18} /> Compose
          </button>
          <button 
            onClick={handleLogout}
            className="bg-white hover:bg-gray-100 border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] transition-all px-3 py-2 font-bold flex items-center gap-2"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8">
        
        {error && (
          <div className="bg-[#ff6b6b] border-4 border-black p-4 mb-6 font-bold flex items-center gap-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <AlertTriangle size={24} />
            {error}
          </div>
        )}

        {/* INBOX VIEW */}
        {view === 'inbox' && (
          <div className="space-y-6">
            <div className="flex justify-between items-end border-b-4 border-black pb-4">
              <h2 className="text-4xl font-black uppercase">Inbox</h2>
              <button 
                onClick={() => fetchEmails(token)}
                className="bg-[#90b8ff] hover:bg-[#b3cdff] border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:translate-x-[2px] transition-all p-2 font-bold"
              >
                <RefreshCw size={24} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>

            {loading ? (
              <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-12 text-center font-bold text-xl animate-pulse">
                LOADING MAILS...
              </div>
            ) : emails.length === 0 ? (
              <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-12 text-center font-bold text-xl">
                NO RECENT EMAILS FOUND.
              </div>
            ) : (
              <div className="space-y-4">
                {emails.map((email) => (
                  <div key={email.id} className="bg-white border-4 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-shadow p-4 flex flex-col sm:flex-row gap-4">
                    <div className="sm:w-1/3 truncate font-bold bg-[#fcd53f] border-2 border-black px-2 py-1 self-start">
                      {email.from.split('<')[0].replace(/"/g, '')}
                    </div>
                    <div className="sm:w-2/3 flex flex-col">
                      <span className="font-black text-lg truncate mb-1">{email.subject}</span>
                      <span className="text-sm font-medium text-gray-700 line-clamp-2">{email.snippet}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Mobile Floating Action Button */}
            <button 
              onClick={() => setView('compose')}
              className="sm:hidden fixed bottom-6 right-6 bg-[#ff90e8] border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 rounded-full"
            >
              <PenSquare size={24} />
            </button>
          </div>
        )}

        {/* COMPOSE VIEW */}
        {view === 'compose' && (
          <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-6">
            <div className="flex items-center gap-4 border-b-4 border-black pb-4 mb-6">
              <button 
                onClick={() => setView('inbox')}
                className="bg-white hover:bg-gray-100 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] p-2"
              >
                <ArrowLeft size={24} />
              </button>
              <h2 className="text-3xl font-black uppercase">New Message</h2>
            </div>

            <form onSubmit={handleSend} className="space-y-6">
              <div className="flex flex-col gap-2">
                <label className="font-black text-lg uppercase">To:</label>
                <input 
                  type="email" 
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full bg-[#f4f4f0] border-4 border-black p-3 font-bold focus:outline-none focus:bg-[#fcd53f] transition-colors"
                  placeholder="friend@gmail.com"
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-black text-lg uppercase">Subject:</label>
                <input 
                  type="text" 
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full bg-[#f4f4f0] border-4 border-black p-3 font-bold focus:outline-none focus:bg-[#fcd53f] transition-colors"
                  placeholder="What's up?"
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-black text-lg uppercase">Message:</label>
                <textarea 
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows="8"
                  className="w-full bg-[#f4f4f0] border-4 border-black p-3 font-bold focus:outline-none focus:bg-[#ff90e8] transition-colors resize-y"
                  placeholder="Type your message here..."
                  required
                ></textarea>
              </div>

              <button 
                type="submit"
                disabled={sending}
                className="w-full sm:w-auto bg-[#23a094] hover:bg-[#2bc4b6] text-white border-4 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-1 hover:translate-x-1 transition-all py-4 px-8 text-xl font-black uppercase flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? 'Sending...' : 'Send Email'} <Send size={24} />
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
