import { useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../firebase/config";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  calcDeliveryEarnings,
  DELIVERY_RATES,
  DELIVERY_RANGE_KM,
  MIN_ORDER_VALUE,
  rupee,
} from "./deliveryEarnings";
import SupportChat from "../components/SupportChat";

function DeliveryDashboard() {
  const [availableOrders, setAvailableOrders] = useState([]);
  const [myDeliveries, setMyDeliveries] = useState([]);
  const [completedOrders, setCompletedOrders] = useState([]);

  const [loading, setLoading] = useState(true);
  const [actionOrderId, setActionOrderId] = useState("");
  const [clearingHistory, setClearingHistory] = useState(false);
  const [userName, setUserName] = useState("");
  const [dutyOnline, setDutyOnline] = useState(true);
  const [cancelledCount, setCancelledCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeNav, setActiveNav] = useState("dashboard");
  const [view, setView] = useState("dashboard");

  /* Fresh farm locations (users/{farmerId}.location) for the
     farmers behind the loaded orders. An order's farmLocation
     snapshot is frozen at checkout — if the farmer later fixes
     a wrong location, the stale snapshot kept every distance
     wrong (e.g. 504 km) and pushed genuinely-local trips out of
     the 7 km range. These overrides make every card and the
     accept flow measure from the farm's CURRENT location.     */
  const [farmerLocs, setFarmerLocs] = useState({});
  const farmerLocsTried = useRef(new Set());

  const auth = getAuth();

    // =========================================================
  // LOCATION HELPERS
  // =========================================================

  const getLocation = (order, type) => {
  if (type === "farmer") {
      return (
        order.farmLocation ||
        order.farmAnchor ||
        order.farmerLocation ||
        order.farmerAddress ||
        order.farmAddress ||
        order.farmer?.location ||
        order.farmer?.address ||
        order.sellerLocation ||
        order.sellerAddress ||
        order.seller?.location ||
        order.seller?.address ||
        order.pickupLocation ||
        order.pickupAddress ||
        ""
      );
    }

    return (
      order.consumerLocation ||
      order.consumerAddress ||
      order.customerLocation ||
      order.customerAddress ||
      order.deliveryLocation ||
      order.deliveryAddress ||
      order.address ||
      order.consumer?.location ||
      order.consumer?.address ||
      order.customer?.location ||
      order.customer?.address ||
      ""
        );
  };

  const getLatitude = (order, type) => {
    if (type === "farmer") {
      return (
        order.farmLocation?.latitude ??
        order.farmAnchor?.latitude ??
        order.farmPickup?.latitude ??
        order.farmerLatitude ??
        order.farmerLat ??
        order.farmer?.latitude ??
        order.farmer?.lat ??
        order.pickupLatitude ??
        order.pickupLat ??
        order.farmerLocation?.latitude ??
        order.farmerLocation?.lat ??
        null
      );
    }

    return (
      order.consumerLatitude ??
      order.consumerLat ??
      order.customerLatitude ??
      order.customerLat ??
      order.consumer?.latitude ??
      order.consumer?.lat ??
      order.customer?.latitude ??
      order.customer?.lat ??
      order.deliveryLatitude ??
      order.deliveryLat ??
      order.location?.latitude ??
      order.location?.lat ??
      null
    );
  };

  const getLongitude = (order, type) => {
    if (type === "farmer") {
      return (
        order.farmLocation?.longitude ??
        order.farmLocation?.lng ??
        order.farmAnchor?.longitude ??
        order.farmAnchor?.lng ??
        order.farmPickup?.longitude ??
        order.farmPickup?.lng ??
        order.farmerLongitude ??
        order.farmerLng ??
        order.farmer?.longitude ??
        order.farmer?.lng ??
        order.pickupLongitude ??
        order.pickupLng ??
        order.farmerLocation?.longitude ??
        order.farmerLocation?.lng ??
        null
      );
    }

    return (
      order.consumerLongitude ??
      order.consumerLng ??
      order.customerLongitude ??
      order.customerLng ??
      order.consumer?.longitude ??
      order.consumer?.lng ??
      order.customer?.longitude ??
      order.customer?.lng ??
      order.deliveryLongitude ??
      order.deliveryLng ??
      order.location?.longitude ??
      order.location?.lng ??
      null
    );
  };

  const getLocationText = (order, type) => {
    const latitude = getLatitude(order, type);
    const longitude = getLongitude(order, type);

    if (
      latitude !== null &&
      latitude !== undefined &&
      longitude !== null &&
      longitude !== undefined
    ) {
      return `${latitude}, ${longitude}`;
    }

    const location = getLocation(order, type);

    if (typeof location === "string") {
      return location || "Location not provided";
    }

    if (location && typeof location === "object") {
      if (
        location.latitude !== undefined &&
        location.longitude !== undefined
      ) {
        return `${location.latitude}, ${location.longitude}`;
      }

      if (
        location.lat !== undefined &&
        location.lng !== undefined
      ) {
        return `${location.lat}, ${location.lng}`;
      }

      return (
        location.address ||
        location.name ||
        "Location not provided"
      );
    }

    return "Location not provided";
  };

  // =========================================================
  // GOOGLE MAPS
  // =========================================================

  const openGoogleMaps = (order, type) => {
    const latitude = getLatitude(order, type);
    const longitude = getLongitude(order, type);

    let destination = "";

    if (
      latitude !== null &&
      latitude !== undefined &&
      longitude !== null &&
      longitude !== undefined
    ) {
      destination = `${latitude},${longitude}`;
    } else {
      const location = getLocation(order, type);

      if (typeof location === "string") {
        destination = location;
      } else if (
        location &&
        typeof location === "object"
      ) {
        if (
          location.latitude !== undefined &&
          location.longitude !== undefined
        ) {
          destination = `${location.latitude},${location.longitude}`;
        } else if (
          location.lat !== undefined &&
          location.lng !== undefined
        ) {
          destination = `${location.lat},${location.lng}`;
        } else {
          destination =
            location.address ||
            location.name ||
            "";
        }
      }
    }

    if (!destination) {
      alert(
        `${
          type === "farmer"
            ? "Farmer"
            : "Consumer"
        } location is not available.`
      );

      return;
    }

    const url =
      "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(destination);

    window.open(
      url,
      "_blank",
      "noopener,noreferrer"
    );
  };

  // =========================================================
  // ORDER TOTAL
  // =========================================================

  const getOrderTotal = (order) => {
    const total = Number(order.totalAmount);

    if (
      Number.isFinite(total) &&
      total > 0
    ) {
      return total;
    }

    const price = Number(order.price) || 0;
    const quantity =
      Number(order.quantity) || 0;

    return price * quantity;
  };

  // =========================================================
  // ORDER DETAIL HELPERS — "every basic detail" on the card
  // =========================================================

  /* Normalize whatever is on the order into a list of
     { name, category, qty, price } — cart orders carry an
     items[] array, single-product orders carry flat fields. */
  const orderItemsOf = (order) => {
    if (Array.isArray(order.items) && order.items.length > 0) {
      return order.items.map((it, i) => ({
        name: it.productName || it.name || `Item ${i + 1}`,
        category: it.category || "",
        qty: Number(it.quantity ?? it.qty ?? 1) || 1,
        price: Number(it.price ?? 0) || 0,
      }));
    }
    return [
      {
        name: order.productName || "Agri Product",
        category: order.category || "",
        qty: Number(order.quantity ?? 1) || 1,
        price: Number(order.price ?? 0) || 0,
      },
    ];
  };

  const orderItemCount = (order) => {
    if (Array.isArray(order.items) && order.items.length > 0) {
      return Number(order.itemCount) || order.items.length;
    }
    return Number(order.quantity) || 1;
  };

  const consumerPhoneOf = (order) =>
    order.consumerPhone ||
    order.customerPhone ||
    order.phone ||
    "—";

  const deliveryAddressText = (order) => {
    const street =
      order.deliveryAddress || order.address;
    const city = order.city;
    const pin = order.pincode;
    const parts = [street, city, pin].filter(
      (v) => v && String(v).trim()
    );
    if (parts.length > 0) return parts.join(", ");
    return getLocationText(order, "consumer") || "Address not provided";
  };

  const paymentMethodOf = (order) =>
    order.paymentMethod || "Cash on Delivery";

  // =========================================================
  // FORMAT DATE
  // =========================================================

  const formatDate = (value) => {
    if (!value) {
      return "N/A";
    }

    try {
      if (
        value &&
        typeof value.toDate === "function"
      ) {
        return value
          .toDate()
          .toLocaleString();
      }

      return new Date(value).toLocaleString();
    } catch {
      return "N/A";
    }
  };

  // =========================================================
  // LOAD ORDERS
  // =========================================================

  // Shared state-builder: turns a raw orders array (from a one-off
  // getDocs OR a real-time onSnapshot) into every dashboard section.
  // One place for the filters so the live listener and the manual
  // refresh can never drift apart.
  const applyOrders = (allOrders) => {
    setCancelledCount(
      allOrders.filter(
        (order) =>
          order.status === "cancelled" ||
          order.deliveryStatus === "cancelled"
      ).length
    );

    // -----------------------------------------------------
    // AVAILABLE ORDERS
    // An order lands here the moment the farmer accepts it
    // (status === "accepted") — or if it is explicitly marked
    // deliveryStatus "available" — until a delivery partner
    // claims it.
    // -----------------------------------------------------

    const available = allOrders.filter((order) => {
      const farmerAccepted = order.status === "accepted";
      const explicitlyAvailable =
        order.deliveryStatus === "available";
      const alreadyAssigned = !!order.deliveryPersonId;
      const alreadyAccepted =
        order.deliveryStatus === "accepted";
      const alreadyDelivered =
        order.deliveryStatus === "delivered" ||
        order.deliveryStatus === "completed";
      const cancelled =
        order.status === "cancelled" ||
        order.deliveryStatus === "cancelled";

      if (cancelled) return false;
      if (alreadyAssigned) return false;
      if (alreadyAccepted) return false;
      if (alreadyDelivered) return false;

      return farmerAccepted || explicitlyAvailable;
    });

    // Refresh the fresh-farm-location cache for the farmers
    // behind these orders (used as the pickup override below).
    enrichFarmerLocations(allOrders);

    setAvailableOrders(available);

    // -----------------------------------------------------
    // MY ORDERS
    // -----------------------------------------------------

    if (auth.currentUser) {
      const mine = allOrders.filter(
        (order) =>
          order.deliveryPersonId === auth.currentUser.uid
      );

      const completed = mine.filter(
        (order) =>
          order.deliveryStatus === "delivered" ||
          order.deliveryStatus === "completed"
      );

      const active = mine.filter(
        (order) =>
          order.deliveryStatus !== "delivered" &&
          order.deliveryStatus !== "completed"
      );

      console.log("MY ACTIVE DELIVERIES:", active.length);
      console.log("COMPLETED HISTORY:", completed.length);

      setMyDeliveries(active);
      setCompletedOrders(completed);
    } else {
      setMyDeliveries([]);
      setCompletedOrders([]);
    }
  };

  const loadOrders = async () => {
    try {
      setLoading(true);

      console.log("DELIVERY DASHBOARD: loading orders…");

      const snapshot = await getDocs(
        collection(db, "orders")
      );

      const allOrders =
        snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));

      console.log("TOTAL ORDERS:", allOrders.length);

      applyOrders(allOrders);
    } catch (error) {
      console.error(
        "ERROR LOADING DELIVERY ORDERS:",
        error
      );

      alert(
        "Unable to load orders. Please check your Firestore rules."
      );

      setAvailableOrders([]);
      setMyDeliveries([]);
      setCompletedOrders([]);
    } finally {
      setLoading(false);
    }
  };

  // =========================================================
  // INITIAL LOAD + REAL-TIME SYNC
  //
  // The orders collection is watched with onSnapshot, so the
  // moment a farmer accepts an order (status -> "accepted")
  // it appears here INSTANTLY — no waiting on the old 10s
  // poll and no manual refresh.
  //
  // The listener is attached only after the auth session is
  // ready: Firestore rules require request.auth, so reading
  // before the session restored would fail permission-denied.
  // =========================================================

  useEffect(() => {
    let unsubOrders = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      // Detach any previous orders listener first.
      if (unsubOrders) {
        unsubOrders();
        unsubOrders = null;
      }

      if (!user) {
        applyOrders([]);
        setLoading(false);
        return;
      }

      // One-off first paint, then live updates.
      loadOrders();

      unsubOrders = onSnapshot(
        collection(db, "orders"),
        (snapshot) => {
          applyOrders(
            snapshot.docs.map((item) => ({
              id: item.id,
              ...item.data(),
            }))
          );
          setLoading(false);
        },
        (error) => {
          console.error(
            "ORDERS LIVE LISTENER ERROR:",
            error
          );
        }
      );
    });

    return () => {
      if (unsubOrders) unsubOrders();
      unsubAuth();
    };
  }, []);

  // =========================================================
  // FRESH FARM LOCATIONS (pickup override)
  //
  // Resolves each order's farmer profile LIVE so distances and
  // the 7 km range check use the farm's CURRENT saved location
  // instead of the checkout-time farmLocation snapshot.
  // =========================================================

  const orderFarmerUid = (order) =>
    order?.farmerId ||
    (Array.isArray(order?.farmerIds) ? order.farmerIds[0] : null) ||
    null;

  const freshPickup = (order) =>
    farmerLocs[orderFarmerUid(order)] || null;

  const enrichFarmerLocations = (orders) => {
    const uids = new Set();
    (orders || []).forEach((o) => {
      const uid = orderFarmerUid(o);
      if (uid && !farmerLocsTried.current.has(uid)) {
        uids.add(uid);
      }
    });
    if (uids.size === 0) return;

    // Mark attempted first — never refetch on every snapshot.
    uids.forEach((uid) => farmerLocsTried.current.add(uid));

    uids.forEach((uid) => {
      getDoc(doc(db, "users", uid))
        .then((snap) => {
          const loc = snap.exists() ? snap.data().location : null;
          const lat = Number(loc?.latitude);
          const lng = Number(loc?.longitude);
          if (
            Number.isFinite(lat) && lat !== 0 &&
            Number.isFinite(lng) && lng !== 0
          ) {
            setFarmerLocs((prev) => ({
              ...prev,
              [uid]: { latitude: lat, longitude: lng },
            }));
          }
        })
        .catch(() => {
          /* measurement falls back to the order snapshot */
        });
    });
  };

  // =========================================================
  // ACCEPT ORDER
  // =========================================================

  const acceptOrder = async (order, opts = {}) => {
    if (!auth.currentUser) {
      alert(
        "Please login as a delivery partner first."
      );

      return;
    }

    /* Explicit override for trips outside the 7 km service
       range — real-world demo accounts are often hundreds of
       km apart, so the partner can consciously accept anyway.
       The real distance stays visible on the order card.       */
    if (opts.ignoreDistance) {
      const kmText =
        opts.km != null
          ? `${opts.km} km`
          : "an unknown distance";

      const ok = window.confirm(
        `⚠️ This trip is ${kmText} — beyond the ${DELIVERY_RANGE_KM} km service range.\n\nAccept it anyway?`
      );

      if (!ok) return;
    }

    const deliveryPerson =
      auth.currentUser;

    /* Captured inside the transaction and read after it commits.
       (It used to be declared with const inside the transaction
       callback and referenced out here — a ReferenceError crashed
       the flow right after the order was successfully claimed,
       so the dashboard never refreshed.) */
    let estimate = null;

    try {
      setActionOrderId(order.id);

      const orderRef = doc(
        db,
        "orders",
        order.id
      );

      await runTransaction(
        db,
        async (transaction) => {
          const orderSnapshot =
            await transaction.get(
              orderRef
            );

          if (!orderSnapshot.exists()) {
            throw new Error(
              "Order does not exist."
            );
          }

          const currentOrder =
            orderSnapshot.data();

          if (
            currentOrder.deliveryPersonId
          ) {
            throw new Error(
              "This order has already been assigned to another delivery partner."
            );
          }

          const farmerAccepted =
            currentOrder.status ===
            "accepted";

          const deliveryAvailable =
            currentOrder.deliveryStatus ===
            "available";

          if (
            !farmerAccepted &&
            !deliveryAvailable
          ) {
            throw new Error(
              "This order is not ready for delivery yet."
            );
          }

          // Lock in the partner's estimated earning for this trip
          // at accept time (see deliveryEarnings.js for the model).
          // Measured from the farmer's CURRENT profile location —
          // not the possibly-stale farmLocation checkout snapshot.
          estimate = calcDeliveryEarnings(currentOrder, {
            pickupOverride: freshPickup(currentOrder),
          });

          // Range rule: the delivery trip should start within
          // DELIVERY_RANGE_KM of the farmer location. The partner
          // can override with an explicit "Accept Anyway" (opts.
          // ignoreDistance) — demo accounts are often in different
          // cities. The distance is stored on the order either way.
          if (estimate.distanceKm == null) {
            if (!opts.ignoreDistance) {
              throw new Error(
                "Pickup coordinates are missing on this order — the trip distance and the 7 km delivery range cannot be verified. Use \"Accept Anyway\" to override, or have the farmer re-accept with GPS."
              );
            }
          } else if (
            estimate.distanceKm > DELIVERY_RANGE_KM &&
            !opts.ignoreDistance
          ) {
            throw new Error(
              `This order is ${estimate.distanceKm} km from the farmer — beyond the ${DELIVERY_RANGE_KM} km delivery range.`
            );
          }

          transaction.update(
            orderRef,
            {
              deliveryStatus:
                "accepted",

              deliveryPersonId:
                deliveryPerson.uid,

              deliveryPersonEmail:
                deliveryPerson.email || "",

              deliveryPersonName:
                deliveryPerson.displayName ||
                deliveryPerson.email ||
                "Delivery Partner",

              acceptedAt:
                serverTimestamp(),

              deliveryCharge:
                estimate.deliveryCharge,

              deliveryDistanceKm:
                estimate.distanceKm,

              deliveryCommission:
                estimate.commission,

              deliveryEarning:
                estimate.totalEarning,

              deliveryEarningBreakdown:
                estimate.breakdown,

              deliveryEarningStatus:
                "estimated",
            }
          );
        }
      );

      alert(
        `✅ Order accepted successfully!\n\n💰 Estimated earning: ${rupee(estimate.totalEarning)}` +
          (opts.ignoreDistance
            ? "\n\n⚠️ Accepted beyond the 7 km service range."
            : "")
      );

      await loadOrders();
    } catch (error) {
      console.error(
        "ERROR ACCEPTING ORDER:",
        error
      );

      alert(
        error.message ||
          "Unable to accept this order."
      );
    } finally {
      setActionOrderId("");
    }
  };

  // =========================================================
  // MARK ORDER AS DELIVERED
  // =========================================================

  const completeDelivery = async (order) => {
    if (!auth.currentUser) {
      alert(
        "Please login as a delivery partner."
      );

      return;
    }

    const confirmed = window.confirm(
      "Are you sure this order has reached the customer successfully?"
    );

    if (!confirmed) {
      return;
    }

    /* Captured inside the transaction and read after it commits
       (same out-of-scope fix as in acceptOrder). */
    let earning = null;

    try {
      setActionOrderId(order.id);

      const orderRef = doc(
        db,
        "orders",
        order.id
      );

      await runTransaction(
        db,
        async (transaction) => {
          const orderSnapshot =
            await transaction.get(
              orderRef
            );

          if (!orderSnapshot.exists()) {
            throw new Error(
              "Order does not exist."
            );
          }

          const currentOrder =
            orderSnapshot.data();

          if (
            currentOrder.deliveryPersonId !==
            auth.currentUser.uid
          ) {
            throw new Error(
              "You are not assigned to this order."
            );
          }

          if (
            currentOrder.deliveryStatus ===
              "delivered" ||
            currentOrder.deliveryStatus ===
              "completed"
          ) {
            throw new Error(
              "This order is already completed."
            );
          }

          // Finalise the partner's earning for this delivery
          // (charge + commission — see deliveryEarnings.js),
          // measured from the farmer's CURRENT profile location.
          earning = calcDeliveryEarnings(currentOrder, {
            pickupOverride: freshPickup(currentOrder),
          });

          transaction.update(
            orderRef,
            {
              deliveryStatus:
                "delivered",

              orderStatus:
                "delivered",

              status:
                "delivered",

              deliveryCompleted: true,

              paymentStatus:
                "completed",

              paymentCompleted: true,

              deliveredAt:
                serverTimestamp(),

              paymentCompletedAt:
                serverTimestamp(),

              deliveryCharge:
                earning.deliveryCharge,

              deliveryDistanceKm:
                earning.distanceKm,

              deliveryCommission:
                earning.commission,

              deliveryEarning:
                earning.totalEarning,

              deliveryEarningBreakdown:
                earning.breakdown,

              deliveryEarningStatus:
                "paid",

              deliveryEarningAt:
                serverTimestamp(),
            }
          );
        }
      );

      alert(
        `✅ Order reached successfully!\n\n💰 Payment completed!\n\n🤑 You earned ${rupee(earning.totalEarning)}\n(🚚 delivery charge + 🤝 farmer commission)\n\n🧾 ${earning.breakdown}`
      );

      await loadOrders();
    } catch (error) {
      console.error(
        "ERROR COMPLETING DELIVERY:",
        error
      );

      alert(
        error.message ||
          "Unable to complete delivery."
      );
    } finally {
      setActionOrderId("");
    }
  };

  // =========================================================
  // CLEAR HISTORY
  //
  // IMPORTANT:
  // We do NOT delete Firestore orders.
  //
  // We only hide completed history from this dashboard
  // using localStorage.
  // =========================================================

  const clearHistory = async () => {
    if (!auth.currentUser) {
      return;
    }

    if (completedOrders.length === 0) {
      alert(
        "There is no completed history to clear."
      );

      return;
    }

    const confirmed = window.confirm(
      "Clear completed delivery history from this dashboard?\n\nThe actual orders and payment records will NOT be deleted from Firestore."
    );

    if (!confirmed) {
      return;
    }

    try {
      setClearingHistory(true);

      const storageKey =
        `deliveryHistoryCleared_${auth.currentUser.uid}`;

      const historyIds =
        completedOrders.map(
          (order) => order.id
        );

      localStorage.setItem(
        storageKey,
        JSON.stringify(historyIds)
      );

      setCompletedOrders([]);

      alert(
        "✅ Completed delivery history cleared from your dashboard."
      );
    } catch (error) {
      console.error(
        "ERROR CLEARING HISTORY:",
        error
      );

      alert(
        "Unable to clear history."
      );
    } finally {
      setClearingHistory(false);
    }
  };

  // =========================================================
  // GET VISIBLE COMPLETED HISTORY
  // =========================================================

  const getVisibleHistory = () => {
    if (!auth.currentUser) {
      return completedOrders;
    }

    const storageKey =
      `deliveryHistoryCleared_${auth.currentUser.uid}`;

    try {
      const cleared =
        JSON.parse(
          localStorage.getItem(
            storageKey
          ) || "[]"
        );

      if (!Array.isArray(cleared)) {
        return completedOrders;
      }

      return completedOrders.filter(
        (order) =>
          !cleared.includes(order.id)
      );
    } catch {
      return completedOrders;
    }
  };

  const visibleHistory =
    getVisibleHistory();

  // Total partner earnings across completed deliveries.
  // Orders delivered before the earnings feature existed fall
  // back to a live calculation so old history still counts.
  const totalEarnings = completedOrders.reduce(
    (sum, order) =>
      sum +
      (Number(order.deliveryEarning) ||
        calcDeliveryEarnings(order, {
          pickupOverride: freshPickup(order),
        }).totalEarning),
    0
  );

  // =========================================================
  // PROFILE, DUTY STATUS & UI STATE
  // =========================================================

  useEffect(() => {
    let alive = true;

    const load = async () => {
      if (!auth.currentUser) {
        return;
      }

      try {
        const snap = await getDoc(
          doc(db, "users", auth.currentUser.uid)
        );

        if (alive && snap.exists()) {
          setUserName(snap.data().name || "");
        }
      } catch (error) {
        console.error("ERROR LOADING PROFILE:", error);
      }

      try {
        const stored = localStorage.getItem(
          `deliveryDuty_${auth.currentUser.uid}`
        );

        if (alive) {
          setDutyOnline(stored !== "offline");
        }
      } catch (error) {
        console.error("ERROR READING DUTY STATUS:", error);
      }
    };

    load();

    return () => {
      alive = false;
    };
  }, []);

  const toggleDuty = () => {
    const next = !dutyOnline;
    setDutyOnline(next);

    try {
      if (auth.currentUser) {
        localStorage.setItem(
          `deliveryDuty_${auth.currentUser.uid}`,
          next ? "online" : "offline"
        );
      }
    } catch (error) {
      console.error("ERROR SAVING DUTY STATUS:", error);
    }
  };

  const go = (id) => {
    setActiveNav(id);
    setSidebarOpen(false);
    setView(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // =========================================================
  // DELIVERY STAGES (progress tracker)
  // =========================================================

  const STAGES = ["accepted", "picked_up", "out_for_delivery", "delivered"];

  const STAGE_LABELS = {
    accepted: "Accepted",
    picked_up: "Picked Up",
    out_for_delivery: "Out for Delivery",
    delivered: "Delivered",
  };

  const stageIndex = (order) => {
    const status =
      order.deliveryStatus === "completed"
        ? "delivered"
        : order.deliveryStatus;

    const index = STAGES.indexOf(status);

    return index < 0 ? 0 : index;
  };

  const updateDeliveryStage = async (order, nextStage) => {
    if (!auth.currentUser) {
      alert("Please login as a delivery partner.");
      return;
    }

    try {
      setActionOrderId(order.id);

      const orderRef = doc(db, "orders", order.id);

      await runTransaction(db, async (transaction) => {
        const orderSnapshot = await transaction.get(orderRef);

        if (!orderSnapshot.exists()) {
          throw new Error("Order does not exist.");
        }

        const current = orderSnapshot.data();

        if (current.deliveryPersonId !== auth.currentUser.uid) {
          throw new Error("You are not assigned to this order.");
        }

        const currentIndex = stageIndex({
          deliveryStatus: current.deliveryStatus,
        });

        const nextIndex = STAGES.indexOf(nextStage);

        if (nextIndex !== currentIndex + 1) {
          throw new Error("This is not the next step for this delivery.");
        }

        const patch = { deliveryStatus: nextStage };

        if (nextStage === "picked_up") {
          patch.pickedUpAt = serverTimestamp();
        }

        if (nextStage === "out_for_delivery") {
          patch.outForDeliveryAt = serverTimestamp();
        }

        transaction.update(orderRef, patch);
      });

      alert(`✅ Marked as "${STAGE_LABELS[nextStage]}".`);

      await loadOrders();
    } catch (error) {
      console.error("ERROR UPDATING DELIVERY STAGE:", error);
      alert(error.message || "Unable to update delivery status.");
    } finally {
      setActionOrderId("");
    }
  };

  // =========================================================
  // DERIVED: NAME, STATS, DONUT, NOTIFICATIONS
  // =========================================================

  const rawName =
    userName ||
    auth.currentUser?.displayName ||
    auth.currentUser?.email?.split("@")[0] ||
    "Partner";

  const firstName = String(rawName).trim().split(/\s+/)[0];

  const todayStr = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const todayDay = new Date().toLocaleDateString("en-US", {
    weekday: "long",
  });

  const inProgressCount = myDeliveries.filter(
    (order) =>
      order.deliveryStatus === "picked_up" ||
      order.deliveryStatus === "out_for_delivery"
  ).length;

  const pendingPickupCount = myDeliveries.length - inProgressCount;

  const earningOfOrder = (order) =>
    Number(order.deliveryEarning) ||
    calcDeliveryEarnings(order, {
      pickupOverride: freshPickup(order),
    }).totalEarning;

  const totalFees = completedOrders.reduce(
    (sum, order) =>
      sum +
      (Number(order.deliveryCharge) ||
        calcDeliveryEarnings(order, {
          pickupOverride: freshPickup(order),
        }).deliveryCharge),
    0
  );

  const totalCommission = completedOrders.reduce(
    (sum, order) =>
      sum +
      (Number(order.deliveryCommission) ||
        calcDeliveryEarnings(order, {
          pickupOverride: freshPickup(order),
        }).commission),
    0
  );

  const toDate = (value) => {
    if (!value) {
      return null;
    }

    const date =
      typeof value.toDate === "function"
        ? value.toDate()
        : new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  };

  const monthKey = (date) => `${date.getFullYear()}-${date.getMonth()}`;

  const nowDate = new Date();
  const thisMonthKey = monthKey(nowDate);
  const lastMonthKey = monthKey(
    new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, 1)
  );

  let monthEarnings = 0;
  let lastMonthEarnings = 0;

  completedOrders.forEach((order) => {
    const delivered = toDate(order.deliveredAt);

    if (!delivered) {
      return;
    }

    const earn = earningOfOrder(order);
    const key = monthKey(delivered);

    if (key === thisMonthKey) {
      monthEarnings += earn;
    } else if (key === lastMonthKey) {
      lastMonthEarnings += earn;
    }
  });

  const growthPct =
    lastMonthEarnings > 0
      ? Math.round(
          ((monthEarnings - lastMonthEarnings) / lastMonthEarnings) * 100
        )
      : null;

  // ---- DONUT (Delivery Summary) ----

  const donutData = [
    { label: "Completed", count: completedOrders.length, color: "#22c55e" },
    { label: "In Progress", count: inProgressCount, color: "#f97316" },
    { label: "Pending", count: pendingPickupCount, color: "#facc15" },
    { label: "Cancelled", count: cancelledCount, color: "#ef4444" },
  ].filter((part) => part.count > 0);

  const donutTotal = donutData.reduce((sum, part) => sum + part.count, 0);

  let donutAcc = 0;

  const donutStops = donutData.map((part) => {
    const start = (donutAcc / donutTotal) * 100;
    donutAcc += part.count;
    const end = (donutAcc / donutTotal) * 100;
    return `${part.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });

  const donutStyle =
    donutTotal > 0
      ? { background: `conic-gradient(${donutStops.join(", ")})` }
      : null;

  // ---- NOTIFICATIONS ----

  const toMs = (value) => {
    const date = toDate(value);
    return date ? date.getTime() : 0;
  };

  const notifications = [];

  availableOrders.slice(0, 3).forEach((order) => {
    notifications.push({
      icon: "🆕",
      tone: "green",
      text: `Order #${order.orderNumber || order.id.slice(0, 8)} is available to accept.`,
      time: order.createdAt,
    });
  });

  myDeliveries.forEach((order) => {
    notifications.push({
      icon: "🚚",
      tone: "blue",
      text: `Order #${order.orderNumber || order.id.slice(0, 8)} assigned to you.`,
      time: order.acceptedAt || order.createdAt,
    });
  });

  visibleHistory.slice(0, 3).forEach((order) => {
    notifications.push({
      icon: "✅",
      tone: "green",
      text: `Order #${order.orderNumber || order.id.slice(0, 8)} reached the consumer — you earned ${rupee(earningOfOrder(order))}.`,
      time: order.deliveredAt,
    });
  });

  notifications.sort((a, b) => toMs(b.time) - toMs(a.time));

  const recentNotifications = notifications.slice(0, 5);

  const bellCount = notifications.filter(
    (item) => Date.now() - toMs(item.time) < 86400000
  ).length;

  const timeAgo = (value) => {
    const date = toDate(value);

    if (!date) {
      return "";
    }

    const seconds = Math.max(
      1,
      Math.floor((Date.now() - date.getTime()) / 1000)
    );

    if (seconds < 60) {
      return "just now";
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;

    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  };

  const NAV = [
    { id: "dashboard", icon: "🏠", label: "Dashboard" },
    { id: "available", icon: "📦", label: "Available Orders" },
    { id: "my", icon: "🚚", label: "My Deliveries" },
    { id: "history", icon: "🕒", label: "Delivery History" },
    { id: "earnings", icon: "💰", label: "Earnings" },
    { id: "notifications", icon: "🔔", label: "Notifications" },
    { id: "settings", icon: "⚙️", label: "Settings" },
  ];

  // =========================================================
  // STYLES
  // =========================================================

  const styles = `
    * {
      box-sizing: border-box;
    }

    .dlv-app {
      display: flex;
      min-height: 100vh;
      background: #f5f7f6;
      color: #16211a;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    /* ---------------- SIDEBAR ---------------- */

    .dlv-sidebar {
      width: 250px;
      flex-shrink: 0;
      position: sticky;
      top: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 16px 13px;
      background: linear-gradient(180deg, #0c3a20 0%, #11402a 55%, #0d3520 100%);
      overflow-y: auto;
      z-index: 50;
    }

    .dlv-brand {
      display: flex;
      align-items: center;
      gap: 11px;
      padding: 4px 6px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.09);
    }

    .dlv-brand-logo {
      width: 40px;
      height: 40px;
      border-radius: 11px;
      background: #22c55e;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 6px 16px rgba(34, 197, 94, 0.35);
    }

    .dlv-brand-name { color: #ffffff; font-size: 18px; font-weight: 800; }
    .dlv-brand-sub { color: #93c4a3; font-size: 11.5px; margin-top: 1px; }

    .dlv-nav {
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin-top: 14px;
    }

    .dlv-nav button {
      display: flex;
      align-items: center;
      gap: 11px;
      width: 100%;
      padding: 11px 13px;
      border: none;
      border-radius: 10px;
      background: transparent;
      color: #cfe3d6;
      font-family: inherit;
      font-size: 13.5px;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }

    .dlv-nav button:hover { background: rgba(255, 255, 255, 0.07); color: #ffffff; }

    .dlv-nav button.active {
      background: #16a34a;
      color: #ffffff;
      box-shadow: 0 8px 18px rgba(22, 163, 74, 0.4);
    }

    .dlv-nav-ico { font-size: 15px; width: 20px; text-align: center; }

    .dlv-nav-badge {
      margin-left: auto;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      background: #ef4444;
      color: #ffffff;
      font-size: 10.5px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .dlv-side-profile {
      margin-top: auto;
      padding: 14px;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .dlv-side-avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #dcfce7;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 21px;
      margin-bottom: 9px;
    }

    .dlv-side-name { color: #ffffff; font-size: 14.5px; font-weight: 800; }
    .dlv-side-role { color: #9dc3aa; font-size: 11.5px; margin-top: 1px; }

    .dlv-side-status {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #b9d6c2;
      font-size: 11.5px;
      font-weight: 700;
      margin-top: 7px;
    }

    .dlv-dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7f70; }
    .dlv-dot.on { background: #22c55e; box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.22); }

    .dlv-duty-btn {
      width: 100%;
      margin-top: 11px;
      padding: 10px 0;
      border: none;
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.92);
      color: #0c3a20;
      font-family: inherit;
      font-size: 12.5px;
      font-weight: 800;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.15s ease;
    }

    .dlv-duty-btn:hover { background: #ffffff; transform: translateY(-1px); }

    .dlv-scrim { display: none; }
    /* ---------------- TOPBAR ---------------- */

    .dlv-main { flex: 1; min-width: 0; max-width: 1480px; margin: 0 auto; padding: 20px 26px 46px; }

    .dlv-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 18px;
    }

    .dlv-burger {
      display: none;
      width: 41px;
      height: 41px;
      border: 1px solid #e0e9e2;
      border-radius: 11px;
      background: #ffffff;
      font-size: 17px;
      cursor: pointer;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .dlv-welcome { margin: 0; color: #5f6f64; font-size: 13.5px; font-weight: 600; }
    .dlv-topbar h1 { margin: 3px 0 4px; color: #141d16; font-size: 26px; font-weight: 900; }
    .dlv-topbar-sub { margin: 0; color: #75827a; font-size: 13.5px; }

    .dlv-topbar-right { display: flex; align-items: center; gap: 11px; flex-shrink: 0; }

    .dlv-bell {
      position: relative;
      width: 42px;
      height: 42px;
      border: 1px solid #e0e9e2;
      border-radius: 12px;
      background: #ffffff;
      font-size: 17px;
      cursor: pointer;
    }

    .dlv-bell-badge {
      position: absolute;
      top: -5px;
      right: -5px;
      min-width: 18px;
      height: 18px;
      padding: 0 4px;
      border-radius: 999px;
      background: #ef4444;
      border: 2px solid #ffffff;
      color: #ffffff;
      font-size: 10px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .dlv-datecard {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      background: #ffffff;
      border: 1px solid #e0e9e2;
      border-radius: 12px;
    }

    .dlv-datecard-ico { font-size: 18px; }
    .dlv-datecard-date { font-size: 13.5px; font-weight: 800; color: #141d16; white-space: nowrap; }
    .dlv-datecard-day { font-size: 11.5px; color: #75827a; }

    .dlv-offline-banner {
      margin-bottom: 16px;
      padding: 12px 16px;
      border-radius: 12px;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      color: #9a3412;
      font-size: 13.5px;
      font-weight: 600;
    }

    /* ---------------- STATS ---------------- */

    .dlv-stats {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 13px;
      margin-bottom: 18px;
    }

    .dlv-stat {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 15px 16px;
      background: #ffffff;
      border: 1px solid #e4ece6;
      border-radius: 14px;
      box-shadow: 0 6px 18px rgba(20, 40, 26, 0.04);
    }

    .dlv-stat-ico {
      width: 46px;
      height: 46px;
      border-radius: 13px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      flex-shrink: 0;
    }

    .dlv-stat-ico.green { background: #dcfce7; }
    .dlv-stat-ico.blue { background: #dbeafe; }
    .dlv-stat-ico.amber { background: #fef3c7; }
    .dlv-stat-ico.purple { background: #ede9fe; }
    .dlv-stat-ico.red { background: #fee2e2; }

    .dlv-stat-label { margin: 0; font-size: 10.5px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; }
    .dlv-stat-label.green { color: #16a34a; }
    .dlv-stat-label.blue { color: #2563eb; }
    .dlv-stat-label.amber { color: #d97706; }
    .dlv-stat-label.purple { color: #7c3aed; }
    .dlv-stat-label.red { color: #dc2626; }

    .dlv-stat-value { margin: 2px 0 0; font-size: 21px; font-weight: 900; color: #141d16; }
    .dlv-stat-sub { margin: 2px 0 0; font-size: 10.5px; color: #8b998f; }
    /* ---------------- GRID & CARDS ---------------- */

    .dlv-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 350px;
      gap: 16px;
      align-items: start;
    }

    .dlv-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .dlv-col-side { position: sticky; top: 16px; }

    .dlv-card {
      background: #ffffff;
      border: 1px solid #e4ece6;
      border-radius: 16px;
      padding: 18px;
      scroll-margin-top: 16px;
    }

    .dlv-card-head {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }

    .dlv-card-ico {
      width: 38px;
      height: 38px;
      border-radius: 11px;
      background: #dcfce7;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 17px;
      flex-shrink: 0;
    }

    .dlv-card-headtext { min-width: 0; flex: 1; }
    .dlv-card-title { font-size: 16px; font-weight: 800; color: #141d16; }
    .dlv-card-sub { font-size: 12px; color: #7c8a7f; margin-top: 2px; }

    .dlv-viewall {
      margin-left: auto;
      background: #f0fdf4;
      color: #16a34a;
      border: 1px solid #bbe7c6;
      border-radius: 9px;
      padding: 8px 13px;
      font-family: inherit;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      flex-shrink: 0;
    }

    .dlv-viewall:hover { background: #dcfce7; }
    .dlv-viewall:disabled { opacity: 0.55; cursor: not-allowed; }

    .dlv-clear {
      margin-left: auto;
      background: #fff1f2;
      color: #be123c;
      border: 1px solid #fecaca;
      border-radius: 9px;
      padding: 8px 13px;
      font-family: inherit;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      flex-shrink: 0;
    }

    .dlv-clear:hover { background: #ffe4e6; }
    .dlv-clear:disabled { opacity: 0.55; cursor: not-allowed; }

        /* ---------------- ORDER ROWS ---------------- */

    .dlv-prod-img {
      width: 58px;
      height: 58px;
      border-radius: 14px;
      background: #f0fdf4;
      border: 1px solid #d6f0dc;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 27px;
      flex-shrink: 0;
      overflow: hidden;
    }

        .dlv-prod-img img { width: 100%; height: 100%; object-fit: cover; border-radius: 13px; }

    .dlv-prod-img.done {
      background: #dcfce7;
      border-color: #b9e8c5;
    }

        .dlv-prod-img.done img { border-radius: 12px; }

    .dlv-orow-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .dlv-orow {
      display: flex;
      gap: 14px;
      align-items: center;
      border: 1px solid #e6eee9;
      border-radius: 14px;
      padding: 16px 18px;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
      background: #ffffff;
    }

    .dlv-orow:hover {
      border-color: #b8d9c7;
      box-shadow: 0 8px 22px rgba(22, 60, 34, 0.06);
      transform: translateY(-1px);
    }

    .dlv-orow-ico {
      width: 46px;
      height: 46px;
      border-radius: 13px;
      background: #f0fdf4;
      border: 1px solid #d6f0dc;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 21px;
      flex-shrink: 0;
    }

    .dlv-orow-ico.done {
      background: #dcfce7;
      border-color: #b9e8c5;
    }

    .dlv-orow-info {
      flex: 1;
      min-width: 0;
    }

    .dlv-orow-title {
      display: flex;
      align-items: center;
      gap: 9px;
      flex-wrap: wrap;
      font-size: 15px;
      font-weight: 800;
      color: #141d16;
      margin-bottom: 7px;
    }

    .dlv-orow-line {
      font-size: 12.5px;
      color: #66756b;
      margin: 3px 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dlv-orow-earn {
      margin-top: 9px;
      color: #15803d;
      font-weight: 800;
      font-size: 13.5px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* ---- full-detail grid for an order card ---- */

    .dlv-items {
      margin-top: 8px;
      border: 1px solid #e7efe6;
      border-radius: 10px;
      background: #fbfdfb;
      overflow: hidden;
    }

    .dlv-items-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 7px 10px;
      font-size: 12.5px;
      color: #33402f;
    }

    .dlv-items-row + .dlv-items-row {
      border-top: 1px dashed #e2ece0;
    }

    .dlv-items-row .it-qty {
      color: #15803d;
      font-weight: 800;
      white-space: nowrap;
    }

    .dlv-items-row .it-price {
      white-space: nowrap;
      font-weight: 700;
      color: #141d16;
    }

    .dlv-items-total {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 10px;
      background: #f0f7ef;
      font-size: 13px;
      font-weight: 800;
      color: #141d16;
      border-top: 1px solid #dcead9;
    }

    .dlv-detail-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 14px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px dashed #e3ebe1;
    }

    .dlv-detail-item {
      min-width: 0;
    }

    .dlv-detail-label {
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: #9aa69a;
    }

    .dlv-detail-value {
      font-size: 12.5px;
      font-weight: 600;
      color: #2a3a2b;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 1px;
    }

    .dlv-pay-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 9px;
      border-radius: 99px;
      background: #eef4ff;
      border: 1px solid #d4e2fb;
      color: #1d4ed8;
      font-size: 11px;
      font-weight: 800;
    }

    .dlv-orow-right .dlv-maplink {
      width: 100%;
      text-align: center;
    }

    .dlv-orow-warn {
      margin-top: 8px;
      padding: 7px 11px;
      border-radius: 9px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #b91c1c;
      font-size: 11.5px;
      font-weight: 700;
    }

    .dlv-orow-right {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 11px;
      flex-shrink: 0;
      width: 110px;
    }

    .dlv-accept {
      width: 100%;
      padding: 11px 0;
      border: none;
      border-radius: 11px;
      background: #16a34a;
      color: #ffffff;
      font-family: inherit;
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.15s ease;
    }

    .dlv-accept:hover:not(:disabled) {
      background: #15803d;
      transform: translateY(-1px);
    }

    .dlv-accept:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      background: #94a3a0;
    }

    .dlv-prod-tile {
      width: 58px;
      height: 58px;
      border-radius: 14px;
      background: #fefce8;
      border: 1px solid #f3e9c2;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 27px;
    }

        .dlv-chip-new, .dlv-chip-assign, .dlv-chip-wip, .dlv-chip-done {
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 10.5px;
      font-weight: 800;
    }

    .dlv-chip-new { background: #dcfce7; color: #15803d; }
    .dlv-chip-assign { background: #dbeafe; color: #1d4ed8; }
    .dlv-chip-wip { background: #fef3c7; color: #b45309; }
    .dlv-chip-done { background: #dcfce7; color: #15803d; }

    /* ---------------- MY DELIVERY CARDS ---------------- */

    .dlv-dcard {
      border: 1px solid #e6eee9;
      border-radius: 14px;
      padding: 16px 18px;
      background: #ffffff;
      transition: box-shadow 0.15s ease, transform 0.15s ease;
    }

    .dlv-dcard:hover {
      box-shadow: 0 8px 22px rgba(22, 60, 34, 0.06);
      transform: translateY(-1px);
    }

    .dlv-dcard-top {
      display: flex;
      gap: 14px;
      align-items: center;
    }

    .dlv-dcard-info {
      flex: 1;
      min-width: 0;
    }

    .dlv-dcard-side {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
      width: 100px;
    }

    .dlv-maplink {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #f0fdf4;
      color: #16a34a;
      border: 1px solid #bfe8c9;
      border-radius: 9px;
      padding: 7px 11px;
      font-family: inherit;
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s ease;
    }

    .dlv-maplink:hover {
      background: #dcfce7;
    }

    .dlv-dcard-meta {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 11px;
      margin-top: 14px;
      padding: 12px 14px;
      background: #f8faf8;
      border-radius: 11px;
      border: 1px solid #e9eee9;
    }

    .dlv-dcard-meta span {
      display: block;
      font-size: 10px;
      color: #8b998f;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .dlv-dcard-meta strong {
      display: block;
      font-size: 13px;
      color: #141d16;
      margin-top: 3px;
      font-weight: 800;
    }
    /* ---------------- PROGRESS TRACKER ---------------- */

    .dlv-track { display: flex; margin-top: 15px; }

    .dlv-step { flex: 1; text-align: center; position: relative; }

    .dlv-step::before {
      content: "";
      position: absolute;
      top: 13px;
      left: -50%;
      width: 100%;
      height: 2px;
      background: #e3eae4;
    }

    .dlv-step:first-child::before { display: none; }
    .dlv-step.done::before { background: #22c55e; }

    .dlv-step-dot {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      background: #eef2ee;
      color: #9aa79d;
      position: relative;
      z-index: 1;
      border: 2px solid #e3eae4;
      font-weight: 800;
    }

    .dlv-step.done .dlv-step-dot { background: #22c55e; border-color: #22c55e; color: #ffffff; }

    .dlv-step.current .dlv-step-dot {
      background: #dcfce7;
      border-color: #16a34a;
      color: #15803d;
      animation: dlvPulse 1.6s ease infinite;
    }

    @keyframes dlvPulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.35); }
      50% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
    }

    .dlv-step-label { margin-top: 6px; font-size: 10.5px; font-weight: 700; color: #8a988e; }
    .dlv-step.done .dlv-step-label, .dlv-step.current .dlv-step-label { color: #15803d; }

    .dlv-next {
      width: 100%;
      margin-top: 14px;
      padding: 11px 0;
      border: none;
      border-radius: 10px;
      background: #16a34a;
      color: #ffffff;
      font-family: inherit;
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .dlv-next:hover:not(:disabled) { background: #15803d; }
    .dlv-next:disabled { opacity: 0.55; cursor: not-allowed; }

        /* ---------------- DELIVERY HISTORY CARD ---------------- */

    .dlv-hcard {
      display: flex;
      gap: 14px;
      align-items: flex-start;
      border: 1px solid #e6eee9;
      border-radius: 14px;
      padding: 16px 18px;
      background: #ffffff;
      transition: box-shadow 0.15s ease, transform 0.15s ease;
    }

    .dlv-hcard:hover {
      box-shadow: 0 8px 22px rgba(22, 60, 34, 0.06);
      transform: translateY(-1px);
    }

    .dlv-hcard-info {
      flex: 1;
      min-width: 0;
    }

    .dlv-earnpanel {
      width: 235px;
      flex-shrink: 0;
      padding: 14px 16px;
      border-radius: 12px;
      background: linear-gradient(135deg, #f0fdf4, #e5f8ea);
      border: 1px solid #cdebd4;
    }

    .dlv-earnpanel-label {
      font-size: 10px;
      font-weight: 850;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      color: #4d7a5c;
    }

    .dlv-earnpanel-amount { margin-top: 4px; color: #14532d; font-size: 22px; font-weight: 900; line-height: 1; }

    .dlv-earnpanel-div { height: 1px; background: #cdebd4; margin: 11px 0 3px; }

    .dlv-earnpanel-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 7px;
      font-size: 12px;
      color: #245a37;
      font-weight: 600;
    }

    .dlv-earnpanel-row strong { color: #14532d; font-weight: 800; }

    .dlv-earnpanel-note {
      margin-top: 10px;
      padding-top: 9px;
      border-top: 1px dashed #b7e0c0;
      color: #587f66;
      font-size: 10.5px;
      line-height: 1.5;
    }


    /* ---------------- SETTINGS ---------------- */

    .dlv-set-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }

    .dlv-set-tile {
      padding: 13px 15px;
      border-radius: 12px;
      background: #f8faf8;
      border: 1px solid #ecf1ec;
    }

    .dlv-set-tile-label {
      font-size: 10.5px;
      font-weight: 850;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #7c8a7f;
    }

    .dlv-set-tile-value {
      margin-top: 6px;
      color: #141d16;
      font-size: 13px;
      font-weight: 800;
      line-height: 1.5;
    }

    .dlv-set-toggle {
      margin-top: 7px;
      display: inline-flex;
      align-items: center;
      background: #f0fdf4;
      color: #16a34a;
      border: 1px solid #bfe8c9;
      border-radius: 9px;
      padding: 8px 13px;
      font-family: inherit;
      font-size: 12px;
      font-weight: 800;
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .dlv-set-toggle:hover { background: #dcfce7; }
    /* ---------------- DONUT / SUMMARY ---------------- */

    .dlv-donut {
      width: 152px;
      height: 152px;
      border-radius: 50%;
      position: relative;
      margin: 6px auto 16px;
      background: #e7ece8;
    }

    .dlv-donut-center {
      position: absolute;
      inset: 21%;
      background: #ffffff;
      border-radius: 50%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
    }

    .dlv-donut-total { font-size: 24px; font-weight: 900; color: #141d16; line-height: 1; }
    .dlv-donut-label { font-size: 10px; color: #8b998f; font-weight: 700; margin-top: 4px; line-height: 1.3; }

    .dlv-legend { display: flex; flex-direction: column; gap: 9px; }

    .dlv-legend-row {
      display: flex;
      align-items: center;
      gap: 9px;
      font-size: 12.5px;
      color: #3f4d44;
      font-weight: 600;
    }

    .dlv-legend-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
    .dlv-legend-val { margin-left: auto; font-weight: 800; color: #141d16; }

    /* ---------------- EARNINGS OVERVIEW ---------------- */

    .dlv-earn-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }

    .dlv-earn-big { font-size: 29px; font-weight: 900; color: #141d16; }
    .dlv-earn-caption { font-size: 11.5px; color: #8b998f; margin-top: 2px; }

    .dlv-earn-growth {
      background: #dcfce7;
      color: #15803d;
      font-size: 11.5px;
      font-weight: 800;
      padding: 6px 10px;
      border-radius: 999px;
    }

    .dlv-earn-growth.negative { background: #fee2e2; color: #b91c1c; }

    .dlv-earn-sub3 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      border-top: 1px solid #eef2ee;
      margin-top: 15px;
      padding-top: 13px;
      text-align: center;
    }

    .dlv-earn-subval { font-size: 14px; font-weight: 800; color: #141d16; }
    .dlv-earn-sublabel { font-size: 10.5px; color: #8b998f; margin-top: 3px; }

    /* ---------------- NOTIFICATIONS ---------------- */

    .dlv-notif {
      display: flex;
      gap: 11px;
      padding: 11px 0;
      border-bottom: 1px dashed #edf1ed;
    }

    .dlv-notif:last-child { border-bottom: none; padding-bottom: 2px; }

    .dlv-notif-ico {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      flex-shrink: 0;
    }

    .dlv-notif-ico.green { background: #dcfce7; }
    .dlv-notif-ico.blue { background: #dbeafe; }

    .dlv-notif-text { font-size: 12.5px; color: #33413a; font-weight: 600; line-height: 1.45; }
    .dlv-notif-time { font-size: 11px; color: #93a096; margin-top: 3px; }

    /* ---------------- EMPTY / LOADING ---------------- */

    .dlv-empty {
      max-width: 460px;
      margin: 0 auto;
      padding: 34px 18px;
      text-align: center;
      border: 1px dashed #cedbd2;
      border-radius: 13px;
      background: #f8fbf9;
      color: #718078;
      font-size: 13.5px;
    }

    .dlv-empty-icon { font-size: 30px; margin-bottom: 8px; }

    .dlv-loading {
      min-height: 150px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: #68766d;
      font-size: 13.5px;
    }

    .dlv-spinner {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      border: 4px solid #dce8df;
      border-top-color: #16a34a;
      animation: dlvSpin 0.8s linear infinite;
    }

    @keyframes dlvSpin { to { transform: rotate(360deg); } }

    /* ---------------- RESPONSIVE ---------------- */

    @media (max-width: 1280px) {
      .dlv-stats { grid-template-columns: repeat(3, 1fr); }
      .dlv-grid { grid-template-columns: 1fr; }
    }

    @media (max-width: 900px) {
      .dlv-sidebar {
        position: fixed;
        left: 0;
        top: 0;
        bottom: 0;
        transform: translateX(-105%);
        transition: transform 0.25s ease;
      }

      .dlv-sidebar.dlv-open { transform: none; box-shadow: 0 0 60px rgba(0, 0, 0, 0.4); }

      .dlv-scrim {
        display: block;
        position: fixed;
        inset: 0;
        background: rgba(9, 26, 15, 0.45);
        z-index: 40;
      }

      .dlv-burger { display: flex; }
      .dlv-main { padding: 16px 16px 40px; }
    }

    @media (max-width: 760px) {
      .dlv-stats { grid-template-columns: repeat(2, 1fr); }
      .dlv-datecard { display: none; }
      .dlv-orow { flex-direction: column; }
      .dlv-orow-right { flex-direction: row; width: 100%; justify-content: space-between; align-items: center; }
      .dlv-accept { flex: 1; }
      .dlv-dcard-side { flex-direction: row; }
      .dlv-dcard-top { flex-wrap: wrap; }
      .dlv-hcard { flex-direction: column; }
      .dlv-earnpanel { width: 100%; }
      .dlv-set-grid { grid-template-columns: 1fr; }
    }

    @media (max-width: 460px) {
      .dlv-stats { grid-template-columns: 1fr; }
      .dlv-topbar { flex-wrap: wrap; }
      .dlv-dcard-meta { grid-template-columns: 1fr 1fr; }
    }

    /* ---------------- DEDICATED SECTION VIEWS ---------------- */

    .dlv-main.dlv-view-available .dlv-stats,
    .dlv-main.dlv-view-my .dlv-stats,
    .dlv-main.dlv-view-history .dlv-stats,
    .dlv-main.dlv-view-earnings .dlv-stats,
    .dlv-main.dlv-view-notifications .dlv-stats,
    .dlv-main.dlv-view-settings .dlv-stats {
      display: none;
    }

    .dlv-main.dlv-view-available .dlv-grid,
    .dlv-main.dlv-view-my .dlv-grid,
    .dlv-main.dlv-view-history .dlv-grid,
    .dlv-main.dlv-view-earnings .dlv-grid,
    .dlv-main.dlv-view-notifications .dlv-grid,
    .dlv-main.dlv-view-settings .dlv-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .dlv-main.dlv-view-available .dlv-col-side,
    .dlv-main.dlv-view-my .dlv-col-side,
    .dlv-main.dlv-view-history .dlv-col-side,
    .dlv-main.dlv-view-settings .dlv-col-side {
      display: none;
    }

    .dlv-main.dlv-view-available .dlv-col > section:not(#dlv-sec-available),
    .dlv-main.dlv-view-my .dlv-col > section:not(#dlv-sec-my),
    .dlv-main.dlv-view-history .dlv-col > section:not(#dlv-sec-history),
    .dlv-main.dlv-view-settings .dlv-col > section:not(#dlv-sec-settings) {
      display: none;
    }

    .dlv-main.dlv-view-earnings .dlv-col,
    .dlv-main.dlv-view-notifications .dlv-col {
      display: none;
    }

    .dlv-main.dlv-view-earnings .dlv-col-side > section:not(#dlv-sec-earnings),
    .dlv-main.dlv-view-notifications .dlv-col-side > section:not(#dlv-sec-notifications) {
      display: none;
    }

    .dlv-main.dlv-view-earnings .dlv-col-side,
    .dlv-main.dlv-view-notifications .dlv-col-side {
      position: static;
    }

    .dlv-main.dlv-view-available .dlv-col,
    .dlv-main.dlv-view-my .dlv-col,
    .dlv-main.dlv-view-history .dlv-col,
    .dlv-main.dlv-view-earnings .dlv-col-side,
    .dlv-main.dlv-view-notifications .dlv-col-side,
    .dlv-main.dlv-view-settings .dlv-col {
      width: 100%;
    }

  `

  // =========================================================
  // PAGE
  // =========================================================

  return (
    <>
      <style>{styles}</style>

      <div className="dlv-app">
        <SupportChat role="delivery" />
        {/* ==================== SIDEBAR ==================== */}

        <aside className={"dlv-sidebar" + (sidebarOpen ? " dlv-open" : "")}>
          <div className="dlv-brand">
            <div className="dlv-brand-logo">📦</div>
            <div>
              <div className="dlv-brand-name">E-Farm</div>
              <div className="dlv-brand-sub">Delivery Panel</div>
            </div>
          </div>

          <nav className="dlv-nav">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                className={activeNav === item.id ? "active" : ""}
                onClick={() => go(item.id)}
              >
                <span className="dlv-nav-ico">{item.icon}</span>
                {item.label}
                {item.id === "notifications" && bellCount > 0 && (
                  <span className="dlv-nav-badge">
                    {bellCount > 9 ? "9+" : bellCount}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="dlv-side-profile">
            <div className="dlv-side-avatar">🚚</div>
            <div className="dlv-side-name">{firstName}</div>
            <div className="dlv-side-role">Delivery Partner</div>
            <div className="dlv-side-status">
              <span className={"dlv-dot" + (dutyOnline ? " on" : "")} />
              {dutyOnline ? "Online" : "Offline"}
            </div>
            <button type="button" className="dlv-duty-btn" onClick={toggleDuty}>
              {dutyOnline ? "Go Offline" : "Go Online"}
            </button>
          </div>
        </aside>

        {sidebarOpen && (
          <div className="dlv-scrim" onClick={() => setSidebarOpen(false)} />
        )}

        {/* ==================== MAIN ==================== */}

        <main className={"dlv-main" + (view !== "dashboard" ? " dlv-view-" + view : "")}>
          <header className="dlv-topbar">
            <button
              type="button"
              className="dlv-burger"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              ☰
            </button>

            <div className="dlv-topbar-title">
              <p className="dlv-welcome">Welcome back, {firstName}! 👋</p>
              <h1>Delivery Dashboard</h1>
              <p className="dlv-topbar-sub">
                View available orders and manage your deliveries.
              </p>
            </div>

            <div className="dlv-topbar-right">
              <button
                type="button"
                className="dlv-bell"
                onClick={() => go("notifications")}
              >
                🔔
                {bellCount > 0 && (
                  <span className="dlv-bell-badge">
                    {bellCount > 9 ? "9+" : bellCount}
                  </span>
                )}
              </button>

              <div className="dlv-datecard">
                <div className="dlv-datecard-ico">📅</div>
                <div>
                  <div className="dlv-datecard-date">{todayStr}</div>
                  <div className="dlv-datecard-day">{todayDay}</div>
                </div>
              </div>
            </div>
          </header>

          {!dutyOnline && (
            <div className="dlv-offline-banner">
              🛑 You are currently <strong>offline</strong>. Go online from the
              sidebar to accept new orders.
            </div>
          )}

          {/* ==================== STATS ==================== */}

          <section className="dlv-stats">
            <div className="dlv-stat">
              <div className="dlv-stat-ico green">📦</div>
              <div>
                <p className="dlv-stat-label green">Available Orders</p>
                <p className="dlv-stat-value">{availableOrders.length}</p>
                <p className="dlv-stat-sub">New orders to accept</p>
              </div>
            </div>

            <div className="dlv-stat">
              <div className="dlv-stat-ico blue">🚚</div>
              <div>
                <p className="dlv-stat-label blue">My Deliveries</p>
                <p className="dlv-stat-value">{myDeliveries.length}</p>
                <p className="dlv-stat-sub">Currently assigned</p>
              </div>
            </div>

            <div className="dlv-stat">
              <div className="dlv-stat-ico amber">🛣️</div>
              <div>
                <p className="dlv-stat-label amber">In Progress</p>
                <p className="dlv-stat-value">{inProgressCount}</p>
                <p className="dlv-stat-sub">Picked up / on the way</p>
              </div>
            </div>

            <div className="dlv-stat">
              <div className="dlv-stat-ico purple">✅</div>
              <div>
                <p className="dlv-stat-label purple">Completed</p>
                <p className="dlv-stat-value">{completedOrders.length}</p>
                <p className="dlv-stat-sub">Total completed</p>
              </div>
            </div>

            <div className="dlv-stat">
              <div className="dlv-stat-ico red">💰</div>
              <div>
                <p className="dlv-stat-label red">Total Earnings</p>
                <p className="dlv-stat-value">{rupee(totalEarnings)}</p>
                <p className="dlv-stat-sub">delivery charge + farmer commission</p>
              </div>
            </div>
          </section>

          <div className="dlv-grid">
            {/* ---------- LEFT COLUMN ---------- */}

            <div className="dlv-col">
              {/* AVAILABLE ORDERS */}

              <section className="dlv-card" id="dlv-sec-available">
                <div className="dlv-card-head">
                  <div className="dlv-card-ico">📦</div>
                  <div className="dlv-card-headtext">
                    <div className="dlv-card-title">Available Orders</div>
                    <div className="dlv-card-sub">
                      Farmer-approved orders. Trips over {DELIVERY_RANGE_KM} km
                      need an explicit override.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="dlv-viewall"
                    onClick={loadOrders}
                    disabled={loading}
                  >
                    ⟳ Refresh
                  </button>
                </div>

                {loading ? (
                  <div className="dlv-loading">
                    <div className="dlv-spinner" />
                    Loading available orders...
                  </div>
                ) : availableOrders.length === 0 ? (
                  <div className="dlv-empty">
                    <div className="dlv-empty-icon">🎉</div>
                    No orders are currently available.
                  </div>
                ) : (
                  <div className="dlv-orow-list">
                    {availableOrders.map((order) => {
                      const est = calcDeliveryEarnings(order, {
                        pickupOverride: freshPickup(order),
                      });
                      const distanceUnknown = est.distanceKm == null;
                      const outOfRange =
                        distanceUnknown ||
                        est.distanceKm > DELIVERY_RANGE_KM;
                      const items = orderItemsOf(order);
                      const total = getOrderTotal(order);

                      return (
                        <div className="dlv-orow" key={order.id}>
                          <div className="dlv-prod-img">
                              {order.productImage ? (
                                <img
                                  src={order.productImage}
                                  alt={order.productName || "Product"}
                                  onError={(e) => {
                                    e.target.src =
                                      "https://via.placeholder.com/150/16a34a/ffffff?text=E-Farm";
                                    e.target.onerror = null;
                                  }}
                                />
                              ) : (
                                "🌾"
                              )}
                            </div>

                          <div className="dlv-orow-info">
                            <div className="dlv-orow-title">
                              Order #
                              {order.orderNumber || order.id.slice(0, 8)}
                              <span className="dlv-chip-new">
                                {order.farmerName
                                  ? `${order.farmerName.split(" ")[0]} accepted`
                                  : "New"}
                              </span>
                            </div>

                            {/* EVERY product on the order */}
                            <div className="dlv-items">
                              {items.map((it, i) => (
                                <div className="dlv-items-row" key={i}>
                                  <span>
                                    🌾 {it.name}
                                    {it.category ? (
                                      <small style={{ color: "#9aa69a" }}>
                                        {" "}({it.category})
                                      </small>
                                    ) : null}
                                  </span>
                                  <span className="it-qty">
                                    × {it.qty}{" "}
                                    <span className="it-price">
                                      ₹{(it.price * it.qty).toLocaleString("en-IN")}
                                    </span>
                                  </span>
                                </div>
                              ))}
                              <div className="dlv-items-total">
                                <span>
                                  🧺 {items.length} item type(s) • total{" "}
                                  {orderItemCount(order)} unit(s)
                                </span>
                                <span>₹{total.toLocaleString("en-IN")}</span>
                              </div>
                            </div>

                            <div className="dlv-orow-line" style={{ marginTop: 8 }}>
                              👤 <strong>{order.consumerName || "Consumer"}</strong>{" "}
                              • 📞 {consumerPhoneOf(order)}
                            </div>

                            <div className="dlv-orow-line">
                              📍 Deliver to: {deliveryAddressText(order)}
                            </div>

                            <div className="dlv-orow-line">
                              🚜 Pickup: {order.farmerName || "Farmer"} • 📞{" "}
                              {order.farmerPhone || "—"}
                            </div>

                            <div className="dlv-detail-grid">
                              <div className="dlv-detail-item">
                                <div className="dlv-detail-label">Payment</div>
                                <div className="dlv-detail-value">
                                  <span className="dlv-pay-chip">
                                    💳 {paymentMethodOf(order)}
                                    {order.paymentStatus ? ` • ${order.paymentStatus}` : ""}
                                  </span>
                                </div>
                              </div>
                              <div className="dlv-detail-item">
                                <div className="dlv-detail-label">Placed</div>
                                <div className="dlv-detail-value">
                                  🕒 {formatDate(order.createdAt)}
                                </div>
                              </div>
                              <div className="dlv-detail-item">
                                <div className="dlv-detail-label">Distance</div>
                                <div className="dlv-detail-value">
                                  📏{" "}
                                  {est.distanceKm != null
                                    ? `${est.distanceKm} km from farm`
                                    : "Unavailable"}
                                </div>
                              </div>
                              <div className="dlv-detail-item">
                                <div className="dlv-detail-label">Earning</div>
                                <div className="dlv-detail-value">
                                  💰 {rupee(est.totalEarning)}
                                </div>
                              </div>
                            </div>

                            {outOfRange && (
                              <div className="dlv-orow-warn">
                                {distanceUnknown
                                  ? "📍 Pickup distance unknown — accepting will use the flat base fee."
                                  : `🚫 ${est.distanceKm} km — beyond the ${DELIVERY_RANGE_KM} km service range.`}
                              </div>
                            )}
                          </div>

                          <div className="dlv-orow-right">
                            <button
                              type="button"
                              className="dlv-maplink"
                              onClick={() => openGoogleMaps(order, "farmer")}
                            >
                              🗺️ View Farm
                            </button>
                            <button
                              type="button"
                              className="dlv-maplink"
                              onClick={() => openGoogleMaps(order, "consumer")}
                            >
                              🗺️ View Customer
                            </button>
                            <button
                              type="button"
                              className="dlv-accept"
                              disabled={
                                actionOrderId === order.id ||
                                !dutyOnline
                              }
                              onClick={() =>
                                outOfRange
                                  ? acceptOrder(order, {
                                      ignoreDistance: true,
                                      km: est.distanceKm,
                                    })
                                  : acceptOrder(order)
                              }
                            >
                              {actionOrderId === order.id
                                ? "Accepting..."
                                : outOfRange
                                ? "⚠️ Accept Anyway"
                                : "Accept Order"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
              {/* MY DELIVERIES */}

              <section className="dlv-card" id="dlv-sec-my">
                <div className="dlv-card-head">
                  <div className="dlv-card-ico">🚚</div>
                  <div className="dlv-card-headtext">
                    <div className="dlv-card-title">My Deliveries</div>
                    <div className="dlv-card-sub">
                      Orders currently assigned to you.
                    </div>
                  </div>
                </div>

                {myDeliveries.length === 0 ? (
                  <div className="dlv-empty">
                    <div className="dlv-empty-icon">🚚</div>
                    You have no active deliveries.
                  </div>
                ) : (
                  <div className="dlv-orow-list">
                    {myDeliveries.map((order) => {
                      const est = calcDeliveryEarnings(order, {
                        pickupOverride: freshPickup(order),
                      });
                      const idx = stageIndex(order);
                      const nextStage = STAGES[idx + 1];

                      return (
                        <div className="dlv-dcard" key={order.id}>
                          <div className="dlv-dcard-top">
                            <div className="dlv-prod-img">
                              {order.productImage ? (
                                <img
                                  src={order.productImage}
                                  alt={order.productName || "Product"}
                                  onError={(e) => {
                                    e.target.src =
                                      "https://via.placeholder.com/150/16a34a/ffffff?text=E-Farm";
                                    e.target.onerror = null;
                                  }}
                                />
                              ) : (
                                "🌾"
                              )}
                            </div>
                            <div className="dlv-dcard-info">
                              <div className="dlv-orow-title">
                                Order #
                                {order.orderNumber || order.id.slice(0, 8)}
                                <span
                                  className={
                                    idx === 0
                                      ? "dlv-chip-assign"
                                      : "dlv-chip-wip"
                                  }
                                >
                                  {idx === 0 ? "Assigned" : "In Progress"}
                                </span>
                              </div>

                              <div className="dlv-orow-line">
                                🌾{" "}
                                {order.productName || "Agri Product"}
                              </div>

                              <div className="dlv-orow-line">
                                👤{" "}
                                {order.consumerName ||
                                  order.customerName ||
                                  "Consumer"}
                              </div>

                              <div className="dlv-orow-line">
                                📍 {getLocationText(order, "consumer")}
                              </div>
                            </div>

                            <div className="dlv-dcard-side">
                              <button
                                type="button"
                                className="dlv-maplink"
                                onClick={() => openGoogleMaps(order, "farmer")}
                              >
                                🗺️ View Farm
                              </button>
                              <button
                                type="button"
                                className="dlv-maplink"
                                onClick={() =>
                                  openGoogleMaps(order, "consumer")
                                }
                              >
                                🗺️ View Customer
                              </button>
                            </div>
                          </div>

                          <div className="dlv-dcard-meta">
                            <div>
                              <span>Accepted</span>
                              <strong>{formatDate(order.acceptedAt)}</strong>
                            </div>
                            <div>
                              <span>Distance</span>
                              <strong>
                                {est.distanceKm != null
                                  ? `${est.distanceKm} km`
                                  : "—"}
                              </strong>
                            </div>
                            <div>
                              <span>Est. Earning</span>
                              <strong>{rupee(est.totalEarning)}</strong>
                            </div>
                          </div>

                          {/* Every basic detail the partner needs */}
                          <div className="dlv-items">
                            {orderItemsOf(order).map((it, i) => (
                              <div className="dlv-items-row" key={i}>
                                <span>
                                  🌾 {it.name}
                                  {it.category ? (
                                    <small style={{ color: "#9aa69a" }}>
                                      {" "}({it.category})
                                    </small>
                                  ) : null}
                                </span>
                                <span className="it-qty">
                                  × {it.qty}{" "}
                                  <span className="it-price">
                                    ₹{(it.price * it.qty).toLocaleString("en-IN")}
                                  </span>
                                </span>
                              </div>
                            ))}
                            <div className="dlv-items-total">
                              <span>🧺 Total order value</span>
                              <span>₹{getOrderTotal(order).toLocaleString("en-IN")}</span>
                            </div>
                          </div>

                          <div className="dlv-detail-grid">
                            <div className="dlv-detail-item">
                              <div className="dlv-detail-label">Consumer</div>
                              <div className="dlv-detail-value">
                                👤 {order.consumerName || "—"} • 📞 {consumerPhoneOf(order)}
                              </div>
                            </div>
                            <div className="dlv-detail-item">
                              <div className="dlv-detail-label">Payment</div>
                              <div className="dlv-detail-value">
                                <span className="dlv-pay-chip">
                                  💳 {paymentMethodOf(order)}
                                </span>
                              </div>
                            </div>
                            <div className="dlv-detail-item">
                              <div className="dlv-detail-label">Deliver to</div>
                              <div className="dlv-detail-value">
                                📍 {deliveryAddressText(order)}
                              </div>
                            </div>
                            <div className="dlv-detail-item">
                              <div className="dlv-detail-label">Pickup</div>
                              <div className="dlv-detail-value">
                                🚜 {order.farmerName || "Farmer"} • 📞{" "}
                                {order.farmerPhone || "—"}
                              </div>
                            </div>
                          </div>
                          <div className="dlv-track">
                            {STAGES.map((stage, i) => (
                              <div
                                key={stage}
                                className={
                                  i < idx
                                    ? "dlv-step done"
                                    : i === idx
                                    ? "dlv-step current"
                                    : "dlv-step"
                                }
                              >
                                <div className="dlv-step-dot">
                                  {i < idx ? "✓" : i === idx ? "●" : ""}
                                </div>
                                <div className="dlv-step-label">
                                  {STAGE_LABELS[stage]}
                                </div>
                              </div>
                            ))}
                          </div>

                          {idx < 3 && nextStage && (
                            <button
                              type="button"
                              className="dlv-next"
                              disabled={actionOrderId === order.id}
                              onClick={() => {
                                if (nextStage === "delivered") {
                                  completeDelivery(order);
                                } else {
                                  updateDeliveryStage(order, nextStage);
                                }
                              }}
                            >
                              {actionOrderId === order.id
                                ? "Updating..."
                                : nextStage === "picked_up"
                                ? "🧺 Mark as Picked Up"
                                : nextStage === "out_for_delivery"
                                ? "🛣️ Mark Out for Delivery"
                                : "✅ Order Reached Successfully"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
              {/* DELIVERY HISTORY */}

              <section className="dlv-card" id="dlv-sec-history">
                <div className="dlv-card-head">
                  <div className="dlv-card-ico">🕒</div>
                  <div className="dlv-card-headtext">
                    <div className="dlv-card-title">Delivery History</div>
                    <div className="dlv-card-sub">
                      Completed deliveries and payments.
                    </div>
                  </div>
                  {visibleHistory.length > 0 && (
                    <button
                      type="button"
                      className="dlv-clear"
                      disabled={clearingHistory}
                      onClick={clearHistory}
                    >
                      {clearingHistory ? "Clearing..." : "🗑 Clear"}
                    </button>
                  )}
                </div>

                {visibleHistory.length === 0 ? (
                  <div className="dlv-empty">
                    <div className="dlv-empty-icon">📜</div>
                    No completed delivery history.
                  </div>
                ) : (
                  <div className="dlv-orow-list">
                    {visibleHistory.map((order) => {
                      const calc = calcDeliveryEarnings(order, {
                        pickupOverride: freshPickup(order),
                      });
                      const paid = earningOfOrder(order);
                      const charge =
                        Number(order.deliveryCharge) || calc.deliveryCharge;
                      const commission =
                        Number(order.deliveryCommission) || calc.commission;

                      return (
                        <div className="dlv-hcard" key={order.id}>
                          <div
                            className="dlv-prod-img done"
                            style={{ width: "62px", height: "62px" }}
                          >
                            {order.productImage ? (
                              <img
                                src={order.productImage}
                                alt={order.productName || "Product"}
                                onError={(e) => {
                                  e.target.src =
                                    "https://via.placeholder.com/150/16a34a/ffffff?text=E-Farm";
                                  e.target.onerror = null;
                                }}
                              />
                            ) : (
                              "✅"
                            )}
                          </div>

                          <div className="dlv-hcard-info">
                            <div className="dlv-orow-title">
                              Order #
                              {order.orderNumber || order.id.slice(0, 8)}
                              <span className="dlv-chip-done">Delivered</span>
                            </div>

                            <div className="dlv-orow-line">
                              👤{" "}
                              {order.consumerName ||
                                order.customerName ||
                                "Customer"}
                            </div>

                            <div className="dlv-orow-line">
                              🌾 {order.productName || "Product"}
                            </div>

                            <div className="dlv-orow-line">
                              💰 Order value: ₹
                              {getOrderTotal(order).toLocaleString("en-IN")}
                            </div>

                            <div className="dlv-orow-line">
                              🕒 Delivered: {formatDate(order.deliveredAt)}
                            </div>
                          </div>

                          <div className="dlv-earnpanel">
                            <div className="dlv-earnpanel-label">
                              You Earned
                            </div>
                            <div className="dlv-earnpanel-amount">
                              {rupee(paid)}
                            </div>
                            <div className="dlv-earnpanel-div" />
                            <div className="dlv-earnpanel-row">
                              <span>Delivery charge</span>
                              <strong>{rupee(charge)}</strong>
                            </div>
                            <div className="dlv-earnpanel-row">
                              <span>Commission (from farmer)</span>
                              <strong>{rupee(commission)}</strong>
                            </div>
                            <div className="dlv-earnpanel-row">
                              <span>Distance</span>
                              <strong>
                                {calc.distanceKm != null
                                  ? `${calc.distanceKm} km`
                                  : "—"}
                              </strong>
                            </div>
                            <div className="dlv-earnpanel-note">
                              {order.deliveryEarningBreakdown ||
                                calc.breakdown}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
              {/* SETTINGS */}

              <section className="dlv-card" id="dlv-sec-settings">
                <div className="dlv-card-head">
                  <div className="dlv-card-ico">⚙️</div>
                  <div className="dlv-card-headtext">
                    <div className="dlv-card-title">Settings</div>
                    <div className="dlv-card-sub">
                      Delivery rules and preferences.
                    </div>
                  </div>
                </div>

                <div className="dlv-set-grid">
                  <div className="dlv-set-tile">
                    <div className="dlv-set-tile-label">Duty Status</div>
                    <button
                      type="button"
                      className="dlv-set-toggle"
                      onClick={toggleDuty}
                    >
                      {dutyOnline
                        ? "🟢 Online — Go Offline"
                        : "⚫ Offline — Go Online"}
                    </button>
                  </div>

                  <div className="dlv-set-tile">
                    <div className="dlv-set-tile-label">Delivery Range</div>
                    <div className="dlv-set-tile-value">
                      {DELIVERY_RANGE_KM} km from farmer pickup
                    </div>
                  </div>

                  <div className="dlv-set-tile">
                    <div className="dlv-set-tile-label">Delivery Fee</div>
                    <div className="dlv-set-tile-value">
                      ₹{DELIVERY_RATES.BASE_FEE} base + ₹
                      {DELIVERY_RATES.PER_KM}/km after{" "}
                      {DELIVERY_RATES.FREE_KM} km (max ₹
                      {DELIVERY_RATES.MAX_CHARGE})
                    </div>
                  </div>

                  <div className="dlv-set-tile">
                    <div className="dlv-set-tile-label">Commission</div>
                    <div className="dlv-set-tile-value">
                      {DELIVERY_RATES.COMMISSION_PCT}% of order value (₹
                      {DELIVERY_RATES.COMMISSION_MIN}–₹
                      {DELIVERY_RATES.COMMISSION_MAX})
                    </div>
                  </div>

                  <div className="dlv-set-tile">
                    <div className="dlv-set-tile-label">
                      Platform Minimum Order
                    </div>
                    <div className="dlv-set-tile-value">
                      {rupee(MIN_ORDER_VALUE)}
                    </div>
                  </div>

                  <div className="dlv-set-tile">
                    <div className="dlv-set-tile-label">Auto Refresh</div>
                    <div className="dlv-set-tile-value">
                      Every 10 seconds
                    </div>
                  </div>
                </div>
              </section>
            </div>
            {/* ---------- RIGHT COLUMN ---------- */}

            <div className="dlv-col dlv-col-side">
              {/* DELIVERY SUMMARY */}

              <section className="dlv-card" id="dlv-sec-summary">
                <div className="dlv-card-head">
                  <div className="dlv-card-ico">📊</div>
                  <div className="dlv-card-headtext">
                    <div className="dlv-card-title">Delivery Summary</div>
                    <div className="dlv-card-sub">
                      Overview of your performance
                    </div>
                  </div>
                </div>

                {donutTotal === 0 ? (
                  <div className="dlv-empty">
                    <div className="dlv-empty-icon">📊</div>
                    No delivery activity yet.
                  </div>
                ) : (
                  <>
                    <div className="dlv-donut" style={donutStyle}>
                      <div className="dlv-donut-center">
                        <div className="dlv-donut-total">{donutTotal}</div>
                        <div className="dlv-donut-label">
                          Total
                          <br />
                          Deliveries
                        </div>
                      </div>
                    </div>

                    <div className="dlv-legend">
                      {donutData.map((part) => {
                        const pct = (
                          (part.count / donutTotal) *
                          100
                        ).toFixed(1);

                        return (
                          <div className="dlv-legend-row" key={part.label}>
                            <span
                              className="dlv-legend-dot"
                              style={{ background: part.color }}
                            />
                            {part.label}
                            <span className="dlv-legend-val">
                              {part.count} ({pct}%)
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </section>

              {/* EARNINGS OVERVIEW */}

              <section className="dlv-card" id="dlv-sec-earnings">
                <div className="dlv-card-head">
                  <div className="dlv-card-ico">💰</div>
                  <div className="dlv-card-headtext">
                    <div className="dlv-card-title">Earnings Overview</div>
                    <div className="dlv-card-sub">Your earnings summary</div>
                  </div>
                </div>

                <div className="dlv-earn-top">
                  <div>
                    <div className="dlv-earn-big">{rupee(totalEarnings)}</div>
                    <div className="dlv-earn-caption">Total Earnings</div>
                  </div>
                  {growthPct !== null && (
                    <div
                      className={
                        "dlv-earn-growth" +
                        (growthPct >= 0 ? "" : " negative")
                      }
                    >
                      {growthPct >= 0 ? "▲" : "▼"} {Math.abs(growthPct)}% vs
                      last month
                    </div>
                  )}
                </div>

                <div className="dlv-earn-sub3">
                  <div>
                    <div className="dlv-earn-subval">
                      {rupee(totalFees)}
                    </div>
                    <div className="dlv-earn-sublabel">Delivery Fees</div>
                  </div>
                  <div>
                    <div className="dlv-earn-subval">
                      {rupee(totalCommission)}
                    </div>
                    <div className="dlv-earn-sublabel">Farmer Commission</div>
                  </div>
                  <div>
                    <div className="dlv-earn-subval">
                      {rupee(monthEarnings)}
                    </div>
                    <div className="dlv-earn-sublabel">This Month</div>
                  </div>
                </div>
              </section>

              {/* NOTIFICATIONS */}

              <section className="dlv-card" id="dlv-sec-notifications">
                <div className="dlv-card-head">
                  <div className="dlv-card-ico">🔔</div>
                  <div className="dlv-card-headtext">
                    <div className="dlv-card-title">Notifications</div>
                    <div className="dlv-card-sub">
                      Latest activity on your orders
                    </div>
                  </div>
                </div>

                {recentNotifications.length === 0 ? (
                  <div className="dlv-empty">
                    <div className="dlv-empty-icon">🔔</div>
                    No notifications yet.
                  </div>
                ) : (
                  <div>
                    {recentNotifications.map((item, index) => (
                      <div className="dlv-notif" key={index}>
                        <div className={"dlv-notif-ico " + item.tone}>
                          {item.icon}
                        </div>
                        <div>
                          <div className="dlv-notif-text">{item.text}</div>
                          <div className="dlv-notif-time">
                            {timeAgo(item.time)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

export default DeliveryDashboard;