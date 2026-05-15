import React, { useState, useEffect, useCallback } from 'react';
import {
  Mail, Send, PenSquare, LogOut, ArrowLeft, RefreshCw, AlertTriangle,
  Search, Star, Inbox, FileText, ChevronLeft, ChevronRight, Reply,
  Trash2, Archive, X, Check, Menu, Paperclip, Clock, Filter
} from 'lucide-react';

const CLIENT_ID = '277464695359-fvqp46kdkqjqvkv0ur0208t0uo349eas.apps.googleusercontent.com';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
].join(' ');

const PAGE_SIZE = 15;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decodeBase64(str) {
  try {
    return decodeURIComponent(
      atob(str.replace(/-/g, '+').replace(/_/g, '/'))
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  } catch {
    return '';
  }
}

function getEmailBody(payload) {
  if (!payload) return '';
  const findPart = (parts, mimeType) => {
    if (!parts) return null;
    for (const part of parts) {
      if (part.mimeType === mimeType && part.body?.data) return part.body.data;
      if (part.parts) {
        const found = findPart(part.parts, mimeType);
        if (found) return found;
      }
    }
    return null;
  };
  if (payload.mimeType === 'text/html' && payload.body?.data) return { html: decodeBase64(payload.body.data) };
  if (payload.mimeType === 'text/plain' && payload.body?.data) return { text: decodeBase64(payload.body.data) };
  const html = findPart(payload.parts, 'text/html');
  if (html) return { html: decodeBase64(html) };
  const text = findPart(payload.parts, 'text/plain');
  if (text) return { text: decodeBase64(text) };
  return { text: '' };
}

function getHeader(headers, name) {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function formatDate(internalDate) {
  if (!internalDate) return '';
  const d = new Date(parseInt(internalDate));
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isThisYear) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
}

function formatSender(from) {
  if (!from) return 'Unknown';
  const match = from.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : from.split('@')[0];
}

// ─── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`toast toast-${type}`}>
      {type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
      {message}
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ folder, setFolder, unreadCount, sidebarOpen, setSidebarOpen }) {
  const nav = [
    { id: 'inbox', label: 'Inbox', icon: Inbox, badge: unreadCount },
    { id: 'sent', label: 'Sent', icon: Send },
    { id: 'drafts', label: 'Drafts', icon: FileText },
    { id: 'starred', label: 'Starred', icon: Star },
  ];
  return (
    <>
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-icon"><Mail size={18} /></div>
          <span className="logo-text">NEOMAIL</span>
        </div>
        <nav className="sidebar-nav">
          {nav.map(({ id, label, icon: Icon, badge }) => (
            <button
              key={id}
              className={`nav-item ${folder === id ? 'nav-item-active' : ''}`}
              onClick={() => { setFolder(id); setSidebarOpen(false); }}
            >
              <Icon size={16} />
              <span>{label}</span>
              {badge > 0 && <span className="nav-badge">{badge > 99 ? '99+' : badge}</span>}
            </button>
          ))}
        </nav>
      </aside>
    </>
  );
}

// ─── Email List Item ───────────────────────────────────────────────────────────

