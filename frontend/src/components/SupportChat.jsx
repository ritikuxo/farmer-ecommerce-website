// ============================================================
//  SupportChat.jsx — floating "Chat with Admin" widget
//
//  Mounted on the Farmer, Consumer and Delivery dashboards so
//  everyone can share problems/opinions with the platform admin
//  and FILE A COMPLAINT against a farmer / delivery partner
//  (with their name, email and mobile so the admin can identify
//  them and take action).
//
//  Firestore model
//    supportThreads/{uid}                 → one thread per user
//      { userId, userName, userEmail, userPhone, userRole,
//        status: "open"|"resolved", lastMessage, lastSender,
//        lastMessageAt, userReadAt, createdAt }
//    supportThreads/{uid}/messages/{id}   { sender, name, text, createdAt }
//    complaints/{id}                      { filedBy*, against*, status, ... }
// ============================================================

import { useEffect, useRef, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "../firebase/config";
import "./SupportChat.css";

const ROLE_LABELS = {
  farmer: "Farmer",
  consumer: "Consumer",
  delivery: "Delivery Partner",
};

const fmtTime = (ts) => {
  const secs = ts?.seconds;
  if (!secs) return "";
  return new Date(secs * 1000).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
};

export default function SupportChat({ role = "consumer" }) {
  const user = auth.currentUser;

  const [open, setOpen] = useState(false);
  const [showComplaint, setShowComplaint] = useState(false);
  const [profile, setProfile] = useState({ name: "", email: "", phone: "" });
  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(false);

  const [complaint, setComplaint] = useState({
    againstType: "farmer",
    againstName: "",
    againstEmail: "",
    againstPhone: "",
    orderRef: "",
    description: "",
  });
  const [filing, setFiling] = useState(false);
  const [complaintDone, setComplaintDone] = useState("");

  const endRef = useRef(null);

  /* ---------- my profile (name / email / phone) ---------- */
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid))
      .then((snap) => {
        const d = snap.data() || {};
        setProfile({
          name: d.name || d.displayName || user.displayName || ROLE_LABELS[role],
          email: d.email || user.email || "",
          phone: d.phone || "",
        });
      })
      .catch(() => {});
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- thread listener (status + unread dot) ---------- */
  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, "supportThreads", user.uid), (snap) => {
      const d = snap.data();
      setThread(d || null);
      setUnread(!!d && d.lastSender === "admin" && d.status !== "resolved");
    });
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- messages listener while the chat is open ---------- */
  useEffect(() => {
    if (!open || !user) { setMessages([]); return; }
    const q = query(
      collection(db, "supportThreads", user.uid, "messages"),
      orderBy("createdAt", "asc")
    );
    return onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      updateDoc(doc(db, "supportThreads", user.uid), {
        userReadAt: serverTimestamp(),
      }).catch(() => {});
    });
  }, [open, user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- auto-scroll to newest message ---------- */
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, showComplaint]);

  /* ---------- open chat (creates the thread if first time) ---------- */
  const openChat = () => {
    setOpen(true);
    if (!user) return;
    setDoc(
      doc(db, "supportThreads", user.uid),
      {
        userId: user.uid,
        userName: profile.name || user.displayName || ROLE_LABELS[role],
        userEmail: profile.email || user.email || "",
        userPhone: profile.phone || "",
        userRole: role,
        status: "open",
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
      },
      { merge: true }
    ).catch(() => {});
  };

  /* ---------- send a chat message ---------- */
  const send = async () => {
    const text = input.trim();
    if (!text || !user || sending) return;
    setSending(true);
    setInput("");
    try {
      await addDoc(collection(db, "supportThreads", user.uid, "messages"), {
        sender: "user",
        name: profile.name || ROLE_LABELS[role],
        text,
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "supportThreads", user.uid), {
        lastMessage: text.slice(0, 200),
        lastSender: "user",
        lastMessageAt: serverTimestamp(),
        userReadAt: serverTimestamp(),
        status: "open",
      });
    } catch {
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  /* ---------- file a complaint against farmer / delivery ---------- */
  const fileComplaint = async () => {
    const c = complaint;
    if (!user || filing) return;
    if (!c.againstName.trim() || !c.description.trim()) return;
    setFiling(true);
    try {
      await addDoc(collection(db, "complaints"), {
        filedByUid: user.uid,
        filedByName: profile.name || ROLE_LABELS[role],
        filedByEmail: profile.email || user.email || "",
        filedByRole: role,
        filedByPhone: profile.phone || "",
        againstType: c.againstType,
        againstName: c.againstName.trim(),
        againstEmail: c.againstEmail.trim(),
        againstPhone: c.againstPhone.trim(),
        orderRef: c.orderRef.trim(),
        description: c.description.trim(),
        status: "pending",
        adminNote: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      /* system note inside the chat so the admin sees it there too */
      await addDoc(collection(db, "supportThreads", user.uid, "messages"), {
        sender: "user",
        name: profile.name || ROLE_LABELS[role],
        text:
          "⚠️ COMPLAINT FILED against " + c.againstType + ": " + c.againstName.trim() +
          (c.againstEmail ? " • email: " + c.againstEmail.trim() : "") +
          (c.againstPhone ? " • phone: " + c.againstPhone.trim() : "") +
          (c.orderRef ? " • order: " + c.orderRef.trim() : "") +
          "\n\n" + c.description.trim(),
        complaint: true,
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "supportThreads", user.uid), {
        lastMessage: "⚠️ Complaint filed against " + c.againstName.trim(),
        lastSender: "user",
        lastMessageAt: serverTimestamp(),
        userReadAt: serverTimestamp(),
        status: "open",
      });

      setComplaintDone(
        "✅ Complaint filed! The admin will review it and take action. You can track the reply here in this chat."
      );
      setComplaint({
        againstType: "farmer", againstName: "", againstEmail: "",
        againstPhone: "", orderRef: "", description: "",
      });
      setTimeout(() => {
        setComplaintDone("");
        setShowComplaint(false);
      }, 3500);
    } catch {
      setComplaintDone("⚠️ Could not file the complaint. Please try again.");
    } finally {
      setFiling(false);
    }
  };

  if (!user) return null;

  return (
    <div className="sup-root">
      {!open && (
        <button type="button" className="sup-fab" onClick={openChat} title="Chat with Admin / Support">
          💬
          {unread && <span className="sup-dot" />}
        </button>
      )}

      {open && (
        <div className="sup-panel">
          <div className="sup-head">
            <div className="sup-head-main">
              <div className="sup-head-title">
                🛡️ E-Farm Support{" "}
                <span className={"sup-status" + (thread?.status === "resolved" ? " ok" : "")}>
                  {thread?.status === "resolved" ? "Resolved" : "Online"}
                </span>
              </div>
              <div className="sup-head-sub">{ROLE_LABELS[role]} • {profile.email || user.email}</div>
            </div>
            <div className="sup-head-actions">
              <button type="button" className="sup-ico" title="File a complaint" onClick={() => setShowComplaint((v) => !v)}>⚠️</button>
              <button type="button" className="sup-ico" title="Minimise" onClick={() => setOpen(false)}>✕</button>
            </div>
          </div>

          {showComplaint ? (
            <div className="sup-complaint">
              {complaintDone ? (
                <div className="sup-done">{complaintDone}</div>
              ) : (
                <>
                  <div className="sup-cform-title">File a Complaint</div>
                  <div className="sup-cform-sub">Tell the admin exactly who this is about — name, email and mobile help them identify the person.</div>

                  <div className="sup-segwrap">
                    <button type="button" className={"sup-seg" + (complaint.againstType === "farmer" ? " on" : "")} onClick={() => setComplaint((c) => ({ ...c, againstType: "farmer" }))}>
                      👨‍🌾 Farmer
                    </button>
                    <button type="button" className={"sup-seg" + (complaint.againstType === "delivery" ? " on" : "")} onClick={() => setComplaint((c) => ({ ...c, againstType: "delivery" }))}>
                      🚚 Delivery Partner
                    </button>
                  </div>

                  <input placeholder="Person's name *" value={complaint.againstName}
                    onChange={(e) => setComplaint((c) => ({ ...c, againstName: e.target.value }))} />
                  <input placeholder="Their email" value={complaint.againstEmail}
                    onChange={(e) => setComplaint((c) => ({ ...c, againstEmail: e.target.value }))} />
                  <input placeholder="Their mobile number" value={complaint.againstPhone}
                    onChange={(e) => setComplaint((c) => ({ ...c, againstPhone: e.target.value }))} />
                  <input placeholder="Order ID (optional)" value={complaint.orderRef}
                    onChange={(e) => setComplaint((c) => ({ ...c, orderRef: e.target.value }))} />
                  <textarea placeholder="What happened? Describe the problem *" rows={4}
                    value={complaint.description}
                    onChange={(e) => setComplaint((c) => ({ ...c, description: e.target.value }))} />

                  <div className="sup-cform-actions">
                    <button type="button" className="sup-btn ghost" onClick={() => setShowComplaint(false)}>Back to chat</button>
                    <button type="button" className="sup-btn red"
                      disabled={filing || !complaint.againstName.trim() || !complaint.description.trim()}
                      onClick={fileComplaint}>
                      {filing ? "Filing…" : "Submit complaint"}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="sup-body">
                {thread?.status === "resolved" && (
                  <div className="sup-resolved-note">✅ The admin marked this chat as resolved. Send a message to reopen it.</div>
                )}
                {messages.length === 0 && (
                  <div className="sup-welcome">
                    👋 Hi {profile.name || "there"}! Share any problem, opinion or question with the E-Farm admin — or use ⚠️ above to file a complaint against a farmer or delivery partner.
                  </div>
                )}
                {messages.map((m) => (
                  <div key={m.id} className={"sup-msg " + (m.sender === "admin" ? "them" : "me")}>
                    <div className="sup-bubble">
                      {m.complaint && <div className="sup-flag">⚠️ Formal complaint</div>}
                      {m.text}
                      <div className="sup-time">{fmtTime(m.createdAt)}</div>
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              <div className="sup-inputrow">
                <input
                  value={input}
                  placeholder="Type your message to the admin…"
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                />
                <button type="button" className="sup-send" onClick={send} disabled={sending || !input.trim()}>➤</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
