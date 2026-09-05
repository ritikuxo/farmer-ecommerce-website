import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { db } from "../firebase/config";

function AdminDashboard() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionUserId, setActionUserId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [purging, setPurging] = useState(false);

  // =====================================================
  // LOAD USERS
  // =====================================================

  const loadUsers = async () => {
    try {
      setLoading(true);

      const snapshot = await getDocs(
        collection(db, "users")
      );

      const userList = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      }));

      setUsers(userList);
    } catch (error) {
      console.error("Error loading users:", error);

      alert(
        "Unable to load users. Please check your Firebase configuration and Firestore rules."
      );
    } finally {
      setLoading(false);
    }
  };

  // =====================================================
  // LOAD USERS WHEN PAGE OPENS
  // =====================================================

  useEffect(() => {
    loadUsers();
  }, []);

  // =====================================================
  // UPDATE USER STATUS
  // =====================================================

  const updateStatus = async (userId, status) => {
    try {
      setActionUserId(userId);

      await updateDoc(doc(db, "users", userId), {
        status,
      });

      setUsers((previousUsers) =>
        previousUsers.map((user) =>
          user.id === userId
            ? {
                ...user,
                status,
              }
            : user
        )
      );

      if (status === "approved") {
        alert("✅ User approved successfully!");
      }

      if (status === "rejected") {
        alert("❌ User rejected successfully!");
      }
    } catch (error) {
      console.error("Error updating status:", error);

      alert(
        "Unable to update user status. Please check your Firestore rules."
      );
    } finally {
      setActionUserId("");
    }
  };

  // =====================================================
  // SUSPEND USER
  // =====================================================

  const suspendUser = async (user) => {
    if (!user || !user.id) {
      return;
    }

    const roleName =
      user.role === "farmer"
        ? "farmer"
        : user.role === "delivery"
        ? "delivery partner"
        : "user";

    const daysInput = window.prompt(
      `Suspend this ${roleName} for how many days?\n\nEnter 1, 3, 7, 15 or 30:`,
      "7"
    );

    if (daysInput === null) {
      return;
    }

    const days = Number(daysInput);

    if (![1, 3, 7, 15, 30].includes(days)) {
      alert(
        "Invalid duration.\n\nPlease enter: 1, 3, 7, 15 or 30."
      );
      return;
    }

    const suspendedUntil = new Date(
      Date.now() +
        days * 24 * 60 * 60 * 1000
    );

    const suspendedUntilISO =
      suspendedUntil.toISOString();

    try {
      setActionUserId(user.id);

      await updateDoc(
        doc(db, "users", user.id),
        {
          status: "suspended",
          suspendedUntil: suspendedUntilISO,
          suspensionDays: days,
        }
      );

      setUsers((previousUsers) =>
        previousUsers.map((item) =>
          item.id === user.id
            ? {
                ...item,
                status: "suspended",
                suspendedUntil: suspendedUntilISO,
                suspensionDays: days,
              }
            : item
        )
      );

      alert(
        `🚫 User suspended for ${days} day${
          days === 1 ? "" : "s"
        }.\n\nSuspension ends:\n${suspendedUntil.toLocaleString()}`
      );
    } catch (error) {
      console.error(
        "Error suspending user:",
        error
      );

      alert(
        "Unable to suspend user. Please check your Firestore rules."
      );
    } finally {
      setActionUserId("");
    }
  };

  // =====================================================
  // UNSUSPEND USER
  // =====================================================

  const unsuspendUser = async (user) => {
    if (!user || !user.id) {
      return;
    }

    try {
      setActionUserId(user.id);

      await updateDoc(
        doc(db, "users", user.id),
        {
          status: "approved",
          suspendedUntil: null,
          suspensionDays: null,
        }
      );

      setUsers((previousUsers) =>
        previousUsers.map((item) =>
          item.id === user.id
            ? {
                ...item,
                status: "approved",
                suspendedUntil: null,
                suspensionDays: null,
              }
            : item
        )
      );

      alert("✅ User suspension removed.");
    } catch (error) {
      console.error(
        "Error removing suspension:",
        error
      );

      alert(
        "Unable to remove suspension. Please check your Firestore rules."
      );
    } finally {
      setActionUserId("");
    }
  };

  // =====================================================
  // PURGE E2E TEST USERS
  // One-click cleanup for the throwaway accounts created by
  // the old e2e-order-flow test (emails starting with "e2e.").
  // Deletes their profile docs + leftover test orders/products.
  // Auth accounts are removed afterwards by purge-e2e-auth.mjs.
  // =====================================================

  const purgeE2EUsers = async () => {
    const e2eUsers = users.filter((user) =>
      String(user.email || "").toLowerCase().startsWith("e2e.")
    );

    if (e2eUsers.length === 0) {
      alert("No E2E test users found — everything is already clean. 🎉");
      return;
    }

    const confirmed = window.confirm(
      `Purge ${e2eUsers.length} E2E test users?\n\n` +
        `Deletes every account whose email starts with "e2e." from the\n` +
        `users collection, plus leftover E2E test orders and products.\n\n` +
        `Their Authentication logins are removed afterwards by running\n` +
        `node purge-e2e-auth.mjs in the frontend folder.`
    );
    if (!confirmed) {
      return;
    }

    try {
      setPurging(true);

      const e2eUids = new Set(e2eUsers.map((user) => user.id));

      // 1) Leftover E2E test orders — the test always tagged
      //    consumerEmail as "e2e@example.com".
      let ordersDeleted = 0;
      let ordersSkipped = 0;
      try {
        const ordersSnap = await getDocs(
          query(
            collection(db, "orders"),
            where("consumerEmail", "==", "e2e@example.com")
          )
        );
        for (const orderDoc of ordersSnap.docs) {
          try {
            await deleteDoc(doc(db, "orders", orderDoc.id));
            ordersDeleted += 1;
          } catch {
            ordersSkipped += 1;
          }
        }
      } catch {
        ordersSkipped += 1;
      }

      // 2) Leftover E2E test products — farmerId belongs to an e2e account.
      let productsDeleted = 0;
      let productsSkipped = 0;
      try {
        const productsSnap = await getDocs(collection(db, "products"));
        for (const productDoc of productsSnap.docs) {
          if (!e2eUids.has(productDoc.data().farmerId)) {
            continue;
          }
          try {
            await deleteDoc(doc(db, "products", productDoc.id));
            productsDeleted += 1;
          } catch {
            productsSkipped += 1;
          }
        }
      } catch {
        productsSkipped += 1;
      }

      // 3) The profile docs themselves (admin-only delete — allowed here).
      let usersDeleted = 0;
      let usersFailed = 0;
      for (const user of e2eUsers) {
        try {
          await deleteDoc(doc(db, "users", user.id));
          usersDeleted += 1;
        } catch {
          usersFailed += 1;
        }
      }

      // 4) Export the emails so purge-e2e-auth.mjs can delete the
      //    Authentication logins (a web client can only delete its
      //    own auth account, so that part runs outside the app).
      const emailList = e2eUsers
        .map((user) => user.email)
        .sort()
        .join("\n");

      let clipboardOk = false;
      try {
        await navigator.clipboard.writeText(emailList);
        clipboardOk = true;
      } catch {
        // Clipboard blocked — the downloaded file still has them.
      }

      try {
        const blob = new Blob([emailList + "\n"], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "e2e-emails.txt";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } catch {
        // Download blocked — the console still carries the list.
      }

      console.log("E2E test user emails:\n" + emailList);

      alert(
        `🧹 E2E purge finished.\n\n` +
          `User profiles deleted: ${usersDeleted}` +
          (usersFailed ? ` (${usersFailed} failed)` : "") +
          `\nTest orders deleted: ${ordersDeleted}` +
          (ordersSkipped ? ` (${ordersSkipped} skipped/failed)` : "") +
          `\nTest products deleted: ${productsDeleted}` +
          (productsSkipped ? ` (${productsSkipped} skipped/failed)` : "") +
          `\n\nNext step — remove their Authentication logins:\n` +
          `1. e2e-emails.txt was downloaded` +
          (clipboardOk ? " and copied to your clipboard" : "") +
          `.\n` +
          `2. Move it into the frontend folder.\n` +
          `3. Run:  node purge-e2e-auth.mjs`
      );

      await loadUsers();
    } catch (error) {
      console.error("Error purging E2E test users:", error);
      alert("E2E purge failed. Check the browser console for details.");
    } finally {
      setPurging(false);
    }
  };

  // =====================================================
  // AUTOMATICALLY RESTORE EXPIRED SUSPENSIONS
  // =====================================================

  const checkExpiredSuspensions = async (
    userList
  ) => {
    const now = Date.now();

    const expiredUsers = userList.filter(
      (user) =>
        user.status === "suspended" &&
        user.suspendedUntil &&
        new Date(user.suspendedUntil).getTime() <= now
    );

    if (expiredUsers.length === 0) {
      return;
    }

    try {
      await Promise.all(
        expiredUsers.map((user) =>
          updateDoc(
            doc(db, "users", user.id),
            {
              status: "approved",
              suspendedUntil: null,
              suspensionDays: null,
            }
          )
        )
      );

      setUsers((previousUsers) =>
        previousUsers.map((user) =>
          expiredUsers.some(
            (expired) => expired.id === user.id
          )
            ? {
                ...user,
                status: "approved",
                suspendedUntil: null,
                suspensionDays: null,
              }
            : user
        )
      );
    } catch (error) {
      console.error(
        "Error restoring expired suspensions:",
        error
      );
    }
  };

  // =====================================================
  // STATISTICS
  // =====================================================

  const totalUsers = users.length;

  const farmers = users.filter(
    (user) => user.role === "farmer"
  );

  const deliveryPartners = users.filter(
    (user) => user.role === "delivery"
  );

  const consumers = users.filter(
    (user) => user.role === "consumer"
  );

  const pendingUsers = users.filter(
    (user) =>
      user.status === "pending" &&
      (user.role === "farmer" ||
        user.role === "delivery")
  );

  const approvedUsers = users.filter(
    (user) => user.status === "approved"
  );

  const rejectedUsers = users.filter(
    (user) => user.status === "rejected"
  );

  const suspendedUsers = users.filter(
    (user) => user.status === "suspended"
  );

  // =====================================================
  // FILTER + SEARCH
  // =====================================================

  const filteredUsers = useMemo(() => {
    const search =
      searchTerm.trim().toLowerCase();

    return users.filter((user) => {
      const matchesRole =
        filterRole === "all" ||
        user.role === filterRole;

      const matchesStatus =
        filterStatus === "all" ||
        user.status === filterStatus;

      const matchesSearch =
        search === "" ||
        String(user.name || "")
          .toLowerCase()
          .includes(search) ||
        String(user.email || "")
          .toLowerCase()
          .includes(search) ||
        String(user.phone || "")
          .toLowerCase()
          .includes(search) ||
        String(user.role || "")
          .toLowerCase()
          .includes(search);

      return (
        matchesRole &&
        matchesStatus &&
        matchesSearch
      );
    });
  }, [
    users,
    searchTerm,
    filterRole,
    filterStatus,
  ]);

  // =====================================================
  // HELPER FUNCTIONS
  // =====================================================

  const getRoleName = (role) => {
    if (role === "farmer") {
      return "Farmer";
    }

    if (role === "delivery") {
      return "Delivery Partner";
    }

    if (role === "consumer") {
      return "Consumer";
    }

    return role || "Unknown";
  };

  const getRoleIcon = (role) => {
    if (role === "farmer") {
      return "👨‍🌾";
    }

    if (role === "delivery") {
      return "🚚";
    }

    if (role === "consumer") {
      return "🛒";
    }

    return "👤";
  };

  const getStatusClass = (status) => {
    if (status === "approved") {
      return "approved";
    }

    if (status === "rejected") {
      return "rejected";
    }

    if (status === "suspended") {
      return "suspended";
    }

    return "pending";
  };

  const getStatusText = (user) => {
    if (user.status === "approved") {
      return "✓ Approved";
    }

    if (user.status === "rejected") {
      return "✕ Rejected";
    }

    if (user.status === "suspended") {
      if (user.suspensionDays) {
        return `🚫 Suspended (${user.suspensionDays} days)`;
      }

      return "🚫 Suspended";
    }

    return "⏳ Pending";
  };

  const scrollTo = (sectionId) => {
    const element = document.getElementById(sectionId);

    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // =====================================================
  // SUPPORT INBOX + COMPLAINTS (live listeners)
  // =====================================================

  const [threads, setThreads] = useState([]);
  const [openThreadId, setOpenThreadId] = useState("");
  const [threadMsgs, setThreadMsgs] = useState([]);
  const [adminReply, setAdminReply] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [complaints, setComplaints] = useState([]);
  const [noteEdits, setNoteEdits] = useState({});

  useEffect(() => {
    const unsubT = onSnapshot(
      collection(db, "supportThreads"),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort(
          (a, b) => (b.lastMessageAt?.seconds || 0) - (a.lastMessageAt?.seconds || 0)
        );
        setThreads(list);
      },
      (err) => console.error("supportThreads listener:", err)
    );
    const unsubC = onSnapshot(
      collection(db, "complaints"),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort(
          (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
        );
        setComplaints(list);
      },
      (err) => console.error("complaints listener:", err)
    );
    return () => {
      unsubT();
      unsubC();
    };
  }, []);

  useEffect(() => {
    if (!openThreadId) {
      setThreadMsgs([]);
      return undefined;
    }
    return onSnapshot(
      query(
        collection(db, "supportThreads", openThreadId, "messages"),
        orderBy("createdAt", "asc")
      ),
      (snap) => setThreadMsgs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
  }, [openThreadId]);

  const sendAdminReply = async () => {
    const text = adminReply.trim();
    if (!text || !openThreadId || sendingReply) return;
    setSendingReply(true);
    try {
      await addDoc(collection(db, "supportThreads", openThreadId, "messages"), {
        sender: "admin",
        name: "Admin",
        text,
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "supportThreads", openThreadId), {
        lastMessage: text.slice(0, 200),
        lastSender: "admin",
        lastMessageAt: serverTimestamp(),
      });
      setAdminReply("");
    } catch (error) {
      console.error("Error sending admin reply:", error);
      alert("Unable to send the reply. Check Firestore rules.");
    } finally {
      setSendingReply(false);
    }
  };

  const setThreadStatus = async (t, status) => {
    try {
      await updateDoc(doc(db, "supportThreads", t.id), { status });
    } catch (error) {
      console.error("Error updating thread:", error);
    }
  };

  const updateComplaint = async (id, patch) => {
    try {
      await updateDoc(doc(db, "complaints", id), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Error updating complaint:", error);
      alert("Unable to update the complaint.");
    }
  };

  /* Jump to the All Users section pre-filtered by the accused
     person's email/name so the admin can suspend them. */
  const findComplainedUser = (term) => {
    setSearchTerm(String(term || "").trim());
    scrollTo("adm-users");
  };

  const openThread = threads.find((t) => t.id === openThreadId) || null;
  const openThreads = threads.filter((t) => t.status !== "resolved");
  const pendingComplaints = complaints.filter((c) => c.status === "pending");

  // =====================================================
  // STYLES
  // =====================================================

  const styles = `.adm-shell {
      display: flex;
      min-height: 100vh;
      background: #f2f5f4;
      color: #1a2b21;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .adm-sidebar {
      width: 260px;
      position: sticky;
      top: 0;
      height: 100vh;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      padding: 24px 16px;
      background: linear-gradient(180deg, #0f3c26 0%, #14532d 55%, #166534 100%);
      color: #ffffff;
      box-shadow: 6px 0 24px rgba(15, 45, 27, 0.14);
    }

    .adm-brand {
      font-size: 20px;
      font-weight: 900;
      letter-spacing: 0.2px;
      padding: 4px 10px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.16);
      margin-bottom: 20px;
      white-space: nowrap;
    }

    .adm-brand span {
      color: #bbf7d0;
      font-weight: 800;
      margin-left: 4px;
    }

    .adm-nav {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .adm-nav-label {
      font-size: 10px;
      letter-spacing: 1.6px;
      color: rgba(255, 255, 255, 0.55);
      text-transform: uppercase;
      font-weight: 800;
      padding: 0 10px 8px;
    }

    .adm-nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 12px 12px;
      background: transparent;
      border: none;
      cursor: pointer;
      color: #e7f5ec;
      font-family: inherit;
      font-size: 14px;
      font-weight: 650;
      border-radius: 12px;
      text-align: left;
      transition: background 0.18s ease, transform 0.18s ease;
    }

    .adm-nav-item:hover {
      background: rgba(255, 255, 255, 0.1);
      transform: translateX(2px);
    }

    .adm-nav-item.active {
      background: #ffffff;
      color: #14532d;
      font-weight: 850;
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.2);
    }

    .adm-nav-item:disabled {
      opacity: 0.55;
      cursor: default;
      transform: none;
    }

    .adm-nav-emoji {
      font-size: 17px;
      width: 24px;
      text-align: center;
      flex-shrink: 0;
    }

    .adm-count {
      margin-left: auto;
      background: #fbbf24;
      color: #3f2d00;
      font-size: 11px;
      font-weight: 900;
      min-width: 22px;
      height: 22px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 6px;
    }

    .adm-sidebar-foot {
      margin-top: auto;
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(255, 255, 255, 0.09);
      border-radius: 14px;
      padding: 12px;
    }

    .adm-avatar {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      background: #ffffff;
      color: #14532d;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
      flex-shrink: 0;
    }

    .adm-name {
      font-size: 13px;
      font-weight: 850;
      color: #ffffff;
    }

    .adm-role {
      font-size: 11px;
      color: #bbf7d0;
      margin-top: 2px;
    }

    .adm-main {
      flex: 1;
      min-width: 0;
      padding: 26px 30px 46px;
    }

    .adm-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      flex-wrap: wrap;
      margin-bottom: 24px;
    }

    .adm-title {
      font-size: 30px;
      font-weight: 900;
      margin: 0;
      color: #123b26;
    }

    .adm-subtitle {
      margin: 6px 0 0;
      color: #5d6b62;
      font-size: 14px;
    }

    .adm-topbar-right {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .adm-section {
      background: #ffffff;
      border: 1px solid #e4ebe6;
      border-radius: 20px;
      padding: 24px;
      margin-bottom: 22px;
      box-shadow: 0 6px 22px rgba(18, 55, 35, 0.05);
      scroll-margin-top: 20px;
    }

    .adm-section-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
      margin-bottom: 18px;
    }

    .adm-section-head h2 {
      margin: 0;
      font-size: 20px;
      font-weight: 850;
      color: #123b26;
    }

    .adm-section-head p {
      margin: 4px 0 0;
      color: #66756c;
      font-size: 13px;
    }

    .adm-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 16px;
    }

    .adm-stat {
      border-radius: 16px;
      padding: 18px;
      border: 1px solid #e6ede8;
      background: #fbfdfb;
      display: flex;
      flex-direction: column;
      gap: 6px;
      position: relative;
      overflow: hidden;
    }

    .adm-stat::after {
      content: "";
      position: absolute;
      right: -18px;
      top: -18px;
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: var(--accent, rgba(22, 163, 74, 0.1));
    }

    .adm-stat-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .adm-stat-icon {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }

    .adm-stat-label {
      font-size: 12.5px;
      color: #6b7a70;
      font-weight: 750;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      margin-top: 4px;
    }

    .adm-stat-value {
      font-size: 30px;
      font-weight: 900;
      color: #123b26;
      line-height: 1;
    }

    .adm-bars {
      display: flex;
      gap: 10px;
      margin-top: 20px;
    }

    .adm-bar-cell {
      flex: 1;
      border-radius: 13px;
      padding: 14px 12px;
      text-align: center;
      font-size: 12.5px;
      font-weight: 850;
    }.adm-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 16px;
    }

    .adm-search {
      width: 310px;
      max-width: 100%;
      padding: 12px 18px;
      border-radius: 13px;
      border: 1px solid #dbe5dd;
      background: #ffffff;
      font-family: inherit;
      font-size: 14px;
      outline: none;
      box-shadow: 0 2px 8px rgba(16, 60, 35, 0.05);
      transition: border 0.18s ease, box-shadow 0.18s ease;
    }

    .adm-search:focus {
      border-color: #16a34a;
      box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.12);
    }

    .adm-toolbar .adm-search {
      flex: 1;
      min-width: 240px;
      width: auto;
    }

    .adm-select {
      padding: 11px 14px;
      border-radius: 12px;
      border: 1px solid #dbe5dd;
      background: #ffffff;
      font-family: inherit;
      font-size: 13.5px;
      font-weight: 600;
      color: #24352b;
      outline: none;
      cursor: pointer;
    }.adm-user-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .adm-user {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 18px;
      border-radius: 14px;
      border: 1px solid #e7eeea;
      background: #fcfdfc;
      transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
    }

    .adm-user:hover {
      border-color: #b9d4c2;
      box-shadow: 0 6px 14px rgba(20, 70, 40, 0.07);
      background: #ffffff;
    }

    .adm-user-left {
      display: flex;
      align-items: center;
    }

    .adm-user-icon {
      width: 48px;
      height: 48px;
      border-radius: 14px;
      background: #ecf7f0;
      border: 1px solid #d3ecd9;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      flex-shrink: 0;
      margin-right: 14px;
    }

    .adm-user-info {
      min-width: 0;
    }

    .adm-user-name {
      margin: 0;
      font-size: 15px;
      font-weight: 800;
      color: #1a2b21;
    }

    .adm-user-meta {
      margin: 3px 0 0;
      color: #75837a;
      font-size:  13px;
    }.adm-pills {
      display: flex;
      flex-wrap: wrap;
      gap:  8px;
      margin-top:  7px;
      align-items: center;
    }

    .adm-pill {
      display: inline-flex;
      align-items: center;
      gap:  5px;
      padding:  4px 10px;
      border-radius:  999px;
      font-size:  11px;
      font-weight:  800;
      letter-spacing:  0.2px;
    }

    .adm-pill.role {
      background: #eaf3ee;
      color: #14532d;
    }

    .adm-pill.approved {
      background: #e7f8ec;
      color: #15803d;
    }

    .adm-pill.pending {
      background: #fff6dd;
      color: #a16207;
    }

    .adm-pill.rejected {
      background: #ffe9e9;
      color: #c33737;
    }

    .adm-pill.suspended {
      background: #ffeeda;
      color: #c2410c;
    }.adm-suspend-note {
      margin:  0;
      padding-top:  6px;
      font-size:  12px;
      font-weight:  700;
      color: #c2410c;
    }

    .adm-actions {
      display: flex;
      flex-wrap: wrap;
      gap:  8px;
      justify-content: flex-end;
    }

    .adm-btn {
      border: none;
      cursor: pointer;
      font-family: inherit;
      font-size:  13px;
      font-weight:  800;
      padding:  10px 15px;
      border-radius:  11px;
      display: inline-flex;
      align-items: center;
      gap:  6px;
      transition: transform  0.16s ease, background  0.18s ease;
    }

    .adm-btn:hover:not(:disabled) {
      transform: translateY(-1px);
    }

    .adm-btn:disabled {
      opacity:  0.55;
      cursor: not-allowed;
    }

    .adm-btn-approve {
      background: #16a34a;
      color: #ffffff;
      box-shadow:  0 5px 14px rgba(22, 163, 74, 0.2);
    }

    .adm-btn-approve:hover:not(:disabled) {
      background: #15803d;
    }

    .adm-btn-reject {
      background: #fff1f1;
      color: #c33737;
      border:  1px solid #f7d2d2;
    }

    .adm-btn-reject:hover:not(:disabled) {
      background: #ffe3e3;
    }

    .adm-btn-suspend {
      background: #fff4e8;
      color: #c2410c;
      border:  1px solid #fbd9b5;
    }

    .adm-btn-suspend:hover:not(:disabled) {
      background: #ffe9d2;
    }

    .adm-btn-unsuspend {
      background: #16a34a;
      color: #ffffff;
      box-shadow:  0 5px 14px rgba(22, 163, 74, 0.2);
    }

    .adm-btn-unsuspend:hover:not(:disabled) {
      background: #15803d;
    }

    .adm-btn-purge {
      background: #f5f3ff;
      color: #6d28d9;
      border: 1px solid #ddd6fe;
    }

    .adm-btn-purge:hover:not(:disabled) {
      background: #ede9fe;
    }

    .adm-empty {
      text-align: center;
      padding:  44px 20px;
      border:  1px dashed #cfdbd3;
      border-radius:  16px;
      color: #77867c;
      font-size:  14px;
    }

    .adm-empty-icon {
      font-size:  34px;
      margin-bottom:  8px;
    }

    .adm-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap:  12px;
      min-height:  220px;
      color: #6b7a70;
      font-size:  14px;
    }

    .adm-spinner {
      width:  38px;
      height:  38px;
      border-radius:  50%;
      border:  4px solid #dce9df;
      border-top-color: #16a34a;
      animation: admSpin  0.8s linear infinite;
    }

    @keyframes admSpin {
      to {
        transform: rotate(360deg);
      }
    }

    .adm-summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap:  14px;
    }

    .adm-summary-tile {
      border-radius:  16px;
      padding:  18px;
      border:  1px solid #e6ede8;
    }

    .adm-summary-icon {
      font-size:  24px;
    }

    .adm-summary-label {
      margin-top:  8px;
      font-size:  11px;
      font-weight:  850;
      letter-spacing:  0.6px;
      color: #6b7a70;
    }

    .adm-summary-value {
      font-size:  25px;
      font-weight:  900;
      margin-top:  4px;
      color: #123b26;
    }

    .adm-refresh-area {
      display: flex;
      justify-content: center;
      margin-top:  4px;
    }

    .adm-refresh {
      min-height:  46px;
      padding:  0 26px;
      border: none;
      border-radius:  13px;
      background: #123b26;
      color: #ffffff;
      cursor: pointer;
      font-family: inherit;
      font-size:  13px;
      font-weight:  850;
      transition: background  0.18s ease, transform  0.18s ease;
    }

    .adm-refresh:hover:not(:disabled) {
      background: #166534;
      transform: translateY(-2px);
    }

    .adm-refresh:disabled {
      opacity:  0.55;
      cursor: not-allowed;
    }

    .adm-result-count {
      margin-top:  16px;
      margin-bottom:  0;
      color: #8a968e;
      font-size:  12px;
      text-align: right;
    }@media (max-width: 1080px) {
      .adm-sidebar {
        width:  220px;
        padding:  20px 12px;
      }

      .adm-main {
        padding:  20px;
      }
    }

    @media (max-width: 860px) {
      .adm-shell {
        flex-direction: column;
      }

      .adm-sidebar {
        width:  100%;
        height: auto;
        position: static;
        flex-direction: row;
        align-items: center;
        padding:  12px 14px;
        gap:  10px;
        overflow-x: auto;
      }

      .adm-brand {
        border: none;
        margin:  0;
        padding:  0 8px 0 0;
        font-size:  16px;
        white-space: nowrap;
      }

      .adm-nav {
        flex-direction: row;
        align-items: center;
      }

      .adm-nav-label {
        display: none;
      }

      .adm-nav-item {
        padding:  9px 11px;
        white-space: nowrap;
      }

      .adm-nav-item .adm-nav-text {
        display: none;
      }

      .adm-sidebar-foot {
        display: none;
      }

      .adm-stats {
        grid-template-columns: repeat(2,  1fr);
      }

      .adm-user {
        align-items: flex-start;
        flex-direction: column;
      }

      .adm-actions {
        width:  100%;
        justify-content: flex-start;
      }

      .adm-actions .adm-btn {
        flex:  1;
        justify-content: center;
      }
    }

    @media (max-width: 520px) {
      .adm-stats {
        grid-template-columns:  1fr;
      }

      .adm-main {
        padding:  14px;
      }

      .adm-section {
        padding:  16px;
      }

      .adm-bars {
        flex-direction: column;
      }
    }

    /* ===== SUPPORT INBOX ===== */
    .adm-sup-grid {
      display: grid;
      grid-template-columns: 300px minmax(0, 1fr);
      gap: 14px;
    }
    .adm-sup-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 520px;
      overflow-y: auto;
    }
    .adm-sup-thread {
      text-align: left;
      border: 1.5px solid #e3ece6;
      background: #ffffff;
      border-radius: 12px;
      padding: 10px 12px;
      cursor: pointer;
      font-family: inherit;
      transition: border 0.15s ease, box-shadow 0.15s ease;
    }
    .adm-sup-thread:hover { border-color: #9cc7aa; }
    .adm-sup-thread.on {
      border-color: #166534;
      box-shadow: 0 0 0 3px rgba(22, 101, 52, 0.1);
    }
    .adm-sup-thread-top { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
    .adm-sup-name { font-weight: 800; font-size: 13px; color: #173423; }
    .adm-sup-role {
      font-size: 10px;
      font-weight: 800;
      text-transform: capitalize;
      border-radius: 999px;
      padding: 2px 8px;
      background: #e8f0ea;
      color: #40614b;
    }
    .adm-sup-role.r-farmer { background: #dcfce7; color: #15803d; }
    .adm-sup-role.r-consumer { background: #dbeafe; color: #1d4ed8; }
    .adm-sup-role.r-delivery { background: #fef3c7; color: #b45309; }
    .adm-sup-open {
      margin-left: auto;
      font-size: 10px;
      font-weight: 800;
      color: #b91c1c;
      background: #fee2e2;
      border-radius: 999px;
      padding: 2px 8px;
    }
    .adm-sup-res {
      margin-left: auto;
      font-size: 10px;
      font-weight: 800;
      color: #15803d;
      background: #dcfce7;
      border-radius: 999px;
      padding: 2px 8px;
    }
    .adm-sup-last {
      font-size: 12px;
      color: #43554a;
      margin-top: 5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .adm-sup-meta { font-size: 10.5px; color: #8a968e; margin-top: 3px; }
    .adm-sup-empty {
      color: #8a968e;
      font-size: 13px;
      padding: 14px;
      background: #f4f7f4;
      border-radius: 12px;
    }
    .adm-sup-empty.tall {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .adm-sup-chat {
      display: flex;
      flex-direction: column;
      border: 1.5px solid #e3ece6;
      border-radius: 14px;
      overflow: hidden;
      background: #ffffff;
      height: 520px;
    }
    .adm-sup-chathead {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 11px 14px;
      background: #f2f7f2;
      border-bottom: 1px solid #e3ece6;
      flex-wrap: wrap;
    }
    .adm-sup-msgs {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 9px;
      background: #f8fbf7;
    }
    .adm-sup-msg { display: flex; }
    .adm-sup-msg.them { justify-content: flex-start; }
    .adm-sup-msg.me { justify-content: flex-end; }
    .adm-sup-bubble {
      max-width: 78%;
      padding: 8px 12px;
      border-radius: 13px;
      font-size: 12.5px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .adm-sup-msg.them .adm-sup-bubble {
      background: #ffffff;
      border: 1px solid #e0e9e2;
      color: #1a2b21;
      border-bottom-left-radius: 4px;
    }
    .adm-sup-msg.me .adm-sup-bubble {
      background: #14532d;
      color: #ffffff;
      border-bottom-right-radius: 4px;
    }
    .adm-sup-flag {
      display: inline-block;
      font-size: 10px;
      font-weight: 800;
      color: #b45309;
      background: #fef3c7;
      border-radius: 6px;
      padding: 2px 7px;
      margin-bottom: 5px;
    }
    .adm-sup-msg.me .adm-sup-flag { background: rgba(255, 255, 255, 0.18); color: #ffffff; }
    .adm-sup-time { font-size: 9.5px; opacity: 0.6; margin-top: 4px; text-align: right; }
    .adm-sup-reply {
      display: flex;
      gap: 8px;
      padding: 10px;
      border-top: 1px solid #e3ece6;
      background: #ffffff;
    }
    .adm-sup-reply input {
      flex: 1;
      min-width: 0;
      border: 1.5px solid #d9e5da;
      border-radius: 10px;
      padding: 9px 12px;
      font-size: 12.5px;
      font-family: inherit;
      outline: none;
    }
    .adm-sup-reply input:focus { border-color: #166534; }
    .adm-sup-reply button {
      border: none;
      border-radius: 10px;
      background: #14532d;
      color: #ffffff;
      font-weight: 800;
      font-size: 12.5px;
      padding: 0 16px;
      cursor: pointer;
      font-family: inherit;
    }
    .adm-sup-reply button:disabled { opacity: 0.5; cursor: default; }

    /* ===== COMPLAINTS ===== */
    .adm-complaint {
      border: 1.5px solid #f3d9d9;
      background: #fffafa;
      border-radius: 14px;
      padding: 14px 16px;
      margin-bottom: 12px;
    }
    .adm-complaint-head {
      display: flex;
      align-items: center;
      gap: 9px;
      flex-wrap: wrap;
    }
    .adm-complaint-head b { font-size: 14px; color: #3b1d1d; }
    .adm-complaint-head select {
      margin-left: auto;
      border: 1.5px solid #e3caca;
      border-radius: 9px;
      padding: 6px 8px;
      font-family: inherit;
      font-size: 12px;
      font-weight: 700;
      color: #5f3a3a;
      background: #ffffff;
      cursor: pointer;
    }
    .adm-complaint-desc {
      margin: 10px 0;
      padding: 10px 12px;
      background: #ffffff;
      border: 1px dashed #e7c9c9;
      border-radius: 10px;
      font-size: 13px;
      color: #4a2f2f;
      white-space: pre-wrap;
    }
    .adm-complaint-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }
    .adm-complaint-grid > div {
      background: #f6efef;
      border-radius: 9px;
      padding: 8px 10px;
      font-size: 12px;
      color: #4a3232;
      word-break: break-word;
    }
    .adm-complaint-grid label {
      display: block;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      color: #9c7b7b;
      margin-bottom: 2px;
    }
    .adm-complaint-note {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .adm-complaint-note input {
      flex: 1;
      min-width: 180px;
      border: 1.5px solid #e3caca;
      border-radius: 9px;
      padding: 8px 10px;
      font-size: 12px;
      font-family: inherit;
      outline: none;
    }
    .adm-complaint-note input:focus { border-color: #b45309; }
    .adm-complaint-note button {
      border: none;
      border-radius: 9px;
      padding: 8px 14px;
      font-size: 12px;
      font-weight: 800;
      font-family: inherit;
      cursor: pointer;
    }
    .adm-complaint-note .save { background: #14532d; color: #ffffff; }
    .adm-complaint-note .find { background: #e8f0ea; color: #2c5e40; }

    @media (max-width: 860px) {
      .adm-sup-grid { grid-template-columns: 1fr; }
      .adm-sup-chat { height: 440px; }
    }
  `;
  return (
    <>
      <style>{styles}</style>

      <div className="adm-shell">

        {/* ============ SIDEBAR ============ */}
        <aside className="adm-sidebar">
          <div className="adm-brand">🌾 E-Farm <span>ADMIN</span></div>

          <nav className="adm-nav">
            <div className="adm-nav-label">Menu</div>

            <button
              type="button"
              className="adm-nav-item"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            >
              <span className="adm-nav-emoji">📊</span>
              <span className="adm-nav-text">Overview</span>
            </button>

            <button
              type="button"
              className="adm-nav-item"
              onClick={() => scrollTo("adm-approvals")}
            >
              <span className="adm-nav-emoji">⏳</span>
              <span className="adm-nav-text">Approvals</span>
              <span className="adm-count">{pendingUsers.length}</span>
            </button>

            <button
              type="button"
              className="adm-nav-item"
              onClick={() => scrollTo("adm-users")}
            >
              <span className="adm-nav-emoji">👥</span>
              <span className="adm-nav-text">All Users</span>
            </button>

            <button
              type="button"
              className="adm-nav-item"
              onClick={() => scrollTo("adm-summary")}
            >
              <span className="adm-nav-emoji">📈</span>
              <span className="adm-nav-text">Summary</span>
            </button>

            <button
              type="button"
              className="adm-nav-item"
              onClick={() => scrollTo("adm-support")}
            >
              <span className="adm-nav-emoji">💬</span>
              <span className="adm-nav-text">Support Inbox</span>
              <span className="adm-count">{openThreads.length}</span>
            </button>

            <button
              type="button"
              className="adm-nav-item"
              onClick={() => scrollTo("adm-complaints")}
            >
              <span className="adm-nav-emoji">⚠️</span>
              <span className="adm-nav-text">Complaints</span>
              <span className="adm-count">{pendingComplaints.length}</span>
            </button>

            <button
              type="button"
              className="adm-nav-item"
              onClick={loadUsers}
              disabled={loading}
            >
              <span className="adm-nav-emoji">🔄</span>
              <span className="adm-nav-text">
                {loading ? "Refreshing..." : "Refresh"}
              </span>
            </button>
          </nav>

          <div className="adm-sidebar-foot">
            <div className="adm-avatar">🛡️</div>
            <div>
              <div className="adm-name">Administrator</div>
              <div className="adm-role">Super Admin</div>
            </div>
          </div>
        </aside>{/* ============ MAIN ============ */}
        <main className="adm-main">

          <header className="adm-topbar">
            <div>
              <h1 className="adm-title">Admin Dashboard</h1>
              <p className="adm-subtitle">
                Manage farmers, consumers and delivery partners from one place.
              </p>
            </div>
            <div className="adm-topbar-right">
              <div className="adm-avatar">🛡️</div>
            </div>
          </header>

          {/* ===== OVERVIEW / STATS ===== */}
          <section className="adm-section" id="adm-overview">
            <div className="adm-section-head">
              <h2>Overview</h2>
              <p>Platform health at a glance</p>
            </div>

            <div className="adm-stats">
              <div
                className="adm-stat"
                style={{ "--accent": "rgba(37, 99, 235, 0.12)" }}
              >
                <div className="adm-stat-top">
                  <div
                    className="adm-stat-icon"
                    style={{ background: "#e3edfc" }}
                  >
                    👥
                  </div>
                </div>
                <div className="adm-stat-label">Total Users</div>
                <div className="adm-stat-value">{totalUsers}</div>
              </div>

              <div
                className="adm-stat"
                style={{ "--accent": "rgba(217, 119, 6, 0.14)" }}
              >
                <div className="adm-stat-top">
                  <div
                    className="adm-stat-icon"
                    style={{ background: "#fdf0d0" }}
                  >
                    ⏳
                  </div>
                </div>
                <div className="adm-stat-label">Pending Approvals</div>
                <div className="adm-stat-value">{pendingUsers.length}</div>
              </div>

              <div
                className="adm-stat"
                style={{ "--accent": "rgba(22, 163, 74, 0.13)" }}
              >
                <div className="adm-stat-top">
                  <div
                    className="adm-stat-icon"
                    style={{ background: "#dff5e6" }}
                  >
                    👨‍🌾
                  </div>
                </div>
                <div className="adm-stat-label">Farmers</div>
                <div className="adm-stat-value">{farmers.length}</div>
              </div>

              <div
                className="adm-stat"
                style={{ "--accent": "rgba(124, 58, 237, 0.12)" }}
              >
                <div className="adm-stat-top">
                  <div
                    className="adm-stat-icon"
                    style={{ background: "#ece2fb" }}
                  >
                    🚚
                  </div>
                </div>
                <div className="adm-stat-label">Delivery Partners</div>
                <div className="adm-stat-value">{deliveryPartners.length}</div>
              </div>

              <div
                className="adm-stat"
                style={{ "--accent": "rgba(225, 29, 72, 0.12)" }}
              >
                <div className="adm-stat-top">
                  <div
                    className="adm-stat-icon"
                    style={{ background: "#fce2ea" }}
                  >
                    🛒
                  </div>
                </div>
                <div className="adm-stat-label">Consumers</div>
                <div className="adm-stat-value">{consumers.length}</div>
              </div>

              <div
                className="adm-stat"
                style={{ "--accent": "rgba(234, 88, 12, 0.13)" }}
              >
                <div className="adm-stat-top">
                  <div
                    className="adm-stat-icon"
                    style={{ background: "#fde8d3" }}
                  >
                    🚫
                  </div>
                </div>
                <div className="adm-stat-label">Suspended</div>
                <div className="adm-stat-value">{suspendedUsers.length}</div>
              </div>
            </div>

            {/* ROLE DISTRIBUTION */}
            <div className="adm-bars">
              <div
                className="adm-bar-cell"
                style={{ background: "#e4f7ea", color: "#166534" }}
              >
                👨‍🌾 {farmers.length} Farmers
                {totalUsers ? " (" + Math.round((farmers.length / totalUsers) * 100) + "%)" : " (0%)"}
              </div>
              <div
                className="adm-bar-cell"
                style={{ background: "#efe6fc", color: "#6d28d9" }}
              >
                🚚 {deliveryPartners.length} Delivery
                {totalUsers
                  ? " (" + Math.round((deliveryPartners.length / totalUsers) * 100) + "%)"
                  : " (0%)"}
              </div>
              <div
                className="adm-bar-cell"
                style={{ background: "#fde7ee", color: "#be185d" }}
              >
                🛒 {consumers.length} Consumers
                {totalUsers ? " (" + Math.round((consumers.length / totalUsers) * 100) + "%)" : " (0%)"}
              </div>
            </div>
          </section>{/* ===== PENDING APPROVALS ===== */}
          <section className="adm-section" id="adm-approvals">
            <div className="adm-section-head">
              <h2>Pending Approvals</h2>
              <p>Review farmers and delivery partners before approving their accounts.</p>
            </div>

            {loading ? (
              <div className="adm-loading">
                <div className="adm-spinner" />
                Loading users...
              </div>
            ) : pendingUsers.length === 0 ? (
              <div className="adm-empty">
                <div className="adm-empty-icon">🎉</div>
                No pending approvals right now.

              </div>
            ) : (
              <div className="adm-user-list">
                {pendingUsers.map((user) => (
                  <div className="adm-user" key={user.id}>
                    <div className="adm-user-left">
                      <div className="adm-user-icon">{getRoleIcon(user.role)}</div>
                      <div className="adm-user-info">
                        <h3 className="adm-user-name">{user.name || "No Name"}</h3>
                        <p className="adm-user-meta">
                          📧 {user.email || "No email"} · 📱 {user.phone || "No phone"}
                        </p>
                        <div className="adm-pills">
                          <span className="adm-pill role">
                            {getRoleIcon(user.role)} {getRoleName(user.role)}
                          </span>
                          <span className="adm-pill pending">⏳ Pending</span>
                        </div>
                      </div>
                    </div>
                    <div className="adm-actions">
                      <button
                        type="button"
                        className="adm-btn adm-btn-approve"
                        disabled={actionUserId === user.id}
                        onClick={() => updateStatus(user.id, "approved")}
                      >
                        {actionUserId === user.id ? "Updating..." : "✓ Approve"}
                      </button>
                      <button
                        type="button"
                        className="adm-btn adm-btn-reject"
                        disabled={actionUserId === user.id}
                        onClick={() => updateStatus(user.id, "rejected")}
                      >
                        {actionUserId === user.id ? "Updating..." : "✕ Reject"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>{/* ===== ALL USERS ===== */}
          <section className="adm-section" id="adm-users">
            <div className="adm-section-head">
              <h2>All Registered Users</h2>
              <p>Search and manage every account registered in your E-Farm system.</p>
            </div>

            <div className="adm-toolbar">
              <input
                type="text"
                className="adm-search"
                placeholder="🔎 Search by name, email, phone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <select
                className="adm-select"
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value)}
              >
                <option value="all">All Roles</option>
                <option value="farmer">👨‍🌾 Farmers</option>
                <option value="delivery">🚚 Delivery</option>
                <option value="consumer">🛒 Consumers</option>
              </select>
              <select
                className="adm-select"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="all">All Status</option>
                <option value="pending">⏳ Pending</option>
                <option value="approved">✅ Approved</option>
                <option value="rejected">❌ Rejected</option>
                <option value="suspended">🚫 Suspended</option>
              </select>
              <button
                type="button"
                className="adm-btn adm-btn-purge"
                disabled={purging}
                onClick={purgeE2EUsers}
                title="Delete all throwaway E2E test accounts (emails starting with e2e.)"
              >
                {purging ? "🧹 Purging..." : "🧹 Purge E2E test users"}
              </button>
            </div>

            {loading ? (
              <div className="adm-loading">
                <div className="adm-spinner" />
                Loading users...
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="adm-empty">
                <div className="adm-empty-icon">🔍</div>
                No users found.

              </div>
            ) : (
              <div className="adm-user-list">
                {filteredUsers.map((user) => (
                  <div className="adm-user" key={user.id}>
                    <div className="adm-user-left">
                      <div className="adm-user-icon">{getRoleIcon(user.role)}</div>
                      <div className="adm-user-info">
                        <h3 className="adm-user-name">{user.name || "No Name"}</h3>
                        <p className="adm-user-meta">
                          📧 {user.email || "No email"} · 📱 {user.phone || "No phone"}
                        </p>
                        <div className="adm-pills">
                          <span className="adm-pill role">
                            {getRoleIcon(user.role)} {getRoleName(user.role)}
                          </span>
                          <span className={"adm-pill " + getStatusClass(user.status)}>
                            {getStatusText(user)}
                          </span>
                        </div>
                        {user.status === "suspended" && user.suspendedUntil && (
                          <p className="adm-suspend-note">
                            ⏰ Suspended until: {new Date(user.suspendedUntil).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="adm-actions">
                      {user.status !== "approved" && user.status !== "suspended" && (
                        <button
                          type="button"
                          className="adm-btn adm-btn-approve"
                          disabled={actionUserId === user.id}
                          onClick={() => updateStatus(user.id, "approved")}
                        >
                          {actionUserId === user.id ? "Updating..." : "✓ Approve"}
                        </button>
                      )}
                      {user.status !== "rejected" && user.status !== "suspended" && (
                        <button
                          type="button"
                          className="adm-btn adm-btn-reject"
                          disabled={actionUserId === user.id}
                          onClick={() => updateStatus(user.id, "rejected")}
                        >
                          {actionUserId === user.id ? "Updating..." : "✕ Reject"}
                        </button>
                      )}
                      {user.status === "approved" && (
                        <button
                          type="button"
                          className="adm-btn adm-btn-suspend"
                          disabled={actionUserId === user.id}
                          onClick={() => suspendUser(user)}
                        >
                          {actionUserId === user.id ? "Suspending..." : "🚫 Suspend"}
                        </button>
                      )}
                      {user.status === "suspended" && (
                        <button
                          type="button"
                          className="adm-btn adm-btn-unsuspend"
                          disabled={actionUserId === user.id}
                          onClick={() => unsuspendUser(user)}
                        >
                          {actionUserId === user.id ? "Updating..." : "✓ Unsuspend"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && (
              <p className="adm-result-count">
                Showing {filteredUsers.length} of {users.length} users
              </p>
            )}
          </section>{/* ===== ACCOUNT SUMMARY ===== */}
          <section className="adm-section" id="adm-summary">
            <div className="adm-section-head">
              <h2>Account Summary</h2>
              <p>Current account status across your platform.</p>
            </div>

            <div className="adm-summary-grid">
              <div
                className="adm-summary-tile"
                style={{ background: "#f0fdf4", borderColor: "#d9f3df" }}
              >
                <div className="adm-summary-icon">✅</div>
                <div className="adm-summary-label">APPROVED</div>
                <div className="adm-summary-value">{approvedUsers.length}</div>
              </div>

              <div
                className="adm-summary-tile"
                style={{ background: "#fff8e5", borderColor: "#f8e7b3" }}
              >
                <div className="adm-summary-icon">⏳</div>
                <div className="adm-summary-label">PENDING</div>
                <div className="adm-summary-value">{pendingUsers.length}</div>
              </div>

              <div
                className="adm-summary-tile"
                style={{ background: "#fff1f1", borderColor: "#f7d5d5" }}
              >
                <div className="adm-summary-icon">❌</div>
                <div className="adm-summary-label">REJECTED</div>
                <div className="adm-summary-value">{rejectedUsers.length}</div>
              </div>

              <div
                className="adm-summary-tile"
                style={{ background: "#fff7ed", borderColor: "#fed7aa" }}
              >
                <div className="adm-summary-icon">🚫</div>
                <div className="adm-summary-label">SUSPENDED</div>
                <div className="adm-summary-value">{suspendedUsers.length}</div>
              </div>
            </div>
          </section>

          {/* ===== SUPPORT INBOX ===== */}
          <section className="adm-section" id="adm-support">
            <div className="adm-section-head">
              <h2>💬 Support Inbox</h2>
              <p>
                Problems, opinions and complaints from farmers, consumers and
                delivery partners. Select a conversation to read and reply.
              </p>
            </div>

            <div className="adm-sup-grid">
              <div className="adm-sup-list">
                {threads.length === 0 && (
                  <div className="adm-sup-empty">
                    No support conversations yet. When a user opens the 💬 chat
                    widget, their conversation appears here.
                  </div>
                )}
                {threads.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={"adm-sup-thread" + (t.id === openThreadId ? " on" : "")}
                    onClick={() => setOpenThreadId(t.id)}
                  >
                    <div className="adm-sup-thread-top">
                      <span className="adm-sup-name">{t.userName || "User"}</span>
                      <span className={"adm-sup-role r-" + (t.userRole || "user")}>
                        {t.userRole || "user"}
                      </span>
                      {t.status === "resolved" ? (
                        <span className="adm-sup-res">resolved</span>
                      ) : (
                        <span className="adm-sup-open">open</span>
                      )}
                    </div>
                    <div className="adm-sup-last">
                      {t.lastSender === "admin" ? "You: " : ""}
                      {t.lastMessage || "No messages yet"}
                    </div>
                    <div className="adm-sup-meta">
                      {t.userEmail || ""}
                      {t.lastMessageAt?.seconds
                        ? " • " +
                          new Date(t.lastMessageAt.seconds * 1000).toLocaleString("en-IN", {
                            day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                          })
                        : ""}
                    </div>
                  </button>
                ))}
              </div>

              <div className="adm-sup-chat">
                {!openThread ? (
                  <div className="adm-sup-empty tall">
                    Select a conversation from the left to read messages and
                    reply as Admin. 💬
                  </div>
                ) : (
                  <>
                    <div className="adm-sup-chathead">
                      <div>
                        <div className="adm-sup-name">{openThread.userName}</div>
                        <div className="adm-sup-meta">
                          {openThread.userEmail || "no email"}
                          {openThread.userPhone ? " • " + openThread.userPhone : ""}
                          {" • "}
                          {openThread.userRole || "user"}
                        </div>
                      </div>
                      <div className="adm-sup-chathead-btns">
                        {openThread.status !== "resolved" ? (
                          <button
                            type="button"
                            className="adm-btn adm-btn-suspend"
                            onClick={() => setThreadStatus(openThread, "resolved")}
                          >
                            ✓ Mark resolved
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="adm-btn adm-btn-approve"
                            onClick={() => setThreadStatus(openThread, "open")}
                          >
                            ↺ Reopen
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="adm-sup-msgs">
                      {threadMsgs.map((m) => (
                        <div
                          key={m.id}
                          className={"adm-sup-msg " + (m.sender === "admin" ? "me" : "them")}
                        >
                          <div className="adm-sup-bubble">
                            {m.complaint && <div className="adm-sup-flag">⚠️ Formal complaint</div>}
                            {m.text}
                            <div className="adm-sup-time">
                              {m.createdAt?.seconds
                                ? new Date(m.createdAt.seconds * 1000).toLocaleString("en-IN", {
                                    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                                  })
                                : ""}
                            </div>
                          </div>
                        </div>
                      ))}
                      {threadMsgs.length === 0 && (
                        <div className="adm-sup-empty">No messages in this conversation.</div>
                      )}
                    </div>

                    <div className="adm-sup-reply">
                      <input
                        value={adminReply}
                        placeholder="Type your reply as Admin…"
                        onChange={(e) => setAdminReply(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") sendAdminReply(); }}
                      />
                      <button
                        type="button"
                        onClick={sendAdminReply}
                        disabled={sendingReply || !adminReply.trim()}
                      >
                        {sendingReply ? "…" : "Send ➤"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* ===== COMPLAINTS ===== */}
          <section className="adm-section" id="adm-complaints">
            <div className="adm-section-head">
              <h2>⚠️ Complaints</h2>
              <p>
                Formal complaints filed against farmers or delivery partners —
                with their email and mobile so you can identify and take action.
              </p>
            </div>

            {complaints.length === 0 && (
              <div className="adm-sup-empty">No complaints filed yet. 🎉</div>
            )}

            {complaints.map((c) => (
              <div className="adm-complaint" key={c.id}>
                <div className="adm-complaint-head">
                  <span className={"adm-sup-role r-" + (c.againstType === "delivery" ? "delivery" : "farmer")}>
                    {c.againstType === "delivery" ? "🚚 Delivery Partner" : "👨‍🌾 Farmer"}
                  </span>
                  <b>{c.againstName}</b>
                  <select
                    value={c.status || "pending"}
                    onChange={(e) => updateComplaint(c.id, { status: e.target.value })}
                  >
                    <option value="pending">⏳ Pending</option>
                    <option value="reviewing">🔍 Reviewing</option>
                    <option value="resolved">✅ Resolved</option>
                  </select>
                </div>

                <div className="adm-complaint-desc">{c.description}</div>

                <div className="adm-complaint-grid">
                  <div>
                    <label>Complaint by</label>
                    {c.filedByName || "—"} ({c.filedByRole || "user"})
                    <br />
                    {c.filedByEmail || ""}
                  </div>
                  <div>
                    <label>Against — email</label>
                    {c.againstEmail || "—"}
                  </div>
                  <div>
                    <label>Against — mobile</label>
                    {c.againstPhone || "—"}
                  </div>
                  <div>
                    <label>Order ref</label>
                    {c.orderRef || "—"}
                  </div>
                </div>

                <div className="adm-complaint-note">
                  <input
                    placeholder="Admin note / action taken…"
                    value={noteEdits[c.id] ?? c.adminNote ?? ""}
                    onChange={(e) =>
                      setNoteEdits((prev) => ({ ...prev, [c.id]: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="save"
                    onClick={() =>
                      updateComplaint(c.id, {
                        adminNote: noteEdits[c.id] ?? c.adminNote ?? "",
                      })
                    }
                  >
                    💾 Save note
                  </button>
                  <button
                    type="button"
                    className="find"
                    onClick={() => findComplainedUser(c.againstEmail || c.againstName)}
                  >
                    🔎 Find in Users
                  </button>
                </div>
              </div>
            ))}
          </section>

          {/* ===== REFRESH ===== */}
          <div className="adm-refresh-area">
            <button
              type="button"
              className="adm-refresh"
              onClick={loadUsers}
              disabled={loading}
            >
              🔄 {loading ? "Refreshing..." : "Refresh Users"}
            </button>
          </div>

        </main>
      </div>
    </>
  );
}

export default AdminDashboard;