function EmailRow({ email, onOpen, onStar, onDelete }) {
  const isUnread = email.labelIds?.includes('UNREAD');
  const isStarred = email.labelIds?.includes('STARRED');
  return (
    <div className={`email-row ${isUnread ? 'email-row-unread' : ''}`} onClick={() => onOpen(email)}>
      <button
        className={`star-btn ${isStarred ? 'star-active' : ''}`}
        onClick={e => { e.stopPropagation(); onStar(email); }}
      >
        <Star size={14} fill={isStarred ? 'currentColor' : 'none'} />
      </button>
      <div className="row-sender">{formatSender(email.from)}</div>
      <div className="row-subject-group">
        <span className="row-subject">{email.subject || '(No Subject)'}</span>
        <span className="row-snippet">{email.snippet}</span>
      </div>
      <div className="row-meta">
        <span className="row-date">{formatDate(email.internalDate)}</span>
        <button className="delete-btn" onClick={e => { e.stopPropagation(); onDelete(email); }}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Email Detail ──────────────────────────────────────────────────────────────

function EmailDetail({ email, onBack, onReply, onDelete, onStar }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [replySending, setReplySending] = useState(false);

  const body = getEmailBody(email.payload);
  const isStarred = email.labelIds?.includes('STARRED');

  const handleReply = async () => {
    if (!replyBody.trim()) return;
    setReplySending(true);
    await onReply(email, replyBody);
    setReplyBody('');
    setReplyOpen(false);
    setReplySending(false);
  };

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <button className="icon-btn" onClick={onBack}><ArrowLeft size={18} /></button>
        <div className="detail-actions">
          <button className={`icon-btn ${isStarred ? 'star-active' : ''}`} onClick={() => onStar(email)}>
            <Star size={16} fill={isStarred ? 'currentColor' : 'none'} />
          </button>
          <button className="icon-btn" onClick={() => setReplyOpen(r => !r)}>
            <Reply size={16} />
          </button>
          <button className="icon-btn danger-btn" onClick={() => onDelete(email)}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="detail-subject">{email.subject || '(No Subject)'}</div>

      <div className="detail-meta-row">
        <div className="detail-avatar">{formatSender(email.from)[0]?.toUpperCase()}</div>
        <div className="detail-from-block">
          <span className="detail-from-name">{formatSender(email.from)}</span>
          <span className="detail-from-addr">{email.from}</span>
        </div>
        <span className="detail-date">{formatDate(email.internalDate)}</span>
      </div>

      <div className="detail-body">
        {body.html ? (
          <iframe
            title="email-body"
            srcDoc={`<base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#111;padding:0;margin:0;word-wrap:break-word;}a{color:#0066ff}img{max-width:100%;height:auto}</style>${body.html}`}
            sandbox="allow-same-origin allow-popups"
            className="email-iframe"
            onLoad={e => {
              const doc = e.target.contentDocument;
              if (doc) {
                e.target.style.height = doc.documentElement.scrollHeight + 'px';
              }
            }}
          />
        ) : (
          <pre className="email-text">{body.text}</pre>
        )}
      </div>

      {replyOpen && (
        <div className="reply-box">
          <div className="reply-header">
            <Reply size={14} />
            <span>Reply to {formatSender(email.from)}</span>
            <button className="icon-btn ml-auto" onClick={() => setReplyOpen(false)}><X size={14} /></button>
          </div>
          <textarea
            className="reply-textarea"
            placeholder="Write your reply..."
            value={replyBody}
            onChange={e => setReplyBody(e.target.value)}
            rows={6}
            autoFocus
          />
          <div className="reply-footer">
            <button
              className="btn-primary"
              onClick={handleReply}
              disabled={replySending || !replyBody.trim()}
            >
              {replySending ? 'Sending...' : 'Send Reply'} <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Compose ───────────────────────────────────────────────────────────────────

function ComposePanel({ token, onBack, onToast }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!to || !subject || !body) { onToast('Fill out all fields.', 'error'); return; }
    setSending(true);
    try {
      const emailContent = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`;
      const encoded = btoa(unescape(encodeURIComponent(emailContent)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encoded }),
      });
      if (!res.ok) throw new Error();
      onToast('Email sent!', 'success');
      onBack();
    } catch {
      onToast('Failed to send.', 'error');
    }
    setSending(false);
  };

  return (
    <div className="compose-panel">
      <div className="compose-header">
        <button className="icon-btn" onClick={onBack}><ArrowLeft size={18} /></button>
        <h2 className="compose-title">New Message</h2>
      </div>
      <div className="compose-field">
        <label>To</label>
        <input type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="recipient@example.com" />
      </div>
      <div className="compose-field">
        <label>Subject</label>
        <input type="text" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" />
      </div>
      <div className="compose-field compose-body-field">
        <label>Message</label>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={14} placeholder="Write your message..." />
      </div>
      <div className="compose-footer">
        <button className="btn-primary" onClick={handleSend} disabled={sending}>
          {sending ? 'Sending...' : 'Send'} <Send size={14} />
        </button>
        <button className="btn-ghost" onClick={onBack}>Discard</button>
      </div>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [token, setToken] = useState(null);
  const [isGoogleLoaded, setIsGoogleLoaded] = useState(false);
  const [view, setView] = useState('login'); // login | inbox | detail | compose
  const [folder, setFolder] = useState('inbox');
  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [pageTokens, setPageTokens] = useState([null]); // stack, pageTokens[0]=first page
  const [currentPage, setCurrentPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toast, setToast] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (window.google) { setIsGoogleLoaded(true); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = () => setIsGoogleLoaded(true);
    script.async = true; script.defer = true;
    document.body.appendChild(script);
  }, []);

  const showToast = (message, type = 'success') => setToast({ message, type });

  const folderQuery = useCallback(() => {
    if (searchQuery) return searchQuery;
    switch (folder) {
      case 'sent': return 'in:sent';
      case 'drafts': return 'in:drafts';
      case 'starred': return 'is:starred';
      default: return 'in:inbox';
    }
  }, [folder, searchQuery]);

  const fetchEmails = useCallback(async (tok, pageToken = null, resetStack = true) => {
    if (!tok) return;
    setLoading(true);
    try {
      const q = folderQuery();
      let url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${PAGE_SIZE}&q=${encodeURIComponent(q)}`;
      if (pageToken) url += `&pageToken=${pageToken}`;

      const listRes = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
      const listData = await listRes.json();

      setHasNextPage(!!listData.nextPageToken);

      if (resetStack) {
        setPageTokens([null]);
        setCurrentPage(0);
      }
      if (listData.nextPageToken && resetStack) {
        setPageTokens([null, listData.nextPageToken]);
      } else if (listData.nextPageToken && !resetStack) {
        setPageTokens(prev => {
          const next = [...prev];
          if (!next[currentPage + 1]) next.push(listData.nextPageToken);
          return next;
        });
      }

      if (!listData.messages) { setEmails([]); setLoading(false); return; }

      const details = await Promise.all(
        listData.messages.map(msg =>
          fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`, {
            headers: { Authorization: `Bearer ${tok}` }
          }).then(r => r.json())
        )
      );

      setEmails(details.map(e => ({
        id: e.id,
        threadId: e.threadId,
        labelIds: e.labelIds || [],
        snippet: e.snippet,
        internalDate: e.internalDate,
        subject: getHeader(e.payload?.headers, 'Subject') || '(No Subject)',
        from: getHeader(e.payload?.headers, 'From') || 'Unknown',
        to: getHeader(e.payload?.headers, 'To') || '',
        payload: e.payload,
      })));

      // Unread count for inbox
      if (!searchQuery && folder === 'inbox') {
        const uc = details.filter(e => e.labelIds?.includes('UNREAD')).length;
        setUnreadCount(uc);
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to fetch emails.', 'error');
    }
    setLoading(false);
  }, [folderQuery, currentPage, folder, searchQuery]);

  useEffect(() => {
    if (token) { fetchEmails(token, null, true); }
  }, [folder, searchQuery, token]);

  const openEmail = async (email) => {
    // Fetch full message for body
    try {
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${email.id}?format=full`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const full = await res.json();
      setSelectedEmail({
        ...email,
        labelIds: full.labelIds || email.labelIds,
        payload: full.payload,
      });
      setView('detail');

      // Mark as read
      if (full.labelIds?.includes('UNREAD')) {
        await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${email.id}/modify`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
        });
        setEmails(prev => prev.map(e => e.id === email.id
          ? { ...e, labelIds: e.labelIds.filter(l => l !== 'UNREAD') }
          : e
        ));
        setUnreadCount(c => Math.max(0, c - 1));
      }
    } catch {
      showToast('Could not load email.', 'error');
    }
  };

  const handleStar = async (email) => {
    const isStarred = email.labelIds?.includes('STARRED');
    const body = isStarred
      ? { removeLabelIds: ['STARRED'] }
      : { addLabelIds: ['STARRED'] };
    try {
      await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${email.id}/modify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const update = e => e.id === email.id
        ? { ...e, labelIds: isStarred ? e.labelIds.filter(l => l !== 'STARRED') : [...e.labelIds, 'STARRED'] }
        : e;
      setEmails(prev => prev.map(update));
      if (selectedEmail?.id === email.id) setSelectedEmail(update(selectedEmail));
      showToast(isStarred ? 'Unstarred' : 'Starred!', 'success');
    } catch { showToast('Action failed.', 'error'); }
  };

  const handleDelete = async (email) => {
    try {
      await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${email.id}/trash`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setEmails(prev => prev.filter(e => e.id !== email.id));
      if (view === 'detail') setView('inbox');
      showToast('Moved to trash.', 'success');
    } catch { showToast('Could not delete.', 'error'); }
  };

  const handleReply = async (email, body) => {
    const to = email.from;
    const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
    const emailContent = `To: ${to}\r\nSubject: ${subject}\r\nIn-Reply-To: ${email.id}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`;
    const encoded = btoa(unescape(encodeURIComponent(emailContent)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: encoded, threadId: email.threadId }),
    });
    if (!res.ok) throw new Error();
    showToast('Reply sent!', 'success');
  };

  const handleNextPage = () => {
    const nextToken = pageTokens[currentPage + 1];
    if (!nextToken) return;
    const next = currentPage + 1;
    setCurrentPage(next);
    fetchEmails(token, nextToken, false);
  };

  const handlePrevPage = () => {
    if (currentPage === 0) return;
    const prev = currentPage - 1;
    setCurrentPage(prev);
    fetchEmails(token, pageTokens[prev], false);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setSearchQuery(searchInput.trim());
  };

  const clearSearch = () => { setSearchQuery(''); setSearchInput(''); };

  const handleLogin = () => {
    if (!isGoogleLoaded) return;
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) { showToast('Login failed.', 'error'); return; }
        setToken(response.access_token);
        setView('inbox');
      },
    });
    client.requestAccessToken();
  };

  const handleLogout = () => {
    if (token) window.google.accounts.oauth2.revoke(token, () => {});
    setToken(null); setView('login'); setEmails([]);
  };

  // ── Login Screen ────────────────────────────────────────────────────────────

  if (view === 'login') {
    return (
      <>
        <style>{CSS}</style>
        <div className="login-screen">
          <div className="login-card">
            <div className="login-badge">
              <Mail size={32} />
            </div>
            <h1 className="login-title">NeoMail</h1>
            <p className="login-sub">Your inbox, reimagined.</p>
            <button className="login-btn" onClick={handleLogin} disabled={!isGoogleLoaded}>
              <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
                <path d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </button>
          </div>
        </div>
        {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      </>
    );
  }

  // ── App Shell ───────────────────────────────────────────────────────────────

  return (
    <>
      <style>{CSS}</style>
      <div className="app-shell">
        <Sidebar
          folder={folder}
          setFolder={(f) => { setFolder(f); setView('inbox'); setSelectedEmail(null); }}
          unreadCount={unreadCount}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
        />

        <div className="main-col">
          {/* Topbar */}
          <header className="topbar">
            <button className="icon-btn mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
              <Menu size={20} />
            </button>
            <form className="search-form" onSubmit={handleSearch}>
              <Search size={15} className="search-icon" />
              <input
                className="search-input"
                placeholder="Search mail..."
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
              />
              {searchQuery && (
                <button type="button" className="search-clear" onClick={clearSearch}><X size={13} /></button>
              )}
            </form>
            <div className="topbar-actions">
              <button
                className="btn-compose"
                onClick={() => setView('compose')}
              >
                <PenSquare size={15} /> Compose
              </button>
              <button className="icon-btn" onClick={handleLogout} title="Sign out">
                <LogOut size={17} />
              </button>
            </div>
          </header>

          {/* Content */}
          <div className="content-area">
            {view === 'detail' && selectedEmail && (
              <EmailDetail
                email={selectedEmail}
                onBack={() => setView('inbox')}
                onReply={handleReply}
                onDelete={handleDelete}
                onStar={handleStar}
              />
            )}

            {view === 'compose' && (
              <ComposePanel token={token} onBack={() => setView('inbox')} onToast={showToast} />
            )}

            {(view === 'inbox' || view === 'login') && view !== 'detail' && view !== 'compose' && (
              <div className="list-panel">
                <div className="list-toolbar">
                  <div className="list-folder-title">
                    {searchQuery
                      ? <><Search size={16} /> Results for "{searchQuery}"</>
                      : folder.charAt(0).toUpperCase() + folder.slice(1)
                    }
                  </div>
                  <div className="list-toolbar-right">
                    <span className="page-indicator">
                      Page {currentPage + 1}
                    </span>
                    <button className="icon-btn" onClick={() => fetchEmails(token, null, true)} disabled={loading} title="Refresh">
                      <RefreshCw size={15} className={loading ? 'spin' : ''} />
                    </button>
                  </div>
                </div>

                {loading ? (
                  <div className="loading-state">
                    <div className="loading-rows">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="skeleton-row" style={{ animationDelay: `${i * 60}ms` }} />
                      ))}
                    </div>
                  </div>
                ) : emails.length === 0 ? (
                  <div className="empty-state">
                    <Mail size={40} strokeWidth={1} />
                    <span>No emails found</span>
                  </div>
                ) : (
                  <div className="email-list">
                    {emails.map(email => (
                      <EmailRow
                        key={email.id}
                        email={email}
                        onOpen={openEmail}
                        onStar={handleStar}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                )}

                <div className="pagination">
                  <button
                    className="page-btn"
                    onClick={handlePrevPage}
                    disabled={currentPage === 0 || loading}
                  >
                    <ChevronLeft size={16} /> Prev
                  </button>
                  <button
                    className="page-btn"
                    onClick={handleNextPage}
                    disabled={!hasNextPage || loading}
                  >
                    Next <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </>
  );
}

// ─── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@400;500;600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #f5f5f0;
    --surface: #ffffff;
    --border: #111111;
    --border-light: #e0e0d8;
    --text: #111111;
    --text-2: #555550;
    --text-3: #999990;
    --accent: #0052ff;
    --accent-hover: #0040cc;
    --accent-soft: #e8efff;
    --warn: #ff3b30;
    --star: #f5a623;
    --green: #00b37e;
    --mono: 'Space Mono', monospace;
    --sans: 'DM Sans', sans-serif;
    --sidebar-w: 210px;
    --topbar-h: 56px;
    --radius: 4px;
    --shadow: 3px 3px 0px #111;
    --shadow-lg: 5px 5px 0px #111;
  }

  body { background: var(--bg); color: var(--text); font-family: var(--sans); }

  /* ── Login ── */
  .login-screen {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: var(--bg);
    background-image: repeating-linear-gradient(0deg, transparent, transparent 39px, var(--border-light) 40px),
                      repeating-linear-gradient(90deg, transparent, transparent 39px, var(--border-light) 40px);
  }
  .login-card {
    background: var(--surface); border: 2px solid var(--border);
    box-shadow: var(--shadow-lg); padding: 48px 40px; text-align: center;
    width: 360px; display: flex; flex-direction: column; align-items: center; gap: 12px;
  }
  .login-badge {
    width: 64px; height: 64px; background: var(--accent); border: 2px solid var(--border);
    display: flex; align-items: center; justify-content: center; color: white;
    box-shadow: var(--shadow); margin-bottom: 8px;
  }
  .login-title {
    font-family: var(--mono); font-size: 28px; font-weight: 700; letter-spacing: -0.5px;
  }
  .login-sub { color: var(--text-2); font-size: 14px; margin-bottom: 8px; }
  .login-btn {
    margin-top: 16px; width: 100%; display: flex; align-items: center; justify-content: center;
    gap: 10px; padding: 12px 20px; background: var(--surface); border: 2px solid var(--border);
    box-shadow: var(--shadow); font-family: var(--sans); font-size: 15px; font-weight: 600;
    cursor: pointer; transition: transform 80ms, box-shadow 80ms;
  }
  .login-btn:hover { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--border); }
  .login-btn:disabled { opacity: 0.5; pointer-events: none; }

  /* ── App Shell ── */
  .app-shell {
    display: flex; height: 100vh; overflow: hidden;
  }

  /* ── Sidebar ── */
  .sidebar {
    width: var(--sidebar-w); min-width: var(--sidebar-w); height: 100vh;
    background: var(--surface); border-right: 2px solid var(--border);
    display: flex; flex-direction: column; flex-shrink: 0; z-index: 100;
  }
  .sidebar-logo {
    display: flex; align-items: center; gap: 10px;
    padding: 18px 16px; border-bottom: 2px solid var(--border);
  }
  .logo-icon {
    width: 32px; height: 32px; background: var(--accent); display: flex; align-items: center;
    justify-content: center; color: white; border: 1.5px solid var(--border); flex-shrink: 0;
  }
  .logo-text { font-family: var(--mono); font-size: 14px; font-weight: 700; letter-spacing: 1px; }
  .sidebar-nav { padding: 8px; display: flex; flex-direction: column; gap: 2px; }
  .nav-item {
    display: flex; align-items: center; gap: 10px; padding: 9px 12px;
    border-radius: var(--radius); cursor: pointer; border: 1.5px solid transparent;
    background: none; font-family: var(--sans); font-size: 14px; font-weight: 500;
    color: var(--text-2); text-align: left; transition: all 80ms;
  }
  .nav-item:hover { background: var(--bg); color: var(--text); border-color: var(--border-light); }
  .nav-item-active {
    background: var(--accent-soft); color: var(--accent); border-color: var(--accent) !important;
    font-weight: 600;
  }
  .nav-badge {
    margin-left: auto; background: var(--accent); color: white; border-radius: 10px;
    font-size: 11px; font-family: var(--mono); padding: 1px 6px; min-width: 20px; text-align: center;
  }
  .sidebar-overlay {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 99;
  }

  /* ── Main Column ── */
  .main-col {
    flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden;
  }

  /* ── Topbar ── */
  .topbar {
    height: var(--topbar-h); border-bottom: 2px solid var(--border);
    display: flex; align-items: center; gap: 12px; padding: 0 16px;
    background: var(--surface); flex-shrink: 0;
  }
  .mobile-menu-btn { display: none; }
  .search-form {
    flex: 1; max-width: 520px; position: relative; display: flex; align-items: center;
  }
  .search-icon { position: absolute; left: 10px; color: var(--text-3); pointer-events: none; }
  .search-input {
    width: 100%; padding: 8px 12px 8px 34px; border: 1.5px solid var(--border-light);
    border-radius: var(--radius); background: var(--bg); font-family: var(--sans);
    font-size: 14px; color: var(--text); outline: none; transition: border-color 100ms;
  }
  .search-input:focus { border-color: var(--border); background: var(--surface); }
  .search-clear {
    position: absolute; right: 8px; background: none; border: none; cursor: pointer;
    color: var(--text-3); display: flex; align-items: center;
  }
  .topbar-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .btn-compose {
    display: flex; align-items: center; gap: 6px; padding: 8px 16px;
    background: var(--accent); color: white; border: 2px solid var(--border);
    box-shadow: var(--shadow); font-family: var(--sans); font-size: 14px; font-weight: 600;
    cursor: pointer; transition: transform 80ms, box-shadow 80ms;
  }
  .btn-compose:hover { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--border); }

  /* ── Icon Btn ── */
  .icon-btn {
    width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
    background: none; border: 1.5px solid transparent; border-radius: var(--radius);
    cursor: pointer; color: var(--text-2); transition: all 80ms;
  }
  .icon-btn:hover { background: var(--bg); border-color: var(--border-light); color: var(--text); }
  .star-active { color: var(--star) !important; }
  .danger-btn:hover { color: var(--warn) !important; background: #fff0ef !important; }

  /* ── Content Area ── */
  .content-area {
    flex: 1; overflow-y: auto; background: var(--bg);
  }

  /* ── List Panel ── */
  .list-panel { display: flex; flex-direction: column; height: 100%; }
  .list-toolbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; background: var(--surface); border-bottom: 2px solid var(--border);
    position: sticky; top: 0; z-index: 5;
  }
  .list-folder-title {
    font-family: var(--mono); font-size: 14px; font-weight: 700;
    display: flex; align-items: center; gap: 8px;
  }
  .list-toolbar-right { display: flex; align-items: center; gap: 8px; }
  .page-indicator { font-family: var(--mono); font-size: 12px; color: var(--text-3); }

  /* ── Email List ── */
  .email-list { display: flex; flex-direction: column; }
  .email-row {
    display: flex; align-items: center; gap: 12px; padding: 12px 16px;
    background: var(--surface); border-bottom: 1px solid var(--border-light);
    cursor: pointer; transition: background 80ms;
  }
  .email-row:hover { background: var(--bg); }
  .email-row-unread { background: var(--surface); }
  .email-row-unread .row-sender,
  .email-row-unread .row-subject { font-weight: 700 !important; }
  .star-btn {
    flex-shrink: 0; width: 28px; height: 28px; background: none; border: none;
    cursor: pointer; color: var(--text-3); display: flex; align-items: center; justify-content: center;
    transition: color 80ms;
  }
  .star-btn:hover { color: var(--star); }
  .row-sender {
    width: 160px; min-width: 160px; font-size: 14px; font-weight: 500; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0;
  }
  .row-subject-group {
    flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px;
  }
  .row-subject {
    font-size: 14px; color: var(--text); white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; flex-shrink: 0; max-width: 260px;
  }
  .row-snippet {
    font-size: 13px; color: var(--text-3); white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; flex: 1;
  }
  .row-meta {
    display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin-left: auto;
  }
  .row-date {
    font-family: var(--mono); font-size: 12px; color: var(--text-3); white-space: nowrap;
  }
  .delete-btn {
    width: 24px; height: 24px; background: none; border: none; cursor: pointer;
    color: var(--text-3); opacity: 0; display: flex; align-items: center; justify-content: center;
    transition: opacity 80ms, color 80ms;
  }
  .email-row:hover .delete-btn { opacity: 1; }
  .delete-btn:hover { color: var(--warn); }

  /* ── Skeleton ── */
  .loading-state { padding: 0; }
  .skeleton-row {
    height: 57px; background: linear-gradient(90deg, #eee 25%, #f5f5f0 50%, #eee 75%);
    background-size: 200% 100%; animation: shimmer 1.2s infinite; border-bottom: 1px solid var(--border-light);
  }
  @keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }

  /* ── Empty ── */
  .empty-state {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 12px; padding: 80px 20px; color: var(--text-3); font-size: 15px;
  }

  /* ── Pagination ── */
  .pagination {
    display: flex; gap: 8px; padding: 16px; border-top: 2px solid var(--border);
    background: var(--surface); justify-content: center; margin-top: auto;
    position: sticky; bottom: 0;
  }
  .page-btn {
    display: flex; align-items: center; gap: 6px; padding: 8px 16px;
    background: var(--surface); border: 2px solid var(--border); box-shadow: var(--shadow);
    font-family: var(--sans); font-size: 14px; font-weight: 600; cursor: pointer;
    transition: transform 80ms, box-shadow 80ms;
  }
  .page-btn:hover:not(:disabled) { transform: translate(2px,2px); box-shadow: 1px 1px 0 var(--border); }
  .page-btn:disabled { opacity: 0.35; pointer-events: none; }

  /* ── Detail Panel ── */
  .detail-panel {
    max-width: 800px; margin: 0 auto; padding: 0 0 80px;
    background: var(--surface); min-height: 100%;
  }
  .detail-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 20px; border-bottom: 2px solid var(--border);
    position: sticky; top: 0; background: var(--surface); z-index: 5;
  }
  .detail-actions { display: flex; gap: 4px; }
  .detail-subject {
    font-size: 22px; font-weight: 700; padding: 20px 20px 16px; line-height: 1.3;
  }
  .detail-meta-row {
    display: flex; align-items: center; gap: 12px;
    padding: 0 20px 16px; border-bottom: 1px solid var(--border-light);
  }
  .detail-avatar {
    width: 36px; height: 36px; background: var(--accent); color: white; border: 1.5px solid var(--border);
    display: flex; align-items: center; justify-content: center; font-family: var(--mono);
    font-size: 14px; font-weight: 700; flex-shrink: 0;
  }
  .detail-from-block { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .detail-from-name { font-size: 14px; font-weight: 600; }
  .detail-from-addr { font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .detail-date { font-family: var(--mono); font-size: 12px; color: var(--text-3); flex-shrink: 0; }
  .detail-body { padding: 24px 20px; }
  .email-iframe { width: 100%; border: none; display: block; min-height: 200px; }
  .email-text { white-space: pre-wrap; font-family: var(--mono); font-size: 13px; line-height: 1.7; color: var(--text); }

  /* ── Reply ── */
  .reply-box {
    margin: 0 20px 24px; border: 2px solid var(--border); box-shadow: var(--shadow);
    background: var(--surface);
  }
  .reply-header {
    display: flex; align-items: center; gap: 8px; padding: 10px 14px;
    border-bottom: 2px solid var(--border); font-size: 13px; font-weight: 600;
    background: var(--bg);
  }
  .ml-auto { margin-left: auto; }
  .reply-textarea {
    width: 100%; padding: 14px; border: none; outline: none; resize: vertical;
    font-family: var(--sans); font-size: 14px; line-height: 1.6; background: var(--surface);
  }
  .reply-footer {
    padding: 10px 14px; border-top: 1px solid var(--border-light); background: var(--bg);
  }

  /* ── Compose Panel ── */
  .compose-panel {
    max-width: 720px; margin: 0 auto; padding: 0; background: var(--surface); min-height: 100%;
  }
  .compose-header {
    display: flex; align-items: center; gap: 14px; padding: 14px 20px;
    border-bottom: 2px solid var(--border); position: sticky; top: 0;
    background: var(--surface); z-index: 5;
  }
  .compose-title { font-family: var(--mono); font-size: 16px; font-weight: 700; }
  .compose-field {
    display: flex; flex-direction: column; gap: 6px; padding: 14px 20px;
    border-bottom: 1px solid var(--border-light);
  }
  .compose-field label { font-size: 12px; font-weight: 700; font-family: var(--mono); color: var(--text-2); letter-spacing: 0.5px; }
  .compose-field input, .compose-field textarea {
    border: 1.5px solid var(--border-light); background: var(--bg); border-radius: var(--radius);
    padding: 9px 12px; font-family: var(--sans); font-size: 14px; color: var(--text); outline: none;
    transition: border-color 100ms;
  }
  .compose-field input:focus, .compose-field textarea:focus { border-color: var(--border); background: var(--surface); }
  .compose-body-field { flex: 1; }
  .compose-body-field textarea { resize: none; flex: 1; }
  .compose-footer {
    display: flex; gap: 10px; align-items: center; padding: 14px 20px;
    border-top: 2px solid var(--border); background: var(--surface);
    position: sticky; bottom: 0;
  }

  /* ── Buttons ── */
  .btn-primary {
    display: flex; align-items: center; gap: 6px; padding: 9px 18px;
    background: var(--accent); color: white; border: 2px solid var(--border);
    box-shadow: var(--shadow); font-family: var(--sans); font-size: 14px; font-weight: 600;
    cursor: pointer; transition: transform 80ms, box-shadow 80ms;
  }
  .btn-primary:hover:not(:disabled) { transform: translate(2px,2px); box-shadow: 1px 1px 0 var(--border); }
  .btn-primary:disabled { opacity: 0.4; pointer-events: none; }
  .btn-ghost {
    display: flex; align-items: center; gap: 6px; padding: 9px 16px;
    background: none; color: var(--text-2); border: 2px solid var(--border-light);
    font-family: var(--sans); font-size: 14px; font-weight: 500; cursor: pointer;
    border-radius: var(--radius);
  }
  .btn-ghost:hover { border-color: var(--border); color: var(--text); }

  /* ── Toast ── */
  .toast {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: var(--text); color: white; padding: 10px 18px;
    display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500;
    border: 2px solid var(--border); box-shadow: var(--shadow-lg); z-index: 9999;
    animation: slideUp 200ms ease;
  }
  .toast-success { background: #111; }
  .toast-error { background: var(--warn); }
  @keyframes slideUp { from { opacity: 0; transform: translateX(-50%) translateY(10px); } }

  /* ── Spin ── */
  .spin { animation: spin 700ms linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Responsive ── */
  @media (max-width: 700px) {
    :root { --sidebar-w: 240px; }
    .sidebar {
      position: fixed; left: 0; top: 0; transform: translateX(-100%);
      transition: transform 200ms ease;
    }
    .sidebar-open { transform: translateX(0); }
    .sidebar-overlay { display: block; }
    .mobile-menu-btn { display: flex; }
    .row-sender { width: 110px; min-width: 110px; }
    .row-snippet { display: none; }
    .btn-compose span { display: none; }
    .btn-compose { padding: 8px 10px; }
    .detail-subject { font-size: 18px; }
  }
`;
