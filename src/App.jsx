import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Mail, Send, PenSquare, LogOut, ArrowLeft, RefreshCw, AlertTriangle,
  Search, Star, Inbox, FileText, ChevronLeft, ChevronRight, Reply,
  Trash2, X, Check, Menu, Archive, Eye, EyeOff, Forward, Zap
} from 'lucide-react';

// ─── Config ────────────────────────────────────────────────────────────────────

const CLIENT_ID = '277464695359-fvqp46kdkqjqvkv0ur0208t0uo349eas.apps.googleusercontent.com';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://mail.google.com/',
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

const PAGE_SIZE = 20;
const TOKEN_COOKIE = 'neomail_token';
const USER_COOKIE = 'neomail_user';

// ─── Cookie Helpers ─────────────────────────────────────────────────────────────

function setCookie(name, value, hours = 1) {
  const exp = new Date(Date.now() + hours * 3600000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${exp};path=/;SameSite=Strict`;
}
function getCookie(name) {
  const m = document.cookie.split(';').find(c => c.trim().startsWith(name + '='));
  return m ? decodeURIComponent(m.trim().slice(name.length + 1)) : null;
}
function deleteCookie(name) {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`;
}

// ─── Gmail Helpers ──────────────────────────────────────────────────────────────

function decodeB64(str) {
  if (!str) return '';
  try {
    return decodeURIComponent(
      atob(str.replace(/-/g, '+').replace(/_/g, '/'))
        .split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
  } catch { return ''; }
}

function getBody(payload) {
  if (!payload) return { text: '' };
  const find = (parts, type) => {
    if (!parts) return null;
    for (const p of parts) {
      if (p.mimeType === type && p.body?.data) return p.body.data;
      if (p.parts) { const f = find(p.parts, type); if (f) return f; }
    }
    return null;
  };
  if (payload.mimeType === 'text/html' && payload.body?.data) return { html: decodeB64(payload.body.data) };
  if (payload.mimeType === 'text/plain' && payload.body?.data) return { text: decodeB64(payload.body.data) };
  const h = find(payload.parts, 'text/html');
  if (h) return { html: decodeB64(h) };
  const t = find(payload.parts, 'text/plain');
  if (t) return { text: decodeB64(t) };
  return { text: '' };
}

function hdr(headers, name) {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(parseInt(ts)), now = new Date(), diff = now - d;
  if (diff < 86400000 && d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? '2-digit' : undefined }).replace(/ undefined/, '');
}

function fmtSender(from) {
  if (!from) return '?';
  const m = from.match(/^"?([^"<]+)"?\s*</);
  return m ? m[1].trim() : from.split('@')[0];
}

function encodeRaw(content) {
  return btoa(unescape(encodeURIComponent(content)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── API Class ──────────────────────────────────────────────────────────────────

class Gmail {
  constructor(tok) { this.tok = tok; }
  async req(path, opts = {}) {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${this.tok}`, 'Content-Type': 'application/json', ...opts.headers },
    });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  }
  list(q, pt) {
    let u = `/users/me/messages?maxResults=${PAGE_SIZE}&q=${encodeURIComponent(q)}`;
    if (pt) u += `&pageToken=${pt}`;
    return this.req(u);
  }
  getMeta(id) {
    return this.req(`/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date&metadataHeaders=Cc`);
  }
  getFull(id) { return this.req(`/users/me/messages/${id}?format=full`); }
  modify(id, body) { return this.req(`/users/me/messages/${id}/modify`, { method: 'POST', body: JSON.stringify(body) }); }
  trash(id) { return this.req(`/users/me/messages/${id}/trash`, { method: 'POST' }); }
  send(raw, threadId) {
    const body = { raw };
    if (threadId) body.threadId = threadId;
    return this.req('/users/me/messages/send', { method: 'POST', body: JSON.stringify(body) });
  }
  profile() { return this.req('/users/me/profile'); }
}

// ─── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`toast toast-${type}`}>
      {type === 'success' ? <Check size={13} /> : <AlertTriangle size={13} />}
      {message}
    </div>
  );
}

// ─── Folders ────────────────────────────────────────────────────────────────────

const FOLDERS = [
  { id: 'inbox',   label: 'Inbox',   icon: Inbox,    q: 'in:inbox' },
  { id: 'starred', label: 'Starred', icon: Star,     q: 'is:starred' },
  { id: 'sent',    label: 'Sent',    icon: Send,     q: 'in:sent' },
  { id: 'drafts',  label: 'Drafts',  icon: FileText, q: 'in:drafts' },
  { id: 'archive', label: 'Archive', icon: Archive,  q: 'in:archive' },
  { id: 'trash',   label: 'Trash',   icon: Trash2,   q: 'in:trash' },
];

// ─── Sidebar ────────────────────────────────────────────────────────────────────

function Sidebar({ folder, setFolder, unread, open, onClose, onCompose, onLogout, userEmail }) {
  return (
    <>
      {open && <div className="overlay" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sb-head">
          <div className="sb-logo">
            <img src="mail.png" alt="" className="sb-img" onError={e => e.target.style.display='none'} />
            <Mail size={16} className="sb-mail-ico" />
            <span>NEOMAIL</span>
          </div>
          <button className="ib close-btn" onClick={onClose}><X size={15} /></button>
        </div>
        <button className="compose-sb-btn" onClick={() => { onCompose(); onClose(); }}>
          <PenSquare size={14} /> Compose
        </button>
        <nav className="sb-nav">
          {FOLDERS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`ni ${folder === id ? 'ni-active' : ''}`}
              onClick={() => { setFolder(id); onClose(); }}>
              <Icon size={14} /><span>{label}</span>
              {id === 'inbox' && unread > 0 && <span className="ni-badge">{unread > 99 ? '99+' : unread}</span>}
            </button>
          ))}
        </nav>
        <div className="sb-foot">
          {userEmail && <div className="sb-email">{userEmail}</div>}
          <button className="ni" onClick={onLogout}><LogOut size={14} /><span>Sign out</span></button>
        </div>
      </aside>
    </>
  );
}

// ─── Email Row ──────────────────────────────────────────────────────────────────

function Row({ email, sel, onOpen, onStar, onDelete, onArchive, onToggleRead }) {
  const unread   = email.labelIds?.includes('UNREAD');
  const starred  = email.labelIds?.includes('STARRED');
  return (
    <div className={`row ${unread ? 'row-u' : ''} ${sel ? 'row-sel' : ''}`} onClick={() => onOpen(email)}>
      <button className={`star-b ${starred ? 'star-on' : ''}`} onClick={e => { e.stopPropagation(); onStar(email); }}>
        <Star size={12} fill={starred ? 'currentColor' : 'none'} />
      </button>
      <div className="row-av">{fmtSender(email.from)[0]?.toUpperCase() || '?'}</div>
      <div className="row-body">
        <div className="row-t1">
          <span className="row-from">{fmtSender(email.from)}</span>
          <span className="row-date">{fmtDate(email.internalDate)}</span>
        </div>
        <div className="row-sub">{email.subject}</div>
        <div className="row-snip">{email.snippet}</div>
      </div>
      <div className="row-acts" onClick={e => e.stopPropagation()}>
        <button className="ra-btn" title="Archive" onClick={() => onArchive(email)}><Archive size={12} /></button>
        <button className="ra-btn" title={unread ? 'Mark read' : 'Mark unread'} onClick={() => onToggleRead(email)}>
          {unread ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        <button className="ra-btn ra-del" title="Delete" onClick={() => onDelete(email)}><Trash2 size={12} /></button>
      </div>
    </div>
  );
}

// ─── Detail ─────────────────────────────────────────────────────────────────────

function Detail({ email, onBack, onReply, onForward, onDelete, onStar, onToggleRead, mobile }) {
  const [reply,   setReply]   = useState(false);
  const [fwd,     setFwd]     = useState(false);
  const [rBody,   setRBody]   = useState('');
  const [fTo,     setFTo]     = useState('');
  const [fBody,   setFBody]   = useState('');
  const [busy,    setBusy]    = useState(false);
  const ifrRef = useRef(null);

  const body    = getBody(email.payload);
  const starred = email.labelIds?.includes('STARRED');
  const unread  = email.labelIds?.includes('UNREAD');

  const doReply = async () => {
    if (!rBody.trim()) return;
    setBusy(true);
    try { await onReply(email, rBody); setRBody(''); setReply(false); }
    finally { setBusy(false); }
  };
  const doFwd = async () => {
    if (!fTo.trim()) return;
    setBusy(true);
    try { await onForward(email, fTo, fBody); setFTo(''); setFBody(''); setFwd(false); }
    finally { setBusy(false); }
  };

  return (
    <div className="det">
      <div className="det-bar">
        {mobile && <button className="ib" onClick={onBack}><ArrowLeft size={17} /></button>}
        <div className="det-acts">
          <button className={`ib ${starred ? 'star-on' : ''}`} onClick={() => onStar(email)} title="Star"><Star size={14} fill={starred ? 'currentColor' : 'none'} /></button>
          <button className="ib" onClick={() => onToggleRead(email)} title={unread ? 'Mark read' : 'Mark unread'}>{unread ? <Eye size={14}/> : <EyeOff size={14}/>}</button>
          <button className="ib" onClick={() => { setReply(r => !r); setFwd(false); }} title="Reply"><Reply size={14} /></button>
          <button className="ib" onClick={() => { setFwd(f => !f); setReply(false); }} title="Forward"><Forward size={14} /></button>
          <button className="ib ib-del" onClick={() => onDelete(email)} title="Delete"><Trash2 size={14} /></button>
        </div>
      </div>
      <div className="det-body">
        <h1 className="det-subj">{email.subject || '(No Subject)'}</h1>
        <div className="det-meta">
          <div className="det-av">{fmtSender(email.from)[0]?.toUpperCase()}</div>
          <div className="det-meta-txt">
            <div className="det-from">{fmtSender(email.from)}</div>
            <div className="det-addr">{email.from}</div>
            {email.to && <div className="det-addr">To: {email.to}</div>}
          </div>
          <div className="det-dt">{fmtDate(email.internalDate)}</div>
        </div>
        <div className="det-content">
          {body.html ? (
            <iframe
              ref={ifrRef}
              title="email"
              srcDoc={`<base target="_blank"><style>*{box-sizing:border-box}body{font-family:system-ui,sans-serif;font-size:14px;line-height:1.65;color:#111;margin:0;padding:0;word-break:break-word}a{color:#0052ff}img{max-width:100%;height:auto}table{max-width:100%!important}</style>${body.html}`}
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              className="ifr"
              onLoad={e => {
                try { const h = e.target.contentDocument?.documentElement?.scrollHeight; if(h) e.target.style.height = Math.min(h+32,5000)+'px'; } catch {}
              }}
            />
          ) : (
            <pre className="det-txt">{body.text || '(No content)'}</pre>
          )}
        </div>

        {reply && (
          <div className="rc">
            <div className="rc-lbl"><Reply size={12}/> Reply to {fmtSender(email.from)}</div>
            <textarea className="rc-ta" value={rBody} onChange={e=>setRBody(e.target.value)} placeholder="Write your reply…" rows={5} autoFocus />
            <div className="rc-foot">
              <button className="btn-send" onClick={doReply} disabled={busy||!rBody.trim()}>{busy?'Sending…':'Send'} <Send size={12}/></button>
              <button className="btn-ghost" onClick={()=>setReply(false)}>Cancel</button>
            </div>
          </div>
        )}
        {fwd && (
          <div className="rc">
            <div className="rc-lbl"><Forward size={12}/> Forward</div>
            <input className="rc-inp" type="email" placeholder="Forward to…" value={fTo} onChange={e=>setFTo(e.target.value)} autoFocus />
            <textarea className="rc-ta" value={fBody} onChange={e=>setFBody(e.target.value)} placeholder="Add a note (optional)…" rows={4} />
            <div className="rc-foot">
              <button className="btn-send" onClick={doFwd} disabled={busy||!fTo.trim()}>{busy?'Sending…':'Forward'} <Forward size={12}/></button>
              <button className="btn-ghost" onClick={()=>setFwd(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Compose ────────────────────────────────────────────────────────────────────

function Compose({ api, onBack, onToast, prefill }) {
  const [to,      setTo]      = useState(prefill?.to || '');
  const [cc,      setCc]      = useState(prefill?.cc || '');
  const [subject, setSubject] = useState(prefill?.subject || '');
  const [body,    setBody]    = useState(prefill?.body || '');
  const [showCc,  setShowCc]  = useState(!!prefill?.cc);
  const [busy,    setBusy]    = useState(false);

  const send = async () => {
    if (!to||!subject||!body) { onToast('Fill all fields.','error'); return; }
    setBusy(true);
    try {
      let h = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n`;
      if (cc) h += `Cc: ${cc}\r\n`;
      await api.send(encodeRaw(h+'\r\n'+body), prefill?.threadId);
      onToast('Sent!','success');
      onBack();
    } catch { onToast('Send failed.','error'); }
    setBusy(false);
  };

  return (
    <div className="cmp">
      <div className="cmp-bar">
        <button className="ib" onClick={onBack}><ArrowLeft size={17}/></button>
        <span className="cmp-title">New Message</span>
        <div style={{marginLeft:'auto',display:'flex',gap:8}}>
          <button className="btn-ghost" onClick={onBack}>Discard</button>
          <button className="btn-send" onClick={send} disabled={busy}>{busy?'Sending…':'Send'} <Send size={12}/></button>
        </div>
      </div>
      <div className="cmp-fields">
        <div className="cf"><label>To</label><input type="email" value={to} onChange={e=>setTo(e.target.value)} placeholder="recipient@example.com" autoFocus /></div>
        {showCc
          ? <div className="cf"><label>Cc</label><input type="email" value={cc} onChange={e=>setCc(e.target.value)} placeholder="cc@example.com" /></div>
          : <button className="cc-tog" onClick={()=>setShowCc(true)}>+ Cc</button>
        }
        <div className="cf"><label>Subject</label><input type="text" value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Subject" /></div>
        <div className="cf cf-body"><textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Write your message…" rows={16} /></div>
      </div>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────────

export default function App() {
  const [token,     setToken]     = useState(null);
  const [api,       setApi]       = useState(null);
  const [gLoaded,   setGLoaded]   = useState(false);
  const [view,      setView]      = useState('login');
  const [folder,    setFolder]    = useState('inbox');
  const [emails,    setEmails]    = useState([]);
  const [selEmail,  setSelEmail]  = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [search,    setSearch]    = useState('');
  const [activeQ,   setActiveQ]   = useState('');
  const [pageTokens,setPageTokens]= useState([null]);
  const [page,      setPage]      = useState(0);
  const [hasNext,   setHasNext]   = useState(false);
  const [unread,    setUnread]    = useState(0);
  const [toasts,    setToasts]    = useState([]);
  const [sbOpen,    setSbOpen]    = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [prefill,   setPrefill]   = useState(null);
  const [mobile,    setMobile]    = useState(window.innerWidth < 768);

  useEffect(() => {
    const h = () => setMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  useEffect(() => {
    if (window.google) { setGLoaded(true); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => setGLoaded(true);
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }, []);

  // Restore session
  useEffect(() => {
    const tok = getCookie(TOKEN_COOKIE);
    if (tok) {
      const a = new Gmail(tok);
      setToken(tok); setApi(a);
      const u = getCookie(USER_COOKIE);
      if (u) setUserEmail(u);
      setView('inbox');
    }
  }, []);

  const toast = useCallback((msg, type='success') => {
    const id = Date.now();
    setToasts(t => [...t, { id, message: msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);

  const getQ = useCallback(() => {
    if (activeQ) return activeQ;
    return FOLDERS.find(f => f.id === folder)?.q || 'in:inbox';
  }, [folder, activeQ]);

  const fetchPage = useCallback(async (a, pt, reset = true) => {
    if (!a) return;
    setLoading(true);
    try {
      const data = await a.list(getQ(), pt);
      setHasNext(!!data.nextPageToken);
      if (reset) {
        setPageTokens(data.nextPageToken ? [null, data.nextPageToken] : [null]);
        setPage(0);
      } else if (data.nextPageToken) {
        setPageTokens(prev => {
          const next = [...prev];
          if (!next[page + 1]) next.push(data.nextPageToken);
          return next;
        });
      }
      if (!data.messages) { setEmails([]); setLoading(false); return; }

      const details = await Promise.all(data.messages.map(m => a.getMeta(m.id)));
      const parsed = details.map(e => ({
        id: e.id, threadId: e.threadId,
        labelIds: e.labelIds || [],
        snippet: e.snippet || '',
        internalDate: e.internalDate,
        subject: hdr(e.payload?.headers,'Subject') || '(No Subject)',
        from: hdr(e.payload?.headers,'From') || 'Unknown',
        to: hdr(e.payload?.headers,'To') || '',
        payload: e.payload,
      }));
      setEmails(parsed);
      if (folder === 'inbox' && !activeQ)
        setUnread(parsed.filter(e => e.labelIds.includes('UNREAD')).length);
    } catch { toast('Failed to load.','error'); }
    setLoading(false);
  }, [getQ, page, folder, activeQ, toast]);

  useEffect(() => { if (api) fetchPage(api, null, true); }, [folder, activeQ, api]);

  const openEmail = async (email) => {
    setSelEmail(email);
    if (mobile) setView('detail');
    try {
      const full = await api.getFull(email.id);
      const up = { ...email, labelIds: full.labelIds || email.labelIds, payload: full.payload, internalDate: full.internalDate || email.internalDate, to: hdr(full.payload?.headers,'To') || email.to };
      setSelEmail(up);
      if (full.labelIds?.includes('UNREAD')) {
        await api.modify(email.id, { removeLabelIds: ['UNREAD'] });
        const upd = e => e.id===email.id ? {...e,labelIds:e.labelIds.filter(l=>l!=='UNREAD')} : e;
        setEmails(prev => prev.map(upd));
        setUnread(c => Math.max(0,c-1));
      }
    } catch { toast('Could not load email.','error'); }
  };

  const mutateLabelIds = (email, add, remove) => {
    const up = e => e.id===email.id
      ? {...e, labelIds: [...e.labelIds.filter(l=>!remove.includes(l)), ...add.filter(l=>!e.labelIds.includes(l))]}
      : e;
    setEmails(prev => prev.map(up));
    if (selEmail?.id===email.id) setSelEmail(up(selEmail));
  };

  const handleStar = async (email) => {
    const on = email.labelIds?.includes('STARRED');
    try {
      await api.modify(email.id, on ? {removeLabelIds:['STARRED']} : {addLabelIds:['STARRED']});
      mutateLabelIds(email, on?[]:['STARRED'], on?['STARRED']:[]);
    } catch { toast('Action failed.','error'); }
  };

  const handleToggleRead = async (email) => {
    const unr = email.labelIds?.includes('UNREAD');
    try {
      await api.modify(email.id, unr ? {removeLabelIds:['UNREAD']} : {addLabelIds:['UNREAD']});
      mutateLabelIds(email, unr?[]:['UNREAD'], unr?['UNREAD']:[]);
      setUnread(c => unr ? Math.max(0,c-1) : c+1);
    } catch { toast('Action failed.','error'); }
  };

  const handleDelete = async (email) => {
    try {
      await api.trash(email.id);
      setEmails(prev => prev.filter(e => e.id!==email.id));
      if (selEmail?.id===email.id) { setSelEmail(null); if(mobile) setView('inbox'); }
      toast('Moved to trash.','success');
    } catch { toast('Delete failed.','error'); }
  };

  const handleArchive = async (email) => {
    try {
      await api.modify(email.id, {removeLabelIds:['INBOX']});
      setEmails(prev => prev.filter(e => e.id!==email.id));
      if (selEmail?.id===email.id) { setSelEmail(null); if(mobile) setView('inbox'); }
      toast('Archived.','success');
    } catch { toast('Archive failed.','error'); }
  };

  const handleReply = async (email, body) => {
    const subj = email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
    const raw = encodeRaw(`To: ${email.from}\r\nSubject: ${subj}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`);
    await api.send(raw, email.threadId);
    toast('Reply sent!','success');
  };

  const handleForward = async (email, to, extra) => {
    const b = getBody(email.payload);
    const quoted = `\n\n--- Forwarded message ---\nFrom: ${email.from}\nSubject: ${email.subject}\n\n${b.text || '(HTML content)'}`;
    const raw = encodeRaw(`To: ${to}\r\nSubject: Fwd: ${email.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${extra}${quoted}`);
    await api.send(raw);
    toast('Forwarded!','success');
  };

  const handleLogin = () => {
    if (!gLoaded) return;
    window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPES,
      callback: async (resp) => {
        if (resp.error) { toast('Login failed.','error'); return; }
        const a = new Gmail(resp.access_token);
        setCookie(TOKEN_COOKIE, resp.access_token, 1);
        try {
          const p = await a.profile();
          if (p.emailAddress) { setUserEmail(p.emailAddress); setCookie(USER_COOKIE, p.emailAddress, 24); }
        } catch {}
        setToken(resp.access_token); setApi(a); setView('inbox');
      },
    }).requestAccessToken();
  };

  const handleLogout = () => {
    if (token) { try { window.google?.accounts?.oauth2?.revoke(token,()=>{}); } catch {} }
    deleteCookie(TOKEN_COOKIE); deleteCookie(USER_COOKIE);
    setToken(null); setApi(null); setView('login');
    setEmails([]); setSelEmail(null); setUserEmail('');
  };

  const compose = (pf=null) => { setPrefill(pf); setView('compose'); };
  const nextPage = () => { const pt=pageTokens[page+1]; if(!pt) return; setPage(p=>p+1); fetchPage(api,pt,false); };
  const prevPage = () => { if(page===0) return; const p2=page-1; setPage(p2); fetchPage(api,pageTokens[p2],false); };
  const doSearch = e => { e.preventDefault(); setActiveQ(search.trim()); };

  // ── Login ────────────────────────────────────────────────────────────────────
  if (view === 'login') return (
    <>
      <style>{CSS}</style>
      <div className="login-bg">
        <div className="login-grid"/>
        <div className="login-glow"/>
        <div className="login-card">
          <div className="l-icon">
            <img src="mail.png" alt="" className="l-img" onError={e=>e.target.style.display='none'} />
            <Mail size={32} className="l-mail-ico"/>
          </div>
          <h1 className="l-title">NeoMail</h1>
          <p className="l-tag">Your Gmail. Faster. Better.</p>
          <div className="l-feats">
            <span><Zap size={11}/> Instant inbox</span>
            <span><Star size={11}/> Smart starring</span>
            <span><Archive size={11}/> One-tap archive</span>
          </div>
          <button className="l-btn" onClick={handleLogin} disabled={!gLoaded}>
            <svg width="17" height="17" viewBox="0 0 18 18">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 14.013 17.64 11.706 17.64 9.2z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
              <path d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            {gLoaded ? 'Continue with Google' : 'Loading…'}
          </button>
          <p className="l-legal">Secure OAuth 2.0 · We never store your password</p>
        </div>
      </div>
      {toasts.map(t=><Toast key={t.id} {...t} onClose={()=>setToasts(x=>x.filter(i=>i.id!==t.id))}/>)}
    </>
  );

  // ── App ──────────────────────────────────────────────────────────────────────
  const showList    = !mobile || view==='inbox';
  const showDetail  = (!mobile || view==='detail') && view!=='compose';
  const showCompose = view==='compose';

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <Sidebar
          folder={folder}
          setFolder={f => { setFolder(f); setSelEmail(null); if(mobile) setView('inbox'); }}
          unread={unread}
          open={sbOpen}
          onClose={() => setSbOpen(false)}
          onCompose={compose}
          onLogout={handleLogout}
          userEmail={userEmail}
        />

        <div className="main">
          <header className="topbar">
            <button className="ib hamburger" onClick={() => setSbOpen(true)}><Menu size={19}/></button>
            <form className="s-wrap" onSubmit={doSearch}>
              <Search size={13} className="s-ico"/>
              <input className="s-inp" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search mail…"/>
              {activeQ && <button type="button" className="s-clr" onClick={()=>{setActiveQ('');setSearch('');}}><X size={12}/></button>}
            </form>
            <button className="ib" onClick={()=>compose()} title="Compose"><PenSquare size={16}/></button>
            <button className="ib" onClick={handleLogout} title="Sign out"><LogOut size={15}/></button>
          </header>

          <div className="panels">
            {showList && !showCompose && (
              <div className={`list-pane ${!mobile && selEmail ? 'list-narrow' : ''}`}>
                <div className="l-toolbar">
                  <span className="l-fname">{activeQ ? `"${activeQ}"` : FOLDERS.find(f=>f.id===folder)?.label}</span>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    {page>0 && <span className="pg-lbl">Pg {page+1}</span>}
                    <button className="ib" onClick={()=>fetchPage(api,null,true)} disabled={loading}><RefreshCw size={13} className={loading?'spin':''}/></button>
                  </div>
                </div>
                <div className="email-list">
                  {loading
                    ? Array.from({length:10}).map((_,i)=><div key={i} className="skel" style={{animationDelay:`${i*45}ms`}}/>)
                    : emails.length===0
                      ? <div className="empty"><Mail size={32} strokeWidth={1}/><span>No emails</span></div>
                      : emails.map(e=><Row key={e.id} email={e} sel={selEmail?.id===e.id} onOpen={openEmail} onStar={handleStar} onDelete={handleDelete} onArchive={handleArchive} onToggleRead={handleToggleRead}/>)
                  }
                </div>
                <div className="pag">
                  <button className="pg-btn" onClick={prevPage} disabled={page===0||loading}><ChevronLeft size={14}/>Prev</button>
                  <button className="pg-btn" onClick={nextPage} disabled={!hasNext||loading}>Next<ChevronRight size={14}/></button>
                </div>
              </div>
            )}

            {showDetail && selEmail && (
              <div className="det-wrap">
                <Detail email={selEmail} onBack={()=>{setSelEmail(null);if(mobile)setView('inbox');}} onReply={handleReply} onForward={handleForward} onDelete={handleDelete} onStar={handleStar} onToggleRead={handleToggleRead} mobile={mobile}/>
              </div>
            )}

            {!showCompose && !selEmail && !mobile && (
              <div className="empty-det"><Mail size={44} strokeWidth={1}/><p>Select an email to read</p></div>
            )}

            {showCompose && (
              <div className="det-wrap">
                <Compose api={api} onBack={()=>setView(selEmail&&!mobile?'detail':'inbox')} onToast={toast} prefill={prefill}/>
              </div>
            )}
          </div>

          {mobile && (
            <nav className="mob-nav">
              {FOLDERS.slice(0,4).map(({id,label,icon:Icon})=>(
                <button key={id} className={`mob-btn ${folder===id&&view==='inbox'?'mob-active':''}`}
                  onClick={()=>{setFolder(id);setView('inbox');setSelEmail(null);}}>
                  <Icon size={18}/>
                  {id==='inbox'&&unread>0&&<span className="mob-badge">{unread>9?'9+':unread}</span>}
                  <span>{label}</span>
                </button>
              ))}
              <button className="mob-btn" onClick={()=>compose()}><PenSquare size={18}/><span>Compose</span></button>
            </nav>
          )}
        </div>
      </div>
      {toasts.map(t=><Toast key={t.id} {...t} onClose={()=>setToasts(x=>x.filter(i=>i.id!==t.id))}/>)}
    </>
  );
}

// ─── CSS ────────────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body,#root{height:100%;overflow:hidden}
body{font-family:'DM Sans',sans-serif;color:#111;background:#f0efe8;-webkit-font-smoothing:antialiased}
:root{
  --bg:#f0efe8;--surface:#fff;--border:#111;--soft:#e2e0d8;
  --t2:#555;--t3:#999;--acc:#0052ff;--acc-dim:#e8eeff;
  --star:#f0a500;--danger:#e53e3e;
  --mono:'Space Mono',monospace;
  --sb:220px;--tb:52px;--mob-nav:60px;
  --sh:3px 3px 0 #111;--sh-lg:5px 5px 0 #111;--r:3px;
}

/* LOGIN */
.login-bg{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;position:relative;overflow:hidden}
.login-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);background-size:48px 48px}
.login-glow{position:absolute;top:30%;left:50%;transform:translate(-50%,-50%);width:600px;height:600px;background:radial-gradient(circle,rgba(0,82,255,.22) 0%,transparent 70%);pointer-events:none}
.login-card{position:relative;z-index:1;background:#111;border:2px solid #2a2a2a;box-shadow:0 0 0 1px #1e1e1e,var(--sh-lg);padding:48px 40px;width:380px;display:flex;flex-direction:column;align-items:center;gap:13px;text-align:center}
.l-icon{width:72px;height:72px;background:#0052ff;border:2px solid #333;display:flex;align-items:center;justify-content:center;position:relative;margin-bottom:4px}
.l-img{width:100%;height:100%;object-fit:cover;position:absolute;inset:0}
.l-mail-ico{color:#fff;position:relative}
.l-title{font-family:var(--mono);font-size:30px;font-weight:700;color:#fff;letter-spacing:-.5px}
.l-tag{color:#777;font-size:14px}
.l-feats{display:flex;gap:14px;margin:4px 0}
.l-feats span{display:flex;align-items:center;gap:4px;font-size:11.5px;color:#666;font-weight:500}
.l-feats svg{color:#0052ff}
.l-btn{margin-top:8px;width:100%;display:flex;align-items:center;justify-content:center;gap:10px;padding:13px 20px;background:#fff;border:2px solid #111;box-shadow:var(--sh);font-family:'DM Sans',sans-serif;font-size:15px;font-weight:600;cursor:pointer;transition:transform 80ms,box-shadow 80ms;color:#111}
.l-btn:hover{transform:translate(2px,2px);box-shadow:1px 1px 0 #111}
.l-btn:disabled{opacity:.5;pointer-events:none}
.l-legal{font-size:11px;color:#444;margin-top:4px}

/* APP SHELL */
.app{display:flex;height:100vh;overflow:hidden}
.main{flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden}

/* SIDEBAR */
.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:199}
.sidebar{width:var(--sb);min-width:var(--sb);height:100vh;background:var(--surface);border-right:2px solid var(--border);display:flex;flex-direction:column;flex-shrink:0;z-index:200;transition:transform 220ms ease}
.sb-head{display:flex;align-items:center;justify-content:space-between;padding:14px 12px;border-bottom:2px solid var(--border)}
.sb-logo{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:1px}
.sb-img{width:24px;height:24px;object-fit:cover;border:1.5px solid var(--border)}
.sb-mail-ico{color:#0052ff}
.close-btn{display:none}
.compose-sb-btn{margin:10px 10px 6px;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px;background:var(--acc);color:#fff;border:2px solid var(--border);box-shadow:var(--sh);font-family:'DM Sans',sans-serif;font-size:13.5px;font-weight:600;cursor:pointer;transition:transform 80ms,box-shadow 80ms}
.compose-sb-btn:hover{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--border)}
.sb-nav{flex:1;padding:6px 8px;display:flex;flex-direction:column;gap:2px;overflow-y:auto}
.ni{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:var(--r);cursor:pointer;border:1.5px solid transparent;background:none;font-family:'DM Sans',sans-serif;font-size:13.5px;font-weight:500;color:var(--t2);text-align:left;transition:all 80ms;width:100%}
.ni:hover{background:var(--bg);color:#111;border-color:var(--soft)}
.ni-active{background:var(--acc-dim)!important;color:var(--acc)!important;border-color:var(--acc)!important;font-weight:600}
.ni-badge{margin-left:auto;background:var(--acc);color:#fff;border-radius:10px;font-size:10px;font-family:var(--mono);padding:1px 6px;min-width:18px;text-align:center}
.sb-foot{padding:8px;border-top:2px solid var(--soft)}
.sb-email{font-size:10.5px;color:var(--t3);padding:5px 10px;font-family:var(--mono);word-break:break-all}

/* TOPBAR */
.topbar{height:var(--tb);border-bottom:2px solid var(--border);display:flex;align-items:center;gap:10px;padding:0 12px;background:var(--surface);flex-shrink:0}
.hamburger{flex-shrink:0}
.s-wrap{flex:1;max-width:540px;position:relative;display:flex;align-items:center}
.s-ico{position:absolute;left:9px;color:var(--t3);pointer-events:none}
.s-inp{width:100%;padding:7px 28px 7px 30px;border:1.5px solid var(--soft);border-radius:var(--r);background:var(--bg);font-family:'DM Sans',sans-serif;font-size:13.5px;color:#111;outline:none;transition:border-color 100ms}
.s-inp:focus{border-color:var(--border);background:#fff}
.s-clr{position:absolute;right:8px;background:none;border:none;cursor:pointer;color:var(--t3);display:flex;align-items:center}

/* PANELS */
.panels{flex:1;display:flex;overflow:hidden;min-height:0}

/* LIST */
.list-pane{width:380px;min-width:310px;border-right:2px solid var(--border);display:flex;flex-direction:column;background:var(--surface);flex-shrink:0;transition:width 200ms}
.list-narrow{width:300px;min-width:250px}
.l-toolbar{display:flex;align-items:center;justify-content:space-between;padding:9px 13px;border-bottom:2px solid var(--border);background:var(--surface);flex-shrink:0}
.l-fname{font-family:var(--mono);font-size:11.5px;font-weight:700;letter-spacing:.5px}
.pg-lbl{font-family:var(--mono);font-size:10px;color:var(--t3)}
.email-list{flex:1;overflow-y:auto}

/* ROW */
.row{display:flex;align-items:flex-start;gap:9px;padding:11px 13px;border-bottom:1px solid var(--soft);cursor:pointer;background:#fff;transition:background 80ms;position:relative}
.row:hover{background:#fafaf7}
.row:hover .row-acts{opacity:1}
.row-u{background:#fff}
.row-u .row-from,.row-u .row-sub{font-weight:700;color:#111}
.row-sel{background:var(--acc-dim)!important;border-left:3px solid var(--acc)}
.star-b{flex-shrink:0;width:18px;height:18px;background:none;border:none;cursor:pointer;color:var(--t3);display:flex;align-items:center;justify-content:center;margin-top:2px;transition:color 80ms}
.star-b:hover,.star-on{color:var(--star)!important}
.row-av{flex-shrink:0;width:28px;height:28px;background:var(--acc);color:#fff;display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:11px;font-weight:700;border:1.5px solid var(--border);margin-top:1px}
.row-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.row-t1{display:flex;align-items:baseline;justify-content:space-between;gap:6px}
.row-from{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
.row-date{font-family:var(--mono);font-size:9.5px;color:var(--t3);flex-shrink:0}
.row-sub{font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#111}
.row-snip{font-size:11.5px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row-acts{position:absolute;right:8px;top:50%;transform:translateY(-50%);display:flex;gap:2px;opacity:0;transition:opacity 100ms;background:#fff;border:1px solid var(--soft);padding:3px}
.row-sel .row-acts{background:var(--acc-dim)}
.ra-btn{width:22px;height:22px;background:none;border:none;cursor:pointer;color:var(--t3);display:flex;align-items:center;justify-content:center;border-radius:2px;transition:all 80ms}
.ra-btn:hover{background:var(--bg);color:#111}
.ra-del:hover{color:var(--danger)!important}

/* SKELETON */
.skel{height:68px;background:linear-gradient(90deg,#eee 25%,#f5f5f2 50%,#eee 75%);background-size:200% 100%;animation:shimmer 1.2s infinite;border-bottom:1px solid var(--soft)}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* EMPTY */
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:80px 20px;color:var(--t3);font-size:14px}
.empty-det{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--t3);font-size:14px;background:var(--bg)}

/* PAGINATION */
.pag{display:flex;gap:8px;padding:11px;border-top:2px solid var(--border);background:var(--surface);justify-content:center;flex-shrink:0}
.pg-btn{display:flex;align-items:center;gap:4px;padding:6px 13px;background:#fff;border:2px solid var(--border);box-shadow:var(--sh);font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;transition:transform 80ms,box-shadow 80ms}
.pg-btn:hover:not(:disabled){transform:translate(2px,2px);box-shadow:1px 1px 0 var(--border)}
.pg-btn:disabled{opacity:.35;pointer-events:none}

/* DETAIL */
.det-wrap{flex:1;overflow-y:auto;background:#fff;min-width:0;display:flex;flex-direction:column}
.det{display:flex;flex-direction:column;max-width:840px;width:100%;margin:0 auto;padding-bottom:60px}
.det-bar{display:flex;align-items:center;justify-content:flex-end;padding:9px 14px;border-bottom:2px solid var(--border);position:sticky;top:0;background:#fff;z-index:5;gap:3px}
.det-acts{display:flex;gap:2px}
.det-body{padding:22px 22px 0}
.det-subj{font-size:21px;font-weight:700;line-height:1.3;margin-bottom:16px}
.det-meta{display:flex;align-items:center;gap:11px;padding-bottom:16px;border-bottom:1px solid var(--soft)}
.det-av{width:38px;height:38px;background:var(--acc);color:#fff;border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:14px;font-weight:700;flex-shrink:0}
.det-meta-txt{flex:1;min-width:0}
.det-from{font-size:14px;font-weight:600}
.det-addr{font-size:11px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.det-dt{font-family:var(--mono);font-size:10.5px;color:var(--t3);flex-shrink:0}
.det-content{padding:22px 0}
.ifr{width:100%;border:none;display:block;min-height:80px}
.det-txt{white-space:pre-wrap;font-family:var(--mono);font-size:12.5px;line-height:1.75;color:#111}

/* REPLY/FWD */
.rc{margin:0 0 24px;border:2px solid var(--border);box-shadow:var(--sh);background:#fff}
.rc-lbl{display:flex;align-items:center;gap:6px;padding:8px 11px;border-bottom:2px solid var(--border);font-size:11.5px;font-weight:700;background:var(--bg);font-family:var(--mono)}
.rc-inp{width:100%;padding:9px 11px;border:none;border-bottom:1px solid var(--soft);font-family:'DM Sans',sans-serif;font-size:13px;outline:none;background:#fff}
.rc-ta{width:100%;padding:11px;border:none;outline:none;resize:vertical;font-family:'DM Sans',sans-serif;font-size:14px;line-height:1.65;background:#fff;min-height:90px}
.rc-foot{display:flex;gap:8px;align-items:center;padding:9px 11px;border-top:1px solid var(--soft);background:var(--bg)}
.ib-del:hover{color:var(--danger)!important}

/* COMPOSE */
.cmp{display:flex;flex-direction:column;max-width:840px;width:100%;margin:0 auto;height:100%}
.cmp-bar{display:flex;align-items:center;gap:11px;padding:11px 14px;border-bottom:2px solid var(--border);flex-shrink:0;background:#fff;position:sticky;top:0;z-index:5}
.cmp-title{font-family:var(--mono);font-size:13px;font-weight:700}
.cmp-fields{flex:1;display:flex;flex-direction:column;overflow-y:auto}
.cf{display:flex;flex-direction:column;gap:5px;padding:11px 14px;border-bottom:1px solid var(--soft)}
.cf label{font-size:10.5px;font-weight:700;font-family:var(--mono);color:var(--t2);letter-spacing:.5px;text-transform:uppercase}
.cf input,.cf textarea{border:1.5px solid var(--soft);background:var(--bg);border-radius:var(--r);padding:8px 10px;font-family:'DM Sans',sans-serif;font-size:14px;color:#111;outline:none;transition:border-color 100ms}
.cf input:focus,.cf textarea:focus{border-color:var(--border);background:#fff}
.cf textarea{resize:none;flex:1;min-height:220px}
.cf-body{flex:1}
.cc-tog{padding:6px 14px;text-align:left;font-size:12px;color:var(--acc);font-weight:600;background:none;border:none;cursor:pointer;border-bottom:1px solid var(--soft)}

/* BUTTONS */
.ib{width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:none;border:1.5px solid transparent;border-radius:var(--r);cursor:pointer;color:var(--t2);transition:all 80ms;flex-shrink:0}
.ib:hover{background:var(--bg);border-color:var(--soft);color:#111}
.btn-send{display:flex;align-items:center;gap:5px;padding:8px 15px;background:var(--acc);color:#fff;border:2px solid var(--border);box-shadow:var(--sh);font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;transition:transform 80ms,box-shadow 80ms;flex-shrink:0}
.btn-send:hover:not(:disabled){transform:translate(2px,2px);box-shadow:1px 1px 0 var(--border)}
.btn-send:disabled{opacity:.4;pointer-events:none}
.btn-ghost{display:flex;align-items:center;gap:5px;padding:7px 12px;background:none;border:1.5px solid var(--soft);border-radius:var(--r);font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;cursor:pointer;color:var(--t2)}
.btn-ghost:hover{border-color:var(--border);color:#111}

/* TOAST */
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:9px 15px;display:flex;align-items:center;gap:7px;font-size:13px;font-weight:500;border:2px solid #333;box-shadow:var(--sh-lg);z-index:9999;animation:su 180ms ease;white-space:nowrap}
.toast-error{background:var(--danger)}
@keyframes su{from{opacity:0;transform:translateX(-50%) translateY(8px)}}

/* SPIN */
.spin{animation:sp 700ms linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}

/* MOBILE NAV */
.mob-nav{height:var(--mob-nav);border-top:2px solid var(--border);background:var(--surface);display:none;align-items:center;justify-content:space-around;flex-shrink:0;padding:0 4px}
.mob-btn{display:flex;flex-direction:column;align-items:center;gap:2px;padding:5px 8px;background:none;border:none;cursor:pointer;color:var(--t3);font-size:9.5px;font-family:'DM Sans',sans-serif;font-weight:500;position:relative;transition:color 80ms;min-width:52px}
.mob-active{color:var(--acc)!important}
.mob-badge{position:absolute;top:1px;right:6px;background:var(--acc);color:#fff;border-radius:8px;font-size:8.5px;padding:0 4px;font-family:var(--mono);min-width:13px;text-align:center}

/* RESPONSIVE */
@media(max-width:767px){
  :root{--sb:260px}
  .sidebar{position:fixed;left:0;top:0;transform:translateX(-100%)}
  .sidebar.open{transform:translateX(0)}
  .overlay{display:block}
  .close-btn{display:flex}
  .list-pane{width:100%;border-right:none;min-width:unset}
  .mob-nav{display:flex}
  .main{padding-bottom:var(--mob-nav)}
  .panels{position:relative;overflow:hidden}
  .det-wrap{position:absolute;inset:0;z-index:10;background:#fff;overflow-y:auto}
  .det-subj{font-size:17px}
}
@media(max-width:900px) and (min-width:768px){
  .list-pane{width:280px;min-width:240px}
}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#ccc;border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:#aaa}
`;
