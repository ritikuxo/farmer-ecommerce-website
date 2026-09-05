import { useEffect, useMemo, useRef, useState } from "react";
import { auth, db } from "../firebase/config";
import { onAuthStateChanged } from "firebase/auth";
import "./consumerdashboard.css";
import { MIN_ORDER_VALUE, getTripKm, calcDeliveryCharge, calcCommission, calcDeliveryEarnings, rupee, DELIVERY_RANGE_KM } from "./deliveryEarnings";
import {
  collection,
  getDocs,
  query,
  where,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import LocationPicker from "../components/LocationPicker";

// =========================================================
// VEGETABLE / FRUIT FALLBACK ART
// ---------------------------------------------------------
// If a farmer did not upload a photo, we still show a
// vegetable "image" for every listed product so the shop
// always looks alive. The emoji is picked from the name.
// =========================================================

const VEGGIE_ART = {
  tomato: "🍅", potato: "🥔", onion: "🧅", carrot: "🥕",
  brinjal: "🍆", eggplant: "🍆", ladyfinger: "🫑", okra: "🫑",
  capsicum: "🫑", pepper: "🫑", chilli: "🌶️", chili: "🌶️",
  spinach: "🥬", palak: "🥬", cabbage: "🥬", cauliflower: "🥦",
  broccoli: "🥦", cucumber: "🥒", beans: "🫛", peas: "🫛",
  garlic: "🧄", ginger: "🫚", lemon: "🍋", corn: "🌽",
  maize: "🌽", mushroom: "🍄", pumpkin: "🎃", radish: "🥕",
  beet: "🥕", mango: "🥭", banana: "🍌", apple: "🍎",
  orange: "🍊", papaya: "🍈", guava: "🍈", pomegranate: "🍎",
  grapes: "🍇", watermelon: "🍉", strawberry: "🍓",
  wheat: "🌾", rice: "🌾", paddy: "🌾", groundnut: "🥜",
  peanut: "🥜", coconut: "🥥", mustard: "🌼", soya: "🫘",
  soybean: "🫘", dal: "🫘", lentil: "🫘", green: "🥬",
  leafy: "🥬",
};

const veggieEmoji = (name) => {
  const n = String(name || "").toLowerCase();

  for (const key of Object.keys(VEGGIE_ART)) {
    if (n.includes(key)) return VEGGIE_ART[key];
  }

  return "🌿";
};

function ConsumerDashboard() {
  // =========================================================
  // USER
  // =========================================================

  const currentUser = auth.currentUser;

  // =========================================================
  // USER PROFILE
  // =========================================================

  const [userProfile, setUserProfile] = useState(null);

  // =========================================================
  // PRODUCTS
  // =========================================================

  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  // =========================================================
  // ORDERS
  // =========================================================

  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);

  // Completed history is hidden locally for this consumer.
  // Firestore orders are NOT deleted, so other dashboards keep their records.
  const [hiddenCompletedOrderIds, setHiddenCompletedOrderIds] = useState(() => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return [];
      const saved = localStorage.getItem(`efarm_completed_history_${uid}`);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [clearingHistory, setClearingHistory] = useState(false);

  // =========================================================
  // UI STATE (sidebar / section views)
  // =========================================================

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeNav, setActiveNav] = useState("dashboard");
  const [view, setView] = useState("dashboard");

  // NAV list — clicking a nav item opens that section as its
  // own full view (same pattern as the Delivery Dashboard).
  const NAV = [
    { id: "dashboard", icon: "🏠", label: "Dashboard" },
    { id: "shop", icon: "🛍️", label: "Shop Products" },
    { id: "orders", icon: "📦", label: "My Orders" },
  ];

  const go = (id) => {
    setActiveNav(id);
    setView(id);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // =========================================================
  // CART (multi-product, ONE farmer shop at a time)
  // ---------------------------------------------------------
  // A consumer can add several products and buy them together
  // in a single checkout, but ONLY products from ONE farmer's
  // shop can sit in the cart at a time. Adding a product from
  // a different farmer is blocked until the current cart is
  // cleared. The cart persists on this device (localStorage).
  // =========================================================

  const [cart, setCart] = useState(() => {
    try {
      const saved = localStorage.getItem("efarm_consumer_cart");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [cartOpen, setCartOpen] = useState(false);
  const [cartCheckoutOpen, setCartCheckoutOpen] = useState(false);
  const [placingCartOrder, setPlacingCartOrder] = useState(false);

  // Keep the cart on this device.
  useEffect(() => {
    try {
      localStorage.setItem("efarm_consumer_cart", JSON.stringify(cart));
    } catch {
      /* storage unavailable */
    }
  }, [cart]);

  const cartCount = cart.reduce((n, item) => n + Number(item.qty || 0), 0);
  const cartSubtotal = cart.reduce(
    (n, item) => n + Number(item.price || 0) * Number(item.qty || 0),
    0
  );
  const cartFarmerId = cart.length ? cart[0].farmerId || "" : "";
  const cartFarmerName = cart.length
    ? cart[0].farmerName || "this farmer"
    : "this farmer";

  // BUY MODAL
  // =========================================================

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showOrderModal, setShowOrderModal] = useState(false);

  const [orderQuantity, setOrderQuantity] = useState(1);

  // =========================================================
  // DELIVERY DETAILS
  // =========================================================

  const [consumerName, setConsumerName] = useState("");
  const [consumerPhone, setConsumerPhone] = useState("");
  const [consumerEmail, setConsumerEmail] = useState("");

  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [pincode, setPincode] = useState("");

  // =========================================================
  // LOCATION
  // =========================================================

  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  /* Raw text from the "paste coordinates" field — browsers on
     desktops without GPS often return a wildly wrong city-level
     (IP-based) fix, so the consumer needs an exact fallback.   */
  const [manualCoords, setManualCoords] = useState("");
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");

  /* =========================================================
     REAL PICKUP LOCATIONS — the farmer side of the trip.
     The consumer's side is the GPS captured at checkout; the
     farmer's side comes from their saved farm location. Both
     are needed to show the REAL farmer → consumer distance and
     to compute the distance-based delivery charge (which is
     also what the delivery partner earns — deliveryEarnings.js).
     ========================================================= */

  const [farmerPickups, setFarmerPickups] = useState({});

  useEffect(() => {
    if (!showOrderModal) return;

    const farmerIds = [selectedProduct?.farmerId].filter(Boolean);

    farmerIds.forEach((farmerId) => {
      getDoc(doc(db, "users", farmerId))
        .then((snap) => {
          const loc = snap.exists() ? snap.data().location : null;
          if (
            loc &&
            Number.isFinite(Number(loc.latitude)) && Number(loc.latitude) !== 0 &&
            Number.isFinite(Number(loc.longitude)) && Number(loc.longitude) !== 0
          ) {
            setFarmerPickups((prev) => ({
              ...prev,
              [farmerId]: {
                latitude: Number(loc.latitude),
                longitude: Number(loc.longitude),
              },
            }));
          }
        })
        .catch(() => { /* pickup stays unknown */ });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOrderModal, selectedProduct]);

  /* Real farmer → consumer trip distance (km) for the farmer
     being checked out, or null when either end is unknown.    */
  const tripKmToFarmer = (farmerId) =>
    getTripKm({
      farmerLocation: farmerPickups[farmerId] || null,
      location: {
        latitude: Number(latitude),
        longitude: Number(longitude),
      },
    });

  /* Distance-based delivery charge for the product being
     ordered — matches what the delivery partner earns. The
     charge is a flat ₹10 (see deliveryEarnings.js).           */
  const checkoutDeliveryCharge = calcDeliveryCharge(
    tripKmToFarmer(selectedProduct?.farmerId)
  );

  /* Real farmer → consumer km for the product being ordered
     (null when the pickup location is unknown).                */
  const checkoutTripKm = tripKmToFarmer(selectedProduct?.farmerId);

  /* Load the cart farmer's pickup when the cart checkout opens
     (same real-pickup logic as the single-product modal).       */
  useEffect(() => {
    if (!cartCheckoutOpen) return;
    if (!cartFarmerId) return;

    getDoc(doc(db, "users", cartFarmerId))
      .then((snap) => {
        const loc = snap.exists() ? snap.data().location : null;
        if (
          loc &&
          Number.isFinite(Number(loc.latitude)) && Number(loc.latitude) !== 0 &&
          Number.isFinite(Number(loc.longitude)) && Number(loc.longitude) !== 0
        ) {
          setFarmerPickups((prev) => ({
            ...prev,
            [cartFarmerId]: {
              latitude: Number(loc.latitude),
              longitude: Number(loc.longitude),
            },
          }));
        }
      })
      .catch(() => { /* pickup stays unknown */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartCheckoutOpen, cartFarmerId]);

  /* Keep farmerPickups fresh for ORDER HISTORY too: resolve the
     farmer's CURRENT profile location for every farmer behind the
     loaded orders. Order cards then measure from the farm's
     present location instead of the farmLocation snapshot frozen
     at checkout — which went stale whenever the farmer fixed a
     wrong farm location after the order was placed.             */
  const pickupsFetchedRef = useRef(new Set());

  useEffect(() => {
    if (!Array.isArray(orders) || orders.length === 0) return;

    const uids = new Set();
    orders.forEach((o) => {
      const uid =
        o?.farmerId ||
        (Array.isArray(o?.farmerIds) ? o.farmerIds[0] : null);
      if (uid) uids.add(uid);
    });

    const toFetch = [...uids].filter(
      (uid) => !pickupsFetchedRef.current.has(uid)
    );
    if (toFetch.length === 0) return;

    // Mark attempted first — never refetch on every orders update.
    toFetch.forEach((uid) => pickupsFetchedRef.current.add(uid));

    toFetch.forEach((uid) => {
      getDoc(doc(db, "users", uid))
        .then((snap) => {
          const loc = snap.exists() ? snap.data().location : null;
          if (
            loc &&
            Number.isFinite(Number(loc.latitude)) && Number(loc.latitude) !== 0 &&
            Number.isFinite(Number(loc.longitude)) && Number(loc.longitude) !== 0
          ) {
            setFarmerPickups((prev) => ({
              ...prev,
              [uid]: {
                latitude: Number(loc.latitude),
                longitude: Number(loc.longitude),
              },
            }));
          }
        })
        .catch(() => { /* pickup stays unknown */ });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  /* Delivery charge for the cart — one farmer, one trip.        */
  const cartDeliveryCharge = calcDeliveryCharge(tripKmToFarmer(cartFarmerId));
  const cartTripKm = tripKmToFarmer(cartFarmerId);
  const cartTotal = cartSubtotal + cartDeliveryCharge;

  // =========================================================
  // PAYMENT
  // =========================================================

  const [paymentMethod, setPaymentMethod] =
    useState("Cash on Delivery");

  const [paymentStatus, setPaymentStatus] =
    useState("pending");

  // =========================================================
  // GENERAL
  // =========================================================

  const [placingOrder, setPlacingOrder] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // =========================================================
  // LOAD USER PROFILE
  // =========================================================

  const loadUserProfile = async () => {
    /* Session read at CALL time — the render-time `currentUser`
       captured in this closure is null when the dashboard mounts
       before Firebase restores the session, which used to kill
       this loader permanently. */
    const currentUser = auth.currentUser;

    if (!currentUser) {
      return;
    }

    try {
      const userRef = doc(
        db,
        "users",
        currentUser.uid
      );

      const userSnapshot = await getDoc(userRef);

      if (userSnapshot.exists()) {
        const data = userSnapshot.data();

        setUserProfile(data);

        // Pre-fill all delivery details from user profile
        setConsumerName(data.name || "");
        setConsumerPhone(data.phone || "");
        setConsumerEmail(
          data.email ||
            currentUser.email ||
            ""
        );
        setAddress(data.address || "");
        setCity(data.city || "");
        setPincode(data.pincode || "");
      } else {
        setConsumerEmail(
          currentUser.email || ""
        );
      }
    } catch (err) {
      console.error(
        "USER PROFILE ERROR:",
        err
      );

      setConsumerEmail(
        currentUser.email || ""
      );
    }
  };

  // =========================================================
  // SAVE USER PROFILE (Delivery Details)
  // =========================================================

  const saveUserProfile = async () => {
    if (!currentUser) return;

    try {
      const userRef = doc(db, "users", currentUser.uid);

      const profileData = {
        name: consumerName.trim(),
        phone: consumerPhone.trim(),
        email: consumerEmail.trim(),
        address: address.trim(),
        city: city.trim(),
        pincode: pincode.trim(),
        updatedAt: serverTimestamp(),
      };

      await updateDoc(userRef, profileData);

      // Update local user profile state
      setUserProfile((prev) => ({ ...prev, ...profileData }));
    } catch (err) {
      console.error("SAVE PROFILE ERROR:", err);
    }
  };

  // =========================================================
  // LOAD PRODUCTS
  // =========================================================

  const loadProducts = async () => {
    try {
      setLoadingProducts(true);
      setError("");

      const snapshot = await getDocs(
        collection(db, "products")
      );

      const productList = snapshot.docs.map(
        (item) => ({
          id: item.id,
          ...item.data(),
        })
      );

      /* FARMER NAMES — older product docs were saved without
         farmerName, so resolve it from the farmers' profiles
         (same users/{uid} reads the location lookups use).   */
      const missingNameIds = [
        ...new Set(
          productList
            .filter(
              (product) =>
                product.farmerId && !product.farmerName
            )
            .map((product) => product.farmerId)
        ),
      ];

      if (missingNameIds.length > 0) {
        const nameByUid = {};

        await Promise.all(
          missingNameIds.map((farmerId) =>
            getDoc(doc(db, "users", farmerId))
              .then((farmerSnap) => {
                if (farmerSnap.exists()) {
                  nameByUid[farmerId] =
                    farmerSnap.data().name || "";
                }
              })
              .catch(() => {
                /* name stays empty — UI falls back */
              })
          )
        );

        productList.forEach((product) => {
          if (
            !product.farmerName &&
            product.farmerId &&
            nameByUid[product.farmerId]
          ) {
            product.farmerName =
              nameByUid[product.farmerId];
          }
        });
      }

      setProducts(productList);
    } catch (err) {
      console.error(
        "PRODUCT LOAD ERROR:",
        err
      );

      setError(
        "Unable to load products. Please check Firestore rules."
      );
    } finally {
      setLoadingProducts(false);
    }
  };

  // =========================================================
  // LOAD ORDERS
  // =========================================================

  // Store the unsubscribe function for the real-time listener
  const ordersUnsubscribeRef = useRef(null);

  const loadOrders = () => {
    /* Session read at CALL time — same stale-closure fix as
       loadUserProfile: the dashboard can mount before the auth
       session restores, and this guard used to bail out forever,
       leaving the orders list without its real-time listener —
       the consumer then kept seeing "Waiting for farmer
       response" even after the farmer had accepted. */
    const currentUser = auth.currentUser;

    if (!currentUser) {
      setLoadingOrders(false);
      return;
    }

    // Unsubscribe from previous listener if exists
    if (ordersUnsubscribeRef.current) {
      ordersUnsubscribeRef.current();
    }

    try {
      setLoadingOrders(true);

      const ordersQuery = query(
        collection(db, "orders"),
        where(
          "consumerId",
          "==",
          currentUser.uid
        )
      );

      // Use onSnapshot for real-time updates
      ordersUnsubscribeRef.current = onSnapshot(
        ordersQuery,
        (snapshot) => {
          const orderList = snapshot.docs.map(
            (item) => ({
              id: item.id,
              ...item.data(),
            })
          );

          orderList.sort((a, b) => {
            const timeA =
              a.createdAt?.seconds || 0;

            const timeB =
              b.createdAt?.seconds || 0;

            return timeB - timeA;
          });

          setOrders(orderList);
          setLoadingOrders(false);
        },
        (err) => {
          console.error(
            "ORDER LOAD ERROR:",
            err
          );

          setError(
            "Unable to load your orders. Please check Firestore rules."
          );
          setLoadingOrders(false);
        }
      );
    } catch (err) {
      console.error(
        "ORDER LOAD ERROR:",
        err
      );

      setError(
        "Unable to load your orders. Please check Firestore rules."
      );
      setLoadingOrders(false);
    }
  };

  // Cleanup the listener on component unmount
  useEffect(() => {
    return () => {
      if (ordersUnsubscribeRef.current) {
        ordersUnsubscribeRef.current();
      }
    };
  }, []);

  // =========================================================
  // CLEAR COMPLETED HISTORY
  // =========================================================

  const isCompletedOrder = (order) => {
    const status = String(
      order.status || order.orderStatus || order.deliveryStatus || ""
    ).toLowerCase();

    return ["delivered", "completed", "cancelled", "rejected"].includes(status);
  };

  const completedOrders = orders.filter(isCompletedOrder);

  const visibleOrders = orders.filter(
    (order) => !hiddenCompletedOrderIds.includes(order.id)
  );

  const clearCompletedHistory = () => {
    if (!currentUser) {
      setError("Please login as a consumer first.");
      return;
    }

    if (completedOrders.length === 0) {
      setMessage("There is no completed order history to clear.");
      setError("");
      return;
    }

    const confirmed = window.confirm(
      `Clear ${completedOrders.length} completed order${completedOrders.length === 1 ? "" : "s"} from your history?\n\n` +
      "This hides them only from your Consumer Dashboard. The actual Firestore orders will not be deleted."
    );

    if (!confirmed) return;

    try {
      setClearingHistory(true);
      const ids = Array.from(
        new Set([...hiddenCompletedOrderIds, ...completedOrders.map((order) => order.id)])
      );

      localStorage.setItem(
        `efarm_completed_history_${currentUser.uid}`,
        JSON.stringify(ids)
      );

      setHiddenCompletedOrderIds(ids);
      setError("");
      setMessage(
        `✅ ${completedOrders.length} completed order${completedOrders.length === 1 ? "" : "s"} cleared from your history.`
      );
    } catch (err) {
      console.error("CLEAR HISTORY ERROR:", err);
      setError("Unable to clear order history on this device.");
    } finally {
      setClearingHistory(false);
    }
  };

  // =========================================================
  // INITIAL LOAD
  // =========================================================

  /* =========================================================
     INITIAL LOAD — auth-aware bootstrap

     The dashboard can mount BEFORE Firebase finishes
     restoring the saved session (cold load / F5).
     `auth.currentUser` is still null in that window, so the
     old fire-once effect silently skipped
     loadUserProfile()/loadOrders() forever — the orders list
     ended up without its real-time onSnapshot listener and
     the consumer kept seeing "Waiting for farmer response"
     even after the farmer had accepted. Everything is now
     (re)bootstrapped the moment the session is ready.
     ========================================================= */

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        loadUserProfile();
        loadProducts();
        loadOrders();
      } else {
        // No session: detach the orders listener, clear state.
        if (ordersUnsubscribeRef.current) {
          ordersUnsubscribeRef.current();
          ordersUnsubscribeRef.current = null;
        }
        setOrders([]);
        setLoadingOrders(false);
        setUserProfile(null);
      }
    });

    return () => unsubAuth();
  }, []);

  // =========================================================
  // CATEGORIES
  // =========================================================

  const categories = useMemo(() => {
    const values = products
      .map((product) =>
        String(
          product.category || ""
        ).trim()
      )
      .filter(Boolean);

    return [
      "all",
      ...Array.from(
        new Set(values)
      ),
    ];
  }, [products]);

  // =========================================================
  // FILTER PRODUCTS
  // =========================================================

  const filteredProducts = useMemo(() => {
    const searchText =
      search.trim().toLowerCase();

    return products.filter(
      (product) => {
        const productName =
          String(
            product.name || ""
          ).toLowerCase();

        const productCategory =
          String(
            product.category || ""
          ).toLowerCase();

        const matchesSearch =
          !searchText ||
          productName.includes(
            searchText
          ) ||
          productCategory.includes(
            searchText
          );

        const matchesCategory =
          category === "all" ||
          productCategory ===
            category.toLowerCase();

        return (
          matchesSearch &&
          matchesCategory
        );
      }
    );
  }, [
    products,
    search,
    category,
  ]);

  // =========================================================
  // STOCK CHECK
  // =========================================================

  const isProductAvailable = (
    product
  ) => {
    const availableQuantity =
      Number(product.quantity) || 0;

    /*
      Important:
      Quantity is the primary availability check.

      This fixes the situation where:
      quantity = 1
      but inStock = false.
    */

    return (
      availableQuantity > 0 &&
      product.inStock !== false
    );
  };

  // =========================================================
  // OPEN ORDER MODAL
  // =========================================================

  const openOrderModal = (product) => {
    setError("");
    setMessage("");

    if (!isProductAvailable(product)) {
      setError("This product is currently out of stock.");
      return;
    }

    setSelectedProduct(product);

    setOrderQuantity(1);

    setAddress("");
    setCity("");
    setPincode("");

    setLatitude("");
    setLongitude("");
    setManualCoords("");

    setLocationMessage("");

    setPaymentMethod("Cash on Delivery");

    setPaymentStatus("pending");

    setShowOrderModal(true);
  };

  // =========================================================
  // CLOSE ORDER MODAL
  // =========================================================

  const closeOrderModal = () => {
    if (placingOrder) {
      return;
    }

    setShowOrderModal(false);
    setSelectedProduct(null);
  };

  // =========================================================
  // CART HANDLERS
  // =========================================================

  /* Add a product to the cart — ONLY items from one farmer's
     shop can share the cart at a time. */
  const addToCart = (product) => {
    if (!product) return;
    setError("");
    setMessage("");

    if (!isProductAvailable(product)) {
      setError("This product is currently out of stock.");
      return;
    }

    if (
      cart.length > 0 &&
      cartFarmerId &&
      product.farmerId &&
      cartFarmerId !== product.farmerId
    ) {
      setError(
        `🛒 Your cart already has items from ${cartFarmerName}'s shop. ` +
        `You can buy from only one farmer at a time — finish or clear that cart before adding items from ${product.farmerName || "this farmer"}.`
      );
      setCartOpen(true); // show the cart so they can review / clear it
      return;
    }

    const availableQty = Number(product.quantity) || 1;
    const existing = cart.find((i) => i.productId === product.id);

    if (existing) {
      const nextQty = Math.min(Number(existing.qty) + 1, availableQty);
      setCart((prev) =>
        prev.map((i) =>
          i.productId === product.id ? { ...i, qty: nextQty } : i
        )
      );
      setMessage(`${product.name} quantity increased to ${nextQty} 🛒`);
    } else {
      setCart((prev) => [
        ...prev,
        {
          productId: product.id,
          name: product.name || "Product",
          price: Number(product.price) || 0,
          category: product.category || "",
          qty: 1,
          maxQty: availableQty,
          farmerId: product.farmerId || "",
          farmerName: product.farmerName || "",
          farmerEmail: product.farmerEmail || "",
        },
      ]);
      setMessage(`${product.name} added to cart 🛒`);
    }
  };

  const changeCartQty = (productId, delta) => {
    setError("");
    const item = cart.find((i) => i.productId === productId);
    if (!item) return;

    const nextQty = Number(item.qty) + delta;
    if (nextQty > (Number(item.maxQty) || 1)) {
      setError(`Only ${item.maxQty || 1} units available for ${item.name}.`);
      return;
    }

    setCart((prev) =>
      prev
        .map((i) => (i.productId === productId ? { ...i, qty: nextQty } : i))
        .filter((i) => Number(i.qty) > 0)
    );
  };

  const removeFromCart = (productId) => {
    setCart((prev) => prev.filter((i) => i.productId !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setMessage("Cart cleared. You can now shop from another farmer's shop 🧺");
  };

  const openCartCheckout = () => {
    setError("");
    setMessage("");

    if (cart.length === 0) {
      setError("Your cart is empty.");
      return;
    }

    if (cartSubtotal < MIN_ORDER_VALUE) {
      setError(
        `Minimum order value is ₹${MIN_ORDER_VALUE}. Add ₹${(MIN_ORDER_VALUE - cartSubtotal).toFixed(2)} more to place this cart order.`
      );
      return;
    }

    // Pre-fill delivery details from the saved profile (same as the
    // single-product checkout — the user can still edit them here).
    setAddress(userProfile?.address || "");
    setCity(userProfile?.city || "");
    setPincode(userProfile?.pincode || "");

    setCartOpen(false);
    setCartCheckoutOpen(true);
  };

  const closeCartCheckout = () => {
    if (placingCartOrder) return;
    setCartCheckoutOpen(false);
  };

  // =========================================================
  // GET LOCATION
  // =========================================================

  const getCurrentLocation = () => {
    setError("");
    setLocationMessage("");

    if (!navigator.geolocation) {
      setLocationMessage(
        "Geolocation is not supported by your browser."
      );
      return;
    }

    setLocationLoading(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat =
          position.coords.latitude;

        const lng =
          position.coords.longitude;

        /* A browser without real GPS returns city-level (IP/Wi-Fi)
           fixes that can be hundreds of km off — and the browser
           usually ADMITS it via coords.accuracy. Never trust a fix
           worse than ±1 km: reject it and point at the map pin /
           pasted coordinates instead.                            */
        const accuracyM = Number(position.coords.accuracy);
        if (Number.isFinite(accuracyM) && accuracyM > 1000) {
          setLocationMessage(
            `⚠️ Your browser's location is unreliable (±${(accuracyM / 1000).toFixed(1)} km) — it was NOT used. Drag the 📍 pin on the map, or paste exact coordinates from Google Maps.`
          );
          setLocationLoading(false);
          return;
        }

        setLatitude(
          lat.toFixed(6)
        );

        setLongitude(
          lng.toFixed(6)
        );

        setLocationMessage(
          `✅ Current location captured successfully${Number.isFinite(accuracyM) ? ` (±${Math.round(accuracyM)} m)` : ""}.`
        );

        setLocationLoading(false);
      },
      (err) => {
        console.error(
          "LOCATION ERROR:",
          err
        );

        setLocationMessage(
          "Unable to get location. Please allow location permission."
        );

        setLocationLoading(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  /* Parse pasted coordinates from almost anything:
     - "14.13773, 79.86397" / "14.13773 79.86397"
     - Google Maps URLs .../@14.13773,79.86397,15z
     - ...?q=14.13773,79.86397 (also %2C-encoded)
     - place URLs with !3d14.13773!4d79.86397
     - "lat: 14.13773, lng: 79.86397" labels
     - degree symbols / compass letters are ignored.          */
  const parseCoordsText = (text) => {
    if (!text) return null;
    let t = String(text).trim();
    try {
      t = decodeURIComponent(t);
    } catch {
      /* keep raw text */
    }
    const N = "-?\\d+(?:\\.\\d+)?";
    const patterns = [
      new RegExp(`@(${N})\\s*,\\s*(${N})`),
      new RegExp(`[?&](?:q|ll|query|destination)=(${N})\\s*,\\s*(${N})`, "i"),
      new RegExp(`!3d(${N})\\s*,?\\s*!4d(${N})`),
      new RegExp(
        `lat(?:itude)?\\s*[:=]?\\s*(${N})\\s*[,;\\s]+(?:lng|lon|long|longitude)\\s*[:=]?\\s*(${N})`,
        "i"
      ),
    ];
    for (const re of patterns) {
      const m = t.match(re);
      if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
    }
    /* Bare text only — URLs without a recognized pattern would
       otherwise yield garbage numbers (zoom levels etc.).      */
    if (/https?:\/\//i.test(t)) return null;
    const cleaned = t
      .replace(/[°º]/g, "")
      .replace(/\b[NnSsEeWw]\b/g, "");
    const nums = cleaned.match(new RegExp(N, "g")) || [];
    if (nums.length >= 2) {
      return { lat: Number(nums[0]), lng: Number(nums[1]) };
    }
    return null;
  };

  const applyManualCoords = () => {
    const raw = String(manualCoords || "").trim();
    if (!raw) {
      setLocationMessage(
        '📌 Type or paste coordinates first — e.g. "14.13773, 79.86397". In Google Maps: press & hold (or right-click) the delivery spot, then copy the numbers that appear.'
      );
      return;
    }
    const c = parseCoordsText(raw);
    if (
      !c ||
      !Number.isFinite(c.lat) || c.lat === 0 || Math.abs(c.lat) > 90 ||
      !Number.isFinite(c.lng) || c.lng === 0 || Math.abs(c.lng) > 180
    ) {
      setLocationMessage(
        /goo\.gl|maps\.app/i.test(raw)
          ? "🔗 Short share links hide the coordinates. Open the link in a browser tab first, then copy the full URL (it contains @lat,lng) — or drag the 📍 pin on the map below."
          : '⚠️ Could not read that. Paste coordinates like "14.13773, 79.86397" — or drag the 📍 pin on the map below.'
      );
      return;
    }
    setLatitude(c.lat.toFixed(6));
    setLongitude(c.lng.toFixed(6));
    setLocationMessage("✅ Drop point set from pasted coordinates (exact).");
  };

  const setDropFromMap = (lat, lng) => {
    setLatitude(lat.toFixed(6));
    setLongitude(lng.toFixed(6));
    setLocationMessage("✅ Drop point set from the map pin.");
  };

  // =========================================================
  // TOTAL
  // =========================================================

  const orderTotal = selectedProduct
    ? (Number(
        selectedProduct.price
      ) || 0) *
      (Number(orderQuantity) || 0)
    : 0;

  // =========================================================
  // PLACE ORDER (Single Product — Buy Now)
  // =========================================================

  const handlePlaceOrder = async (e) => {
    e.preventDefault();

    setError("");
    setMessage("");

    if (!currentUser) {
      setError("Please login as a consumer first.");
      return;
    }

    // -------------------------------------------------------
    // VALIDATION
    // -------------------------------------------------------

    if (!consumerName.trim()) {
      setError(
        "Please enter your name."
      );
      return;
    }

    if (!consumerPhone.trim()) {
      setError(
        "Please enter your mobile number."
      );
      return;
    }

    if (
      consumerPhone.replace(
        /\D/g,
        ""
      ).length < 10
    ) {
      setError(
        "Please enter a valid mobile number."
      );
      return;
    }

    if (!consumerEmail.trim()) {
      setError(
        "Please enter your email."
      );
      return;
    }

    if (!address.trim()) {
      setError(
        "Please enter your delivery address."
      );
      return;
    }

    if (!city.trim()) {
      setError(
        "Please enter your city."
      );
      return;
    }

    if (!pincode.trim()) {
      setError(
        "Please enter your PIN code."
      );
      return;
    }

    if (
      pincode.replace(
        /\D/g,
        ""
      ).length !== 6
    ) {
      setError(
        "Please enter a valid 6-digit PIN code."
      );
      return;
    }

    if (!latitude || !longitude) {
      setError("Please capture your delivery location.");
      return;
    }

    // -------------------------------------------------------
    // SINGLE PRODUCT CHECKOUT
    // -------------------------------------------------------

    if (!selectedProduct) {
      setError("Please select a product.");
      return;
    }

    const numericQuantity = Number(orderQuantity);

    const availableQuantity =
      Number(
        selectedProduct.quantity
      ) || 0;

    if (
      !Number.isInteger(
        numericQuantity
      ) ||
      numericQuantity <= 0
    ) {
      setError(
        "Please enter a valid quantity."
      );
      return;
    }

    if (
      numericQuantity >
      availableQuantity
    ) {
      setError(
        `Only ${availableQuantity} units are available.`
      );
      return;
    }

    if (
      selectedProduct.inStock === false
    ) {
      setError(
        "Farmer has marked this product out of stock."
      );
      return;
    }

    const numericPrice =
      Number(
        selectedProduct.price
      ) || 0;

    const totalAmount =
      numericPrice *
      numericQuantity;

    if (
      totalAmount < MIN_ORDER_VALUE
    ) {
      setError(
        `Minimum order value is ₹${MIN_ORDER_VALUE}. Please increase the quantity.`
      );

      return;
    }

    // -------------------------------------------------------
    // PAYMENT
    // -------------------------------------------------------

    /*
      For a college/demo project:

      Cash on Delivery:
        paymentStatus = pending

      Online:
        paymentStatus = pending

      Later you can connect Razorpay/Stripe.
    */

    const finalPaymentStatus =
      paymentMethod ===
      "Cash on Delivery"
        ? "pending"
        : paymentStatus || "pending";

    try {
      setPlacingOrder(true);

      // -----------------------------------------------------
      // EXACT ORDER STRUCTURE
      // -----------------------------------------------------

      // Calculate payment breakdown
      // Distance-based delivery charge (real farmer → consumer
      // km), matching what the delivery partner will earn.
      const deliveryCharge = calcDeliveryCharge(
        tripKmToFarmer(selectedProduct.farmerId)
      );
      const commission = Math.max(10, Math.min(120, totalAmount * 0.05)); // 5% commission, min 10, max 120
      const farmerShare = totalAmount - commission; // Farmer gets order total minus commission

      const orderData = {
        // Product
        productId: selectedProduct.id,
        productName: selectedProduct.name || "",
        category: selectedProduct.category || "",
        farmerId: selectedProduct.farmerId || "",
        farmerEmail: selectedProduct.farmerEmail || "",
        farmerName: selectedProduct.farmerName || "",
        price: numericPrice,
        quantity: numericQuantity,
        totalAmount: totalAmount,
        // Payment breakdown
        deliveryCharge: deliveryCharge,
        commission: commission,
        farmerShare: farmerShare,
        platformEarning: commission,
        // Consumer
        consumerId: currentUser.uid,
        consumerName: consumerName.trim(),
        consumerEmail: consumerEmail.trim(),
        consumerPhone: consumerPhone.trim(),
        // Delivery
        address: address.trim(),
        city: city.trim(),
        pincode: pincode.trim(),
        deliveryAddress: address.trim(),
        // Location
        location: { latitude: Number(latitude), longitude: Number(longitude) },
        // Farm anchor — the pickup point the delivery charge was
        // quoted from (the farmer's saved farm location). Kept on
        // the order so every dashboard measures the SAME
        // farm → consumer distance, no matter where the farmer
        // happens to accept from.
        farmLocation: farmerPickups[selectedProduct.farmerId] || null,
        // Payment
        paymentMethod: paymentMethod,
        paymentStatus: finalPaymentStatus,
        transactionId: "",
        // Order state
        status: "pending",
        farmerResponseAt: null,
        createdAt: serverTimestamp(),
      };

      console.log(
        "CREATING ORDER:",
        orderData
      );

      // -----------------------------------------------------
      // SAVE ORDER
      // -----------------------------------------------------

      const orderRef =
        await addDoc(
          collection(db, "orders"),
          orderData
        );

      console.log(
        "ORDER CREATED:",
        orderRef.id
      );

      // -----------------------------------------------------
      // UPDATE LOCAL ORDERS
      // -----------------------------------------------------

      setOrders(
        (previousOrders) => [
          {
            id: orderRef.id,

            ...orderData,

            createdAt: {
              toDate: () =>
                new Date(),
            },
          },

          ...previousOrders,
        ]
      );

      // -----------------------------------------------------
      // REDUCE LOCAL PRODUCT STOCK
      // -----------------------------------------------------

      setProducts(
        (previousProducts) =>
          previousProducts.map(
            (product) => {
              if (
                product.id !==
                selectedProduct.id
              ) {
                return product;
              }

              const remaining =
                Math.max(
                  0,
                  (Number(
                    product.quantity
                  ) || 0) -
                    numericQuantity
                );

              return {
                ...product,

                quantity:
                  remaining,

                inStock:
                  remaining > 0 &&
                  product.inStock !==
                    false,
              };
            }
          )
      );

      // -----------------------------------------------------
      // SUCCESS
      // -----------------------------------------------------

      setMessage(
        `✅ Order placed successfully! Order ID: ${orderRef.id}`
      );

      setShowOrderModal(false);
      setSelectedProduct(null);

      // Save delivery details to user profile for future orders
      await saveUserProfile();

      // Refresh from Firebase
      loadOrders();
      await loadProducts();
    } catch (err) {
      console.error(
        "PLACE ORDER ERROR:",
        err
      );

      if (
        err?.code ===
        "permission-denied"
      ) {
        setError(
          "Order permission denied by Firestore rules."
        );
      } else {
        setError(
          err?.message ||
            "Unable to place order."
        );
      }
    } finally {
      setPlacingOrder(false);
    }
  };

// =========================================================
  // PLACE CART ORDER (multi-product, one farmer shop)
  // =========================================================

  const handlePlaceCartOrder = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!currentUser) {
      setError("Please login as a consumer first.");
      return;
    }

    if (cart.length === 0) {
      setError("Your cart is empty.");
      return;
    }

    // -------------------------------------------------------
    // CONSUMER VALIDATION (same rules as the single checkout)
    // -------------------------------------------------------

    if (!consumerName.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (!consumerPhone.trim()) {
      setError("Please enter your mobile number.");
      return;
    }
    if (consumerPhone.replace(/\D/g, "").length < 10) {
      setError("Please enter a valid mobile number.");
      return;
    }
    if (!consumerEmail.trim()) {
      setError("Please enter your email.");
      return;
    }
    if (!address.trim()) {
      setError("Please enter your delivery address.");
      return;
    }
    if (!city.trim()) {
      setError("Please enter your city.");
      return;
    }
    if (!pincode.trim()) {
      setError("Please enter your PIN code.");
      return;
    }
    if (pincode.replace(/\D/g, "").length !== 6) {
      setError("Please enter a valid 6-digit PIN code.");
      return;
    }
    if (!latitude || !longitude) {
      setError("Please capture your delivery location.");
      return;
    }

    const subtotal = cartSubtotal;

    if (subtotal < MIN_ORDER_VALUE) {
      setError(
        `Minimum order value is ₹${MIN_ORDER_VALUE}. Add ₹${(MIN_ORDER_VALUE - subtotal).toFixed(2)} more.`
      );
      return;
    }

    // -------------------------------------------------------
    // BUILD ITEMS / FARMER (single shop per cart)
    // -------------------------------------------------------

    const items = cart.map((i) => ({
      productId: i.productId,
      productName: i.name,
      name: i.name,
      category: i.category || "",
      price: Number(i.price) || 0,
      quantity: Number(i.qty) || 0,
      totalAmount: (Number(i.price) || 0) * (Number(i.qty) || 0),
      farmerId: i.farmerId || "",
      farmerName: i.farmerName || "Farmer",
      farmerEmail: i.farmerEmail || "",
    }));

    const farmerDetails = [
      {
        farmerId: cartFarmerId,
        farmerName: cartFarmerName,
        farmerEmail: cart[0]?.farmerEmail || "",
      },
    ].filter((f) => f.farmerId);

    const firstItem = cart[0] || {};

    const deliveryCharge = cartDeliveryCharge;
    const commission = Math.max(10, Math.min(120, subtotal * 0.05)); // 5%, min 10, max 120
    const farmerShare = subtotal - commission;

    const orderData = {
      // Cart metadata (multi-item order — the dashboards already
      // know how to render this shape: items, farmerIds, ...)
      items: items,
      itemCount: cartCount,
      farmerIds: [cartFarmerId].filter(Boolean),
      farmerCount: 1,
      farmerDetails: farmerDetails,
      subtotal: subtotal,

      // Farmer (single shop per cart)
      farmerId: cartFarmerId || firstItem.farmerId || "",
      farmerEmail: firstItem.farmerEmail || "",
      farmerName: firstItem.farmerName || "",

      // Aggregate product fields (kept in sync with items)
      price: subtotal,
      quantity: cartCount,
      totalAmount: subtotal,

      // Payment breakdown (matches the single-product model:
      // the consumer pays subtotal + a delivery charge)
      deliveryCharge: deliveryCharge,
      commission: commission,
      farmerShare: farmerShare,
      platformEarning: commission,

      // Consumer
      consumerId: currentUser.uid,
      consumerName: consumerName.trim(),
      consumerEmail: consumerEmail.trim(),
      consumerPhone: consumerPhone.trim(),

      // Delivery
      address: address.trim(),
      city: city.trim(),
      pincode: pincode.trim(),
      deliveryAddress: address.trim(),

      // Location
      location: { latitude: Number(latitude), longitude: Number(longitude) },

      // Farm anchor — the pickup point the delivery charge was
      // quoted from (the cart farmer's saved farm location). Kept
      // on the order so every dashboard measures the SAME
      // farm → consumer distance, no matter where the farmer
      // happens to accept from.
      farmLocation: farmerPickups[cartFarmerId] || null,

      // Payment
      paymentMethod: paymentMethod,
      paymentStatus:
        paymentMethod === "Cash on Delivery"
          ? "pending"
          : paymentStatus || "pending",
      transactionId: "",

      // Order state
      status: "pending",
      farmerResponseAt: null,
      createdAt: serverTimestamp(),
    };

    try {
      setPlacingCartOrder(true);

      const orderRef = await addDoc(collection(db, "orders"), orderData);

      // -----------------------------------------------------
      // UPDATE LOCAL ORDERS (instant feedback)
      // -----------------------------------------------------

      setOrders((previousOrders) => [
        {
          id: orderRef.id,
          ...orderData,
          createdAt: { toDate: () => new Date() },
        },
        ...previousOrders,
      ]);

      // -----------------------------------------------------
      // REDUCE LOCAL PRODUCT STOCK
      // -----------------------------------------------------

      setProducts((previousProducts) =>
        previousProducts.map((product) => {
          const line = cart.find((i) => i.productId === product.id);
          if (!line) return product;
          const remaining = Math.max(
            0,
            (Number(product.quantity) || 0) - (Number(line.qty) || 0)
          );
          return {
            ...product,
            quantity: remaining,
            inStock: remaining > 0 && product.inStock !== false,
          };
        })
      );

      // -----------------------------------------------------
      // SUCCESS
      // -----------------------------------------------------

      setMessage(`✅ Cart order placed successfully! Order ID: ${orderRef.id}`);

      setCart([]);
      setCartCheckoutOpen(false);

      // Save delivery details to user profile for future orders
      await saveUserProfile();

      loadOrders();
      await loadProducts();
    } catch (err) {
      console.error("PLACE CART ORDER ERROR:", err);
      setError(
        err?.code === "permission-denied"
          ? "Order permission denied by Firestore rules."
          : err?.message || "Unable to place cart order."
      );
    } finally {
      setPlacingCartOrder(false);
    }
  };
  // =========================================================
  // DATE FORMAT
  // =========================================================

  const formatDate = (
    timestamp
  ) => {
    if (!timestamp) {
      return "Date unavailable";
    }

    try {
      const date =
        timestamp.toDate
          ? timestamp.toDate()
          : new Date(timestamp);

      return date.toLocaleString();
    } catch {
      return "Date unavailable";
    }
  };

  // =========================================================
  // STATUS CLASS
  // =========================================================

  const getStatusClass = (
    status
  ) => {
    switch (status) {
      case "accepted":
        return "consumer-status accepted";

      case "rejected":
        return "consumer-status rejected";

      case "delivered":
        return "consumer-status delivered";

      case "cancelled":
        return "consumer-status cancelled";

      default:
        return "consumer-status pending";
    }
  };

  // =========================================================
  // STATISTICS
  // =========================================================

  const pendingOrders =
    visibleOrders.filter(
      (order) =>
        !order.status ||
        order.status === "pending"
    );

  const acceptedOrders =
    visibleOrders.filter(
      (order) =>
        order.status ===
        "accepted"
    );

  const availableProducts =
    products.filter(
      (product) =>
        isProductAvailable(product)
    );

  // =========================================================
// =========================================================
  // STYLES — matching the Delivery Dashboard panel look
  // =========================================================

  const firstName = String(
    userProfile?.name || consumerName || "Consumer"
  )
    .split(" ")[0]
    .trim();

  const todayStr = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const todayDay = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
  });

  const cdStyles = `
    * { box-sizing: border-box; }

    .cd-app { display: flex; min-height: 100vh; background: #f5f7f6; color: #16211a; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }

    /* ---------------- SIDEBAR ---------------- */
    .cd-sidebar { width: 250px; flex-shrink: 0; position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; padding: 16px 13px; background: linear-gradient(180deg, #0c3a20 0%, #11402a 55%, #0d3520 100%); overflow-y: auto; z-index: 50; }
    .cd-brand { display: flex; align-items: center; gap: 11px; padding: 4px 6px 16px; border-bottom: 1px solid rgba(255,255,255,0.09); }
    .cd-brand-logo { width: 40px; height: 40px; border-radius: 11px; background: #22c55e; display: flex; align-items: center; justify-content: center; font-size: 20px; box-shadow: 0 6px 16px rgba(34,197,94,0.35); }
    .cd-brand-name { color: #fff; font-size: 18px; font-weight: 800; }
    .cd-brand-sub { color: #93c4a3; font-size: 11.5px; margin-top: 1px; }
    .cd-nav { display: flex; flex-direction: column; gap: 3px; margin-top: 14px; }
    .cd-nav button { display: flex; align-items: center; gap: 11px; width: 100%; padding: 11px 13px; border: none; border-radius: 10px; background: transparent; color: #cfe3d6; font-family: inherit; font-size: 13.5px; font-weight: 600; text-align: left; cursor: pointer; transition: background .15s ease, color .15s ease; }
    .cd-nav button:hover { background: rgba(255,255,255,0.07); color: #fff; }
    .cd-nav button.active { background: #16a34a; color: #fff; box-shadow: 0 8px 18px rgba(22,163,74,0.4); }
    .cd-nav-ico { font-size: 15px; width: 20px; text-align: center; }
    .cd-nav-badge { margin-left: auto; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: #ef4444; color: #fff; font-size: 10.5px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
    .cd-side-profile { margin-top: auto; padding: 14px; border-radius: 14px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); }
    .cd-side-avatar { width: 44px; height: 44px; border-radius: 50%; background: #dcfce7; display: flex; align-items: center; justify-content: center; font-size: 21px; margin-bottom: 9px; }
    .cd-side-name { color: #fff; font-size: 14.5px; font-weight: 800; }
    .cd-side-role { color: #9dc3aa; font-size: 11.5px; margin-top: 1px; }
    .cd-scrim { display: none; }

    /* ---------------- TOPBAR ---------------- */
    .cd-main { flex: 1; min-width: 0; max-width: 1480px; margin: 0 auto; padding: 20px 26px 46px; }
    .cd-topbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 18px; }
    .cd-burger { display: none; width: 41px; height: 41px; border: 1px solid #e0e9e2; border-radius: 11px; background: #fff; font-size: 17px; cursor: pointer; align-items: center; justify-content: center; flex-shrink: 0; }
    .cd-welcome { margin: 0; color: #5f6f64; font-size: 13.5px; font-weight: 600; }
    .cd-topbar h1 { margin: 3px 0 4px; color: #141d16; font-size: 26px; font-weight: 900; }
    .cd-topbar-sub { margin: 0; color: #75827a; font-size: 13.5px; }
    .cd-topbar-right { display: flex; align-items: center; gap: 11px; flex-shrink: 0; }
    .cd-datecard { display: flex; align-items: center; gap: 10px; padding: 8px 14px; background: #fff; border: 1px solid #e0e9e2; border-radius: 12px; }
    .cd-datecard-ico { font-size: 18px; }
    .cd-datecard-date { font-size: 13.5px; font-weight: 800; color: #141d16; white-space: nowrap; }
    .cd-datecard-day { font-size: 11.5px; color: #75827a; }

    /* ---------------- ALERTS ---------------- */
    .cd-msg { margin-bottom: 15px; padding: 13px 16px; border-radius: 12px; font-weight: 700; font-size: 13.5px; }
    .cd-msg.ok { background: #e8f5e9; border: 1px solid #c8e6c9; color: #2e7d32; }
    .cd-msg.err { background: #ffebee; border: 1px solid #ffcdd2; color: #c62828; }

    /* ---------------- STATS ---------------- */
    .cd-stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 13px; margin-bottom: 18px; }
    .cd-stat { display: flex; align-items: center; gap: 12px; padding: 15px 16px; background: #fff; border: 1px solid #e4ece6; border-radius: 14px; box-shadow: 0 6px 18px rgba(20,40,26,0.04); }
    .cd-stat-ico { width: 46px; height: 46px; border-radius: 13px; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
    .cd-stat-ico.green { background: #dcfce7; }
    .cd-stat-ico.blue { background: #dbeafe; }
    .cd-stat-ico.amber { background: #fef3c7; }
    .cd-stat-ico.purple { background: #ede9fe; }
    .cd-stat-ico.red { background: #fee2e2; }
    .cd-stat-label { margin: 0; font-size: 10.5px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; }
    .cd-stat-label.green { color: #16a34a; }
    .cd-stat-label.blue { color: #2563eb; }
    .cd-stat-label.amber { color: #d97706; }
    .cd-stat-label.purple { color: #7c3aed; }
    .cd-stat-label.red { color: #dc2626; }
    .cd-stat-value { margin: 2px 0 0; font-size: 21px; font-weight: 900; color: #141d16; }
    .cd-stat-sub { margin: 2px 0 0; font-size: 10.5px; color: #8b998f; }

    /* ---------------- GRID & CARDS ---------------- */
    .cd-grid { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 18px; align-items: start; }
    .cd-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .cd-col-side { display: flex; flex-direction: column; gap: 16px; min-width: 0; position: sticky; top: 18px; }
    .cd-card { background: #fff; border: 1px solid #e4ece6; border-radius: 16px; padding: 20px; box-shadow: 0 6px 18px rgba(20,40,26,0.04); }
    .cd-card-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .cd-card-ico { width: 42px; height: 42px; border-radius: 12px; background: #f0fdf4; border: 1px solid #d6f0dc; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
    .cd-card-title { font-size: 16.5px; font-weight: 800; color: #141d16; }
    .cd-card-sub { font-size: 12.5px; color: #75827a; margin-top: 2px; }

    .cd-empty { padding: 22px; min-height: 130px; border: 1px dashed #cad8c7; border-radius: 14px; background: #fbfdfb; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; color: #68766d; font-size: 13.5px; }
    .cd-empty-icon { font-size: 34px; }
    .cd-chip { display: inline-block; padding: 4px 9px; border-radius: 999px; font-size: 11px; font-weight: 800; }
    .cd-prod-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(235px, 1fr)); gap: 16px; }
    .cd-prod-img { width: 100%; height: 165px; border-radius: 13px; background: linear-gradient(135deg, #eaf6ea, #d7ecd9); display: flex; align-items: center; justify-content: center; font-size: 62px; overflow: hidden; position: relative; }
    .cd-prod-img img { width: 100%; height: 100%; object-fit: cover; position: absolute; inset: 0; }
    .cd-hint { font-size: 12.5px; color: #75827a; }

    .cd-refresh { display: flex; justify-content: center; margin-top: 6px; }
    .cd-refresh button { padding: 11px 26px; border: 1px solid #d4dfd2; border-radius: 11px; background: #fff; color: #456047; font-family: inherit; font-weight: 700; font-size: 13px; cursor: pointer; }
    .cd-refresh button:hover { background: #f4faf4; }

    /* ---------------- SIDE INFO CARDS ---------------- */
    .cd-info-row { display: flex; gap: 10px; padding: 9px 0; border-bottom: 1px dashed #e5ede7; font-size: 12.5px; color: #54655c; }
    .cd-info-row:last-child { border-bottom: none; }
    .cd-info-ico { font-size: 16px; width: 22px; text-align: center; flex-shrink: 0; }
    .cd-side-note { margin-top: 14px; padding: 12px; border-radius: 11px; background: #f0fdf4; border: 1px solid #d6f0dc; font-size: 12px; color: #2e7d32; line-height: 1.55; }
    .cd-notif { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px dashed #e5ede7; font-size: 12.5px; color: #54655c; align-items: flex-start; }
    .cd-notif:last-child { border-bottom: none; }
    .cd-notif-ico { font-size: 16px; flex-shrink: 0; }

    /* ---------------- RESPONSIVE ---------------- */
    @media (max-width: 1280px) { .cd-stats { grid-template-columns: repeat(3, 1fr); } .cd-grid { grid-template-columns: minmax(0, 1fr); } .cd-col-side { position: static; } }
    @media (max-width: 900px) {
      .cd-sidebar { position: fixed; left: 0; top: 0; bottom: 0; transform: translateX(-105%); transition: transform .25s ease; }
      .cd-sidebar.cd-open { transform: none; box-shadow: 0 0 60px rgba(0,0,0,0.4); }
      .cd-scrim { display: block; position: fixed; inset: 0; background: rgba(9,26,15,0.45); z-index: 40; }
      .cd-burger { display: flex; }
      .cd-main { padding: 16px 16px 40px; }
    }
    @media (max-width: 760px) { .cd-stats { grid-template-columns: repeat(2, 1fr); } .cd-datecard { display: none; } .cd-prod-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); } }
    @media (max-width: 460px) { .cd-stats { grid-template-columns: 1fr; } .cd-topbar { flex-wrap: wrap; } }

    /* ---------------- DEDICATED SECTION VIEWS ---------------- */
    .cd-main.cd-view-shop .cd-stats,
    .cd-main.cd-view-orders .cd-stats { display: none; }
    .cd-main.cd-view-shop .cd-grid,
    .cd-main.cd-view-orders .cd-grid { grid-template-columns: minmax(0, 1fr); }
    .cd-main.cd-view-shop .cd-col-side,
    .cd-main.cd-view-orders .cd-col-side { display: none; }
    .cd-main.cd-view-shop .cd-col > section:not(#cd-sec-shop),
    .cd-main.cd-view-orders .cd-col > section:not(#cd-sec-orders) { display: none; }
    .cd-main.cd-view-shop .cd-col,
    .cd-main.cd-view-orders .cd-col { width: 100%; }

    /* ---------------- CART BUTTON ---------------- */
    .cd-cart-btn {
      position: relative;
      border: none;
      background: #e8f5e9;
      border-radius: 12px;
      padding: 10px 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }
    .cd-cart-btn:hover { background: #c8e6c9; }
    .cd-cart-btn-ico { font-size: 22px; }
    .cd-cart-badge {
      position: absolute;
      top: -6px;
      right: -6px;
      background: #c62828;
      color: #fff;
      font-size: 11px;
      font-weight: 800;
      min-width: 20px;
      height: 20px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 5px;
    }

    /* ---------------- CART DRAWER OVERLAY ---------------- */
    .cd-cart-overlay {
      position: fixed;
      inset: 0;
      background: rgba(9, 26, 15, 0.5);
      z-index: 100;
    }

    /* ---------------- CART DRAWER ---------------- */
    .cd-cart-drawer {
      position: fixed;
      top: 0;
      right: 0;
      width: 420px;
      max-width: 100%;
      height: 100vh;
      background: #fff;
      z-index: 101;
      display: flex;
      flex-direction: column;
      box-shadow: -5px 0 30px rgba(0, 0, 0, 0.15);
      animation: cdCartSlideIn 0.25s ease;
    }
    @keyframes cdCartSlideIn {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }

    .cd-cart-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px;
      border-bottom: 1px solid #e4ece6;
    }
    .cd-cart-header h2 { margin: 0; font-size: 18px; font-weight: 800; }
    .cd-cart-close {
      border: none;
      background: none;
      font-size: 24px;
      cursor: pointer;
      color: #6b7280;
      padding: 5px;
    }
    .cd-cart-close:hover { color: #c62828; }

    .cd-cart-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px 24px;
    }

    .cd-cart-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #6b7280;
      text-align: center;
    }
    .cd-cart-empty-ico { font-size: 60px; margin-bottom: 16px; }

    /* ---------------- CART FARMER GROUP ---------------- */
    .cd-cart-farmer {
      margin-bottom: 20px;
      border: 1px solid #e4ece6;
      border-radius: 12px;
      overflow: hidden;
    }
    .cd-cart-farmer-header {
      background: #f0fdf4;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #e4ece6;
    }
    .cd-cart-farmer-name { font-weight: 700; font-size: 14px; color: #166534; }
    .cd-cart-farmer-subtotal { font-weight: 800; font-size: 14px; color: #2e7d32; }

    .cd-cart-items { padding: 12px 16px; }

    .cd-cart-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .cd-cart-item:last-child { border-bottom: none; }

    .cd-cart-item-emoji { font-size: 28px; flex-shrink: 0; }
    .cd-cart-item-info { flex: 1; min-width: 0; }
    .cd-cart-item-name { font-weight: 700; font-size: 13px; color: #141d16; }
    .cd-cart-item-meta { display: flex; gap: 8px; margin-top: 2px; flex-wrap: wrap; }
    .cd-cart-item-category { font-size: 10px; color: #2e7d32; background: #e8f5e9; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
    .cd-cart-item-farmer { font-size: 10px; color: #6b7280; }
    .cd-cart-item-price { font-size: 12px; color: #6b7280; margin-top: 4px; }
    .cd-cart-item-price strong { color: #2e7d32; }

    .cd-cart-qty {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .cd-cart-qty button {
      width: 28px;
      height: 28px;
      border: 1px solid #d7e1d4;
      background: #fff;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .cd-cart-qty button:hover { background: #e8f5e9; }
    .cd-cart-qty span { font-weight: 700; font-size: 14px; min-width: 20px; text-align: center; }

    .cd-cart-item-remove {
      border: none;
      background: none;
      color: #c62828;
      cursor: pointer;
      font-size: 18px;
      padding: 4px;
    }
    .cd-cart-item-remove:hover { background: #ffebee; border-radius: 4px; }

    /* ---------------- CART FOOTER ---------------- */
    .cd-cart-footer {
      padding: 20px 24px;
      border-top: 1px solid #e4ece6;
      background: #f9faf9;
    }
    .cd-cart-summary {
      margin-bottom: 16px;
    }
    .cd-cart-summary-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 13px;
      color: #6b7280;
    }
    .cd-cart-total {
      display: flex;
      justify-content: space-between;
      padding-top: 12px;
      border-top: 2px solid #e4ece6;
      font-size: 16px;
      font-weight: 800;
      color: #141d16;
    }
    .cd-cart-total span:last-child { color: #2e7d32; }

    .cd-cart-checkout-btn {
      width: 100%;
      border: none;
      padding: 14px;
      border-radius: 12px;
      background: #2e7d32;
      color: #fff;
      font-weight: 800;
      font-size: 15px;
      cursor: pointer;
      margin-bottom: 10px;
      transition: background 0.2s;
    }
    .cd-cart-checkout-btn:hover { background: #1b5e20; }
    .cd-cart-checkout-btn:disabled { background: #cbd5cb; cursor: not-allowed; }

    .cd-cart-clear-btn {
      width: 100%;
      border: 1px solid #ffcdd2;
      padding: 10px;
      border-radius: 12px;
      background: #fff;
      color: #c62828;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
    }
    .cd-cart-clear-btn:hover { background: #ffebee; }

    /* ---------------- MINIMUM ORDER WARNING ---------------- */
    .cd-cart-min-order {
      padding: 10px 14px;
      margin-bottom: 12px;
      background: #fff8e1;
      border: 1px solid #ffe082;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 700;
      color: #f57f17;
      text-align: center;
    }
    .cd-cart-checkout-btn:disabled {
      background: #cbd5cb;
      cursor: not-allowed;
    }

    /* ---------------- TOAST NOTIFICATION ---------------- */
    .cd-toast {
      position: fixed;
      top: 24px;
      right: 24px;
      z-index: 200;
      padding: 14px 20px;
      border-radius: 12px;
      font-weight: 700;
      font-size: 14px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
      animation: cdToastSlideIn 0.3s ease;
      max-width: 400px;
    }
    @keyframes cdToastSlideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    .cd-toast.success {
      background: #e8f5e9;
      border: 1px solid #c8e6c9;
      color: #2e7d32;
    }
    .cd-toast.warning {
      background: #fff8e1;
      border: 1px solid #ffe082;
      color: #f57f17;
    }
    .cd-toast.error {
      background: #ffebee;
      border: 1px solid #ffcdd2;
      color: #c62828;
    }

  `;
  // =========================================================
  // PAGE
  // =========================================================

  return (
    <>
      <style>{cdStyles}</style>

      <div className="cd-app">
        {/* ==================== SIDEBAR ==================== */}

        <aside className={"cd-sidebar" + (sidebarOpen ? " cd-open" : "")}>
          <div className="cd-brand">
            <div className="cd-brand-logo">🌾</div>
            <div>
              <div className="cd-brand-name">E-Farm</div>
              <div className="cd-brand-sub">Consumer Panel</div>
            </div>
          </div>

          <nav className="cd-nav">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                className={activeNav === item.id ? "active" : ""}
                onClick={() => go(item.id)}
              >
                <span className="cd-nav-ico">{item.icon}</span>
                {item.label}
                {item.id === "orders" && visibleOrders.length > 0 && (
                  <span className="cd-nav-badge">
                    {visibleOrders.length > 9 ? "9+" : visibleOrders.length}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="cd-side-profile">
            <div className="cd-side-avatar">🛒</div>
            <div className="cd-side-name">{firstName}</div>
            <div className="cd-side-role">Consumer</div>
          </div>
        </aside>

        {sidebarOpen && (
          <div className="cd-scrim" onClick={() => setSidebarOpen(false)} />
        )}

        {/* ==================== MAIN ==================== */}

        <main className={"cd-main" + (view !== "dashboard" ? " cd-view-" + view : "")}>
          <header className="cd-topbar">
            <button
              type="button"
              className="cd-burger"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              ☰
            </button>

            <div>
              <p className="cd-welcome">Welcome back, {firstName}! 👋</p>
              <h1>Consumer Dashboard</h1>
              <p className="cd-topbar-sub">
                Fresh farm produce, straight from local farmers.
              </p>
            </div>

            <div className="cd-topbar-right">
              <div className="cd-datecard">
                <div className="cd-datecard-ico">📅</div>
                <div>
                  <div className="cd-datecard-date">{todayStr}</div>
                  <div className="cd-datecard-day">{todayDay}</div>
                </div>
              </div>

              <button
                type="button"
                className="cd-cart-btn"
                onClick={() => setCartOpen(true)}
                aria-label="Open cart"
              >
                <span className="cd-cart-btn-ico">🛒</span>
                {cartCount > 0 && (
                  <span className="cd-cart-badge">
                    {cartCount > 99 ? "99+" : cartCount}
                  </span>
                )}
              </button>
            </div>
          </header>

      {/* =====================================================
          MESSAGES
      ===================================================== */}

      {message && (
        <div className="cd-msg ok">{message}</div>
      )}

      {error && (
        <div className="cd-msg err">{error}</div>
      )}

      {/* =====================================================
          STATS
      ===================================================== */}

      <section className="cd-stats">
        <div className="cd-stat">
          <div className="cd-stat-ico green">🥕</div>
          <div>
            <p className="cd-stat-label green">Available Products</p>
            <p className="cd-stat-value">{availableProducts.length}</p>
            <p className="cd-stat-sub">Fresh from farmers</p>
          </div>
        </div>

        <div className="cd-stat">
          <div className="cd-stat-ico blue">📦</div>
          <div>
            <p className="cd-stat-label blue">My Orders</p>
            <p className="cd-stat-value">{visibleOrders.length}</p>
            <p className="cd-stat-sub">Total placed</p>
          </div>
        </div>

        <div className="cd-stat">
          <div className="cd-stat-ico amber">⏳</div>
          <div>
            <p className="cd-stat-label amber">Pending</p>
            <p className="cd-stat-value">{pendingOrders.length}</p>
            <p className="cd-stat-sub">Waiting for farmer</p>
          </div>
        </div>

        <div className="cd-stat">
          <div className="cd-stat-ico purple">✅</div>
          <div>
            <p className="cd-stat-label purple">Accepted</p>
            <p className="cd-stat-value">{acceptedOrders.length}</p>
            <p className="cd-stat-sub">Farmer confirmed</p>
          </div>
        </div>

        <div className="cd-stat">
          <div className="cd-stat-ico red">🚚</div>
          <div>
            <p className="cd-stat-label red">Delivered</p>
            <p className="cd-stat-value">{visibleOrders.filter((o) => (o.status === "delivered" || o.deliveryStatus === "delivered")).length}</p>
            <p className="cd-stat-sub">Completed trips</p>
          </div>
        </div>
      </section>

      <div className="cd-grid">
        <div className="cd-col">

      {/* =====================================================
          SHOP
      ===================================================== */}

      <section className="cd-card" id="cd-sec-shop">
        <div className="cd-card-head">
          <div className="cd-card-ico">🛍️</div>
          <div>
            <div className="cd-card-title">Fresh Products</div>
            <div className="cd-card-sub">
              Browse vegetables &amp; fruits from E-Farm farmers.
            </div>
          </div>
        </div>

        {/* SEARCH */}

        <div
          style={{
            display: "flex",
            gap: "12px",
            marginBottom:
              "24px",
          }}
        >

          <input
            value={search}
            onChange={(e) =>
              setSearch(
                e.target.value
              )
            }
            placeholder="🔎 Search vegetables, fruits..."
            style={{
              flex: 1,
              padding:
                "14px 16px",
              border:
                "1px solid #d7e1d4",
              borderRadius:
                "12px",
              fontSize:
                "14px",
              outline: "none",
            }}
          />

          <select
            value={category}
            onChange={(e) =>
              setCategory(
                e.target.value
              )
            }
            style={{
              minWidth:
                "180px",
              padding:
                "14px",
              border:
                "1px solid #d7e1d4",
              borderRadius:
                "12px",
              background:
                "#ffffff",
            }}
          >

            {categories.map(
              (item) => (
                <option
                  key={item}
                  value={item}
                >
                  {item ===
                  "all"
                    ? "All Categories"
                    : item}
                </option>
              )
            )}

          </select>

        </div>

        {/* PRODUCTS */}

        {loadingProducts ? (

          <EmptyBox
            icon="⏳"
            title="Loading products..."
          />

        ) : filteredProducts.length ===
          0 ? (

          <EmptyBox
            icon="🌾"
            title="No products found"
            text="Farmers have not added matching products yet."
          />

        ) : (

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fill, minmax(250px, 1fr))",
              gap: "20px",
            }}
          >

            {filteredProducts.map(
              (product) => {

                const available =
                  isProductAvailable(
                    product
                  );

                return (
                  <div
                    key={product.id}
                    style={{
                      overflow:
                        "hidden",
                      border:
                        "1px solid #e0e9de",
                      borderRadius:
                        "18px",
                      background:
                        "#ffffff",
                      boxShadow:
                        "0 7px 25px rgba(0,0,0,0.06)",
                    }}
                  >

                    {/* IMAGE — always shows veggie art; uploaded photo overlays it */}

                    <div className="cd-prod-img"
                      style={{
                        height: "190px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "70px",
                          lineHeight: 1,
                          filter: "drop-shadow(0 4px 8px rgba(0,60,20,0.18))",
                        }}
                      >
                        {veggieEmoji(product.name || product.category)}
                      </span>

                      {product.imageUrl ? (
                        <img
                          src={
                            product.imageUrl
                          }
                          alt={
                            product.name
                          }
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      ) : null}

                      <span
                        style={{
                          position:
                            "absolute",
                          bottom:
                            "10px",
                          left:
                            "12px",
                          padding:
                            "4px 9px",
                          borderRadius:
                            "8px",
                          background:
                            "rgba(255,255,255,0.92)",
                          color:
                            "#2e7d32",
                          fontSize:
                            "10.5px",
                          fontWeight: 800,
                        }}
                      >
                        {veggieEmoji(product.name || product.category)}{" "}
                        {product.category || "Vegetable"}
                      </span>

                      <span
                        style={{
                          position:
                            "absolute",
                          top:
                            "12px",
                          right:
                            "12px",
                          padding:
                            "7px 10px",
                          borderRadius:
                            "20px",
                          fontSize:
                            "11px",
                          fontWeight:
                            800,
                          background:
                            available
                              ? "#e8f5e9"
                              : "#ffebee",
                          color:
                            available
                              ? "#2e7d32"
                              : "#c62828",
                        }}
                      >
                        {available
                          ? "✓ In Stock"
                          : "✕ Out of Stock"}
                      </span>
                    </div>

                    {/* CONTENT */}

                    <div
                      style={{
                        padding:
                          "20px",
                      }}
                    >

                      <h3
                        style={{
                          margin:
                            "0 0 6px",
                          fontSize:
                            "19px",
                        }}
                      >
                        {product.name ||
                          "Unnamed Product"}
                      </h3>

                      <p
                        style={{
                          margin:
                            "0 0 8px",
                          fontSize:
                            "12.5px",
                          fontWeight:
                            700,
                          color:
                            "#4b744d",
                        }}
                      >
                        👨‍🌾{" "}
                        {product.farmerName ||
                          "Local Farmer"}
                      </p>

                      <span
                        style={{
                          display:
                            "inline-block",
                          marginBottom:
                            "12px",
                          padding:
                            "5px 9px",
                          borderRadius:
                            "7px",
                          background:
                            "#f0f7ef",
                          color:
                            "#4b744d",
                          fontSize:
                            "11px",
                          fontWeight:
                            700,
                        }}
                      >
                        {product.category ||
                          "Agriculture"}
                      </span>

                      <p
                        style={{
                          minHeight:
                            "42px",
                          color:
                            "#6b7280",
                          fontSize:
                            "13px",
                          lineHeight:
                            1.5,
                        }}
                      >
                        {product.description ||
                          "Fresh product directly from the farmer."}
                      </p>

                      <div
                        style={{
                          display:
                            "flex",
                          justifyContent:
                            "space-between",
                          alignItems:
                            "center",
                          marginBottom:
                            "15px",
                        }}
                      >

                        <strong
                          style={{
                            color:
                              "#2e7d32",
                            fontSize:
                              "22px",
                          }}
                        >
                          ₹
                          {Number(
                            product.price
                          ).toFixed(2)}
                        </strong>

                        <span
                          style={{
                            fontSize:
                              "12px",
                            color:
                              "#6b7280",
                          }}
                        >
                          {Number(
                            product.quantity
                          ) || 0}{" "}
                          available
                        </span>

                      </div>

                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          justifyContent: "center",
                        }}
                      >
                        <button
                          type="button"
                          disabled={!available}
                          onClick={() => addToCart(product)}
                          style={{
                            flex: 1,
                            border:
                              "1px solid " +
                              (available ? "#2e7d32" : "#d7e1d4"),
                            padding: "11px",
                            borderRadius: "11px",
                            background: available ? "#ffffff" : "#f4f6f4",
                            color: available ? "#2e7d32" : "#cbd5cb",
                            fontWeight: 800,
                            cursor: available ? "pointer" : "not-allowed",
                            fontSize: "12.5px",
                          }}
                        >
                          {available ? "🛒 Add to Cart" : "Out of Stock"}
                        </button>
                        <button
                          type="button"
                          disabled={!available}
                          onClick={() => openOrderModal(product)}
                          style={{
                            flex: 1,
                            border: "none",
                            padding: "11px",
                            borderRadius: "11px",
                            background: available ? "#2e7d32" : "#cbd5cb",
                            color: "#ffffff",
                            fontWeight: 800,
                            cursor: available ? "pointer" : "not-allowed",
                            fontSize: "12.5px",
                          }}
                        >
                          {available ? "⚡ Buy Now" : "Out of Stock"}
                        </button>
                      </div>

                    </div>

                  </div>
                );
              }
            )}

          </div>

        )}

      </section>

        </div>
      </div>

      {/* =====================================================
          MY ORDERS
      ===================================================== */}

      <section
        style={{
          maxWidth: "1400px",
          margin:
            "0 auto 28px",
          padding: "28px",
          background:
            "#ffffff",
          borderRadius: "22px",
          boxShadow:
            "0 10px 30px rgba(0,0,0,0.06)",
        }}
      >

        <div
          style={{
            marginBottom: "20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>📦 My Orders</h2>
            <p style={{ color: "#6b7280", marginBottom: 0 }}>
              Track your orders and farmer responses.
            </p>
          </div>

          <button
            type="button"
            onClick={clearCompletedHistory}
            disabled={clearingHistory || completedOrders.length === 0}
            style={{
              border: "1px solid #ffd6d6",
              borderRadius: "11px",
              padding: "11px 15px",
              background: clearingHistory || completedOrders.length === 0 ? "#f3f5f3" : "#fff1f1",
              color: clearingHistory || completedOrders.length === 0 ? "#8a938b" : "#c62828",
              fontWeight: 800,
              cursor: clearingHistory || completedOrders.length === 0 ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {clearingHistory ? "⏳ Clearing..." : `🗑️ Clear History${completedOrders.length ? ` (${completedOrders.length})` : ""}`}
          </button>
        </div>

        {loadingOrders ? (

          <EmptyBox
            icon="⏳"
            title="Loading orders..."
          />

        ) : orders.length ===
          0 ? (

          <EmptyBox
            icon={completedOrders.length > 0 ? "🧹" : "📭"}
            title={completedOrders.length > 0 ? "Order history cleared" : "No orders yet"}
            text={completedOrders.length > 0
              ? "Completed orders are hidden from your dashboard. New orders will appear here automatically."
              : "Your orders will appear here after you purchase a product."}
          />

        ) : (

          <div
            style={{
              display:
                "flex",
              flexDirection:
                "column",
              gap: "18px",
            }}
          >

            {visibleOrders.map(
              (order) => {

                const quantity =
                  Number(
                    order.quantity
                  ) || 0;

                const price =
                  Number(
                    order.price
                  ) || 0;

                /*
                  Important fallback:
                  If old order has totalAmount = 0,
                  calculate it from price × quantity.
                */

                const total =
                  Number(
                    order.totalAmount
                  ) ||
                  price *
                    quantity;

                /* Real farmer → consumer distance for this order.
                   The farmer's CURRENT profile location (loaded
                   live into farmerPickups) overrides the stale
                   farmLocation snapshot frozen at checkout.     */
                const tripKm = getTripKm(
                  order,
                  null,
                  farmerPickups[
                    order.farmerId ||
                    (Array.isArray(order.farmerIds)
                      ? order.farmerIds[0]
                      : null)
                  ] || null
                );

                // Check if this is a multi-item cart order
                const isMultiItemOrder = order.items && order.items.length > 0;

                // For old orders without items array, create a single item from the order data
                const displayItems = isMultiItemOrder ? order.items : [{
                  productId: order.productId || "",
                  productName: order.productName || "Product",
                  category: order.category || "",
                  price: Number(order.price) || 0,
                  quantity: Number(order.quantity) || 0,
                  totalAmount: Number(order.totalAmount) || 0,
                  farmerId: order.farmerId || "",
                  farmerName: order.farmerName || "Unknown Farmer",
                }];

                return (
                  <div
                    key={order.id}
                    style={{
                      border:
                        "1px solid #e0e8de",
                      borderRadius:
                        "17px",
                      padding:
                        "22px",
                      background:
                        "#ffffff",
                    }}
                  >

                    {/* ORDER HEADER */}

                    <div
                      style={{
                        display:
                          "flex",
                        justifyContent:
                          "space-between",
                        alignItems:
                          "center",
                        gap:
                          "15px",
                        paddingBottom:
                          "16px",
                        marginBottom:
                          "18px",
                        borderBottom:
                          "1px solid #edf1ec",
                      }}
                    >

                      <div>

                        <h3
                          style={{
                            margin:
                              "0 0 5px",
                          }}
                        >
                          📦{" "}
                          {isMultiItemOrder
                            ? "Order with " + (order.itemCount || order.items.length) + " item(s) from " + (order.farmerCount || (order.farmerDetails ? order.farmerDetails.length : 1)) + " farmer(s)"
                            : (order.productName || "Product Order")}
                        </h3>

                        <p
                          style={{
                            margin:
                              0,
                            fontSize:
                              "11px",
                            color:
                              "#858d85",
                          }}
                        >
                          Order ID:{" "}
                          {order.id}
                        </p>

                      </div>

                      <span
                        className={getStatusClass(
                          order.status
                        )}
                        style={{
                          padding:
                            "7px 13px",
                          borderRadius:
                            "30px",
                          fontSize:
                            "11px",
                          fontWeight:
                            800,
                          textTransform:
                            "uppercase",
                          background:
                            order.status ===
                            "accepted"
                              ? "#e8f5e9"
                              : order.status ===
                                "rejected"
                              ? "#ffebee"
                              : order.status ===
                                "delivered"
                              ? "#e8f5e9"
                              : "#fff8e1",
                          color:
                            order.status ===
                            "accepted"
                              ? "#2e7d32"
                              : order.status ===
                                "rejected"
                              ? "#c62828"
                              : order.status ===
                                "delivered"
                              ? "#2e7d32"
                              : "#a66a00",
                        }}
                      >
                        {order.status ||
                          "pending"}
                      </span>

                    </div>

                    {/* DETAILS */}

                    <div
                      style={{
                        display:
                          "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(220px, 1fr))",
                        gap:
                          "14px",
                      }}
                    >

                      {/* PRODUCT(S) - Show all items */}
                      <OrderBox title={"📦 Products (" + (isMultiItemOrder ? (order.itemCount || order.items.length) : 1) + ")"}>
                        {displayItems.map((item, idx) => (
                          <div key={idx} style={{ marginBottom: idx < displayItems.length - 1 ? "12px" : 0, paddingBottom: idx < displayItems.length - 1 ? "12px" : 0, borderBottom: idx < displayItems.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                              <div>
                                <p><strong>{item.productName || "N/A"}</strong></p>
                                <p style={{ fontSize: "12px", color: "#6b7280" }}>{item.category || ""}</p>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <p><strong>₹{Number(item.totalAmount).toFixed(2)}</strong></p>
                                <p style={{ fontSize: "12px", color: "#6b7280" }}>{item.quantity} × ₹{Number(item.price).toFixed(2)}</p>
                              </div>
                            </div>
                            <p style={{ fontSize: "11px", color: "#2e7d32", marginTop: "4px" }}>👨‍🌾 {item.farmerName || "Unknown Farmer"}</p>
                          </div>
                        ))}
                        <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "2px solid #e0e8de" }}>
                          <p><strong>Subtotal:</strong> ₹{Number(isMultiItemOrder ? order.subtotal : (Number(order.price) * Number(order.quantity))).toFixed(2)}</p>
                          <p><strong>Delivery:</strong> ₹{Number(isMultiItemOrder ? order.deliveryCharge : 0).toFixed(2)}</p>
                        </div>
                      </OrderBox>

                      {/* FARMER DETAILS */}
                      <OrderBox title={"👨‍🌾 Farmers (" + (isMultiItemOrder ? (order.farmerCount || (order.farmerDetails ? order.farmerDetails.length : 1)) : 1) + ")"}>
                        {isMultiItemOrder && order.farmerDetails ? (
                          order.farmerDetails.map((farmer, idx) => (
                            <div key={idx} style={{ marginBottom: idx < order.farmerDetails.length - 1 ? "12px" : 0, paddingBottom: idx < order.farmerDetails.length - 1 ? "12px" : 0, borderBottom: idx < order.farmerDetails.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                              <p><strong>{farmer.farmerName || "N/A"}</strong></p>
                              <p style={{ fontSize: "12px", color: "#6b7280" }}>{farmer.farmerEmail || ""}</p>
                            </div>
                          ))
                        ) : (
                          <p><strong>{order.farmerName || "N/A"}</strong></p>
                        )}
                      </OrderBox>

                      {/* CONSUMER DETAILS */}
                      <OrderBox title="👤 Consumer">
                        <p>
                          <strong>
                            Name:
                          </strong>{" "}
                          {order.consumerName ||
                            "N/A"}
                        </p>
                        <p>
                          <strong>
                            Email:
                          </strong>{" "}
                          {order.consumerEmail ||
                            "N/A"}
                        </p>
                        <p>
                          <strong>
                            Phone:
                          </strong>{" "}
                          {order.consumerPhone ||
                            "N/A"}
                        </p>
                      </OrderBox>

                      {/* DELIVERY */}

                      <OrderBox title="🏠 Delivery">

                        <p>
                          <strong>
                            Address:
                          </strong>{" "}
                          {order.address ||
                            order.deliveryAddress ||
                            "N/A"}
                        </p>

                        {tripKm != null && (
                          <p>
                            <strong>
                              Distance from
                              farm:
                            </strong>{" "}
                            {tripKm} km
                          </p>
                        )}

                        <p>
                          <strong>
                            City:
                          </strong>{" "}
                          {order.city ||
                            "N/A"}
                        </p>

                        <p>
                          <strong>
                            PIN:
                          </strong>{" "}
                          {order.pincode ||
                            "N/A"}
                        </p>

                      </OrderBox>

                      {/* LOCATION */}

                      <OrderBox title="📍 Location">

                        {order.location &&
                        order.location
                          .latitude !==
                          undefined ? (

                          <>

                            <p>
                              <strong>
                                Latitude:
                              </strong>{" "}
                              {
                                order
                                  .location
                                  .latitude
                              }
                            </p>

                            <p>
                              <strong>
                                Longitude:
                              </strong>{" "}
                              {
                                order
                                  .location
                                  .longitude
                              }
                            </p>

                            <a
                              href={`https://www.google.com/maps?q=${order.location.latitude},${order.location.longitude}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                color:
                                  "#2e7d32",
                                fontWeight:
                                  700,
                                fontSize:
                                  "12px",
                              }}
                            >
                              📍 Open in Google
                              Maps
                            </a>

                          </>

                        ) : (

                          <p>
                            Location
                            unavailable.
                          </p>

                        )}

                      </OrderBox>

                      {/* PAYMENT */}

                      <OrderBox title="💳 Payment">

                        <p>
                          <strong>
                            Method:
                          </strong>{" "}
                          {order.paymentMethod ||
                            "N/A"}
                        </p>

                        <p>
                          <strong>
                            Status:
                          </strong>{" "}
                          {order.paymentStatus ||
                            "Pending"}
                        </p>

                        {isMultiItemOrder && (
                          <>
                            <p>
                              <strong>
                                Subtotal:
                              </strong>{" "}
                              ₹{Number(order.subtotal || 0).toFixed(2)}
                            </p>
                            <p>
                              <strong>
                                Delivery:
                              </strong>{" "}
                              ₹{Number(order.deliveryCharge || 0).toFixed(2)}
                            </p>
                          </>
                        )}

                        <p style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid #e0e8de" }}>
                          <strong>
                            Total:
                          </strong>{" "}
                          <strong style={{ color: "#2e7d32", fontSize: "14px" }}>
                            ₹{Number(order.totalAmount || total).toFixed(2)}
                          </strong>
                        </p>

                        {order.transactionId && (
                          <p>
                            <strong>
                              Transaction:
                            </strong>{" "}
                            {
                              order.transactionId
                            }
                          </p>
                        )}

                      </OrderBox>

                      {/* TIME */}

                      <OrderBox title="🕒 Order Time">

                        <p>
                          {formatDate(
                            order.createdAt
                          )}
                        </p>

                      </OrderBox>

                    </div>

                    {/* TOTAL */}

                    <div
                      style={{
                        marginTop:
                          "18px",
                        paddingTop:
                          "16px",
                        borderTop:
                          "1px solid #edf1ec",
                        display:
                          "flex",
                        justifyContent:
                          "space-between",
                        alignItems:
                          "center",
                      }}
                    >

                      <span
                        style={{
                          color:
                            "#697169",
                        }}
                      >
                        Order Total
                      </span>

                      <strong
                        style={{
                          color:
                            "#2e7d32",
                          fontSize:
                            "22px",
                        }}
                      >
                        ₹
                        {total.toFixed(
                          2
                        )}
                      </strong>

                    </div>

                    {/* DELIVERY CHARGE (paid to the delivery partner) */}

                    {Number(order.deliveryCharge) > 0 && (
                      <div
                        style={{
                          marginTop: "10px",
                          paddingTop: "12px",
                          borderTop: "1px dashed #dfe7dc",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
                        <span
                          style={{
                            color: "#697169",
                            fontSize: "13px",
                          }}
                        >
                          🚚 Delivery Charge{" "}
                          <em style={{ fontSize: "11px", color: "#8a938b" }}>
                            (pay the delivery partner on delivery)
                          </em>
                        </span>

                        <strong
                          style={{
                            color: "#7a5c00",
                            fontSize: "17px",
                          }}
                        >
                          ₹
                          {Number(order.deliveryCharge).toFixed(2)}
                        </strong>
                      </div>
                    )}

                    {/* FARMER RESPONSE */}

                    <div
                      style={{
                        marginTop:
                          "16px",
                        padding:
                          "14px",
                        borderRadius:
                          "12px",
                        background:
                          order.status ===
                          "accepted"
                            ? "#e8f5e9"
                            : order.status ===
                              "rejected"
                            ? "#ffebee"
                            : order.status ===
                              "delivered"
                            ? "#e8f5e9"
                            : "#fff8e1",
                      }}
                    >

                      {order.status ===
                      "accepted" ? (

                        <strong
                          style={{
                            color:
                              "#2e7d32",
                          }}
                        >
                          ✅ Farmer accepted
                          your order.
                        </strong>

                      ) : order.status ===
                        "rejected" ? (

                        <strong
                          style={{
                            color:
                              "#c62828",
                          }}
                        >
                          ❌ Farmer rejected
                          your order.
                        </strong>

                                            ) : order.status ===
                      "delivered" ? (
  
                        <strong
                          style={{
                            color:
                              "#2e7d32",
                          }}
                        >
                          ✅ Order reached you
                          successfully.
                        </strong>

                      ) : (
  
                        <strong
                          style={{
                            color:
                              "#a66a00",
                          }}
                        >
                          ⏳ Waiting for farmer
                          response.
                        </strong>

                      )}

                    </div>

                  </div>
                );
              }
            )}

          </div>

        )}

      </section>

      {/* =====================================================
          REFRESH
      ===================================================== */}

      <div
        style={{
          textAlign:
            "center",
          marginBottom:
            "30px",
        }}
      >

        <button
          type="button"
          onClick={() => {
            loadProducts();
            loadOrders();
          }}
          disabled={
            loadingProducts ||
            loadingOrders
          }
          style={{
            padding:
              "12px 22px",
            border:
              "1px solid #d4dfd2",
            borderRadius:
              "11px",
            background:
              "#ffffff",
            color:
              "#456047",
            fontWeight:
              700,
            cursor:
              "pointer",
          }}
        >
          🔄 Refresh
        </button>

      </div>

      {/* =====================================================
          ORDER MODAL
      ===================================================== */}

      {showOrderModal && selectedProduct && (

        <div
          style={{
            position:
              "fixed",
            inset: 0,
            zIndex: 9999,
            background:
              "rgba(15,30,16,0.65)",
            backdropFilter:
              "blur(6px)",
            display:
              "flex",
            alignItems:
              "center",
            justifyContent:
              "center",
            padding:
              "20px",
          }}
          onMouseDown={(e) => {
            if (
              e.target ===
              e.currentTarget
            ) {
              closeOrderModal();
            }
          }}
        >

          <div
            style={{
              width:
                "min(760px, 100%)",
              maxHeight:
                "92vh",
              overflowY:
                "auto",
              background:
                "#ffffff",
              borderRadius:
                "22px",
              boxShadow:
                "0 30px 80px rgba(0,0,0,0.3)",
            }}
          >

            {/* MODAL HEADER */}

            <div
              style={{
                padding:
                  "22px 25px",
                borderBottom:
                  "1px solid #e8eee6",
                display:
                  "flex",
                justifyContent:
                  "space-between",
                alignItems:
                  "center",
              }}
            >

              <div>

                <h2
                  style={{
                    margin: 0,
                  }}
                >
                  🛒 Place Order
                </h2>

                <p
                  style={{
                    margin: "5px 0 0",
                    color: "#6b7280",
                  }}
                >
                  Complete your delivery and payment details.
                </p>

              </div>

              <button
                type="button"
                onClick={
                  closeOrderModal
                }
                disabled={
                  placingOrder
                }
                style={{
                  width:
                    "38px",
                  height:
                    "38px",
                  border: "none",
                  borderRadius:
                    "50%",
                  background:
                    "#f1f4f1",
                  cursor:
                    "pointer",
                  fontSize:
                    "18px",
                }}
              >
                ✕
              </button>

            </div>

            {/* MODAL BODY */}

            <form
              onSubmit={
                handlePlaceOrder
              }
              style={{
                padding:
                  "25px",
              }}
            >

              {/* ORDER SUMMARY */}

              <div
                style={{
                  padding: "16px",
                  background: "#f5faf4",
                  border: "1px solid #dfebdc",
                  borderRadius: "14px",
                  marginBottom: "22px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "15px",
                }}
              >
                <div>
                  <h3 style={{ margin: "0 0 5px" }}>{selectedProduct?.name}</h3>
                  <p style={{ margin: 0, color: "#2e7d32", fontWeight: 700 }}>
                    ₹{Number(selectedProduct?.price || 0).toFixed(2)} / unit
                  </p>
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      color: "#4b744d",
                    }}
                  >
                    👨‍🌾 From {selectedProduct?.farmerName || "Local Farmer"}
                  </p>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 700, marginBottom: "5px" }}>
                    Quantity
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={Number(selectedProduct?.quantity) || 1}
                    value={orderQuantity}
                    onChange={(e) => setOrderQuantity(e.target.value)}
                    style={{ width: "90px", padding: "10px", border: "1px solid #d7e1d4", borderRadius: "9px" }}
                  />
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>Total</div>
                  <div style={{ fontWeight: 800, fontSize: "18px", color: "#2e7d32" }}>
                    ₹{((Number(selectedProduct?.price) || 0) * (Number(orderQuantity) || 0)).toFixed(2)}
                  </div>
                </div>
              </div>

              {/* PAYMENT BREAKDOWN */}
              <div
                style={{
                  padding: "16px",
                  background: "#f9faf9",
                  border: "1px solid #e4ece6",
                  borderRadius: "14px",
                  marginBottom: "22px",
                }}
              >
                <h4 style={{ margin: "0 0 12px", fontSize: "14px", fontWeight: 800 }}>
                  💰 Payment Breakdown
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                    <span style={{ color: "#6b7280" }}>Order Total</span>
                    <span style={{ fontWeight: 700 }}>₹{((Number(selectedProduct?.price) || 0) * (Number(orderQuantity) || 0)).toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                    <span style={{ color: "#6b7280" }}>
                      Delivery Charge
                      {checkoutTripKm != null && (
                        <em style={{ fontSize: "11px", color: "#8a938b" }}>
                          {" "}• 📏 {checkoutTripKm.toFixed(1)} km from farm
                        </em>
                      )}
                    </span>
                    <span style={{ fontWeight: 700 }}>
                      ₹{checkoutDeliveryCharge.toFixed(2)}
                    </span>
                  </div>
                  {checkoutTripKm != null && checkoutTripKm > DELIVERY_RANGE_KM && (
                    <p
                      style={{
                        margin: "4px 0 0",
                        padding: "8px 10px",
                        background: "#fff8e1",
                        border: "1px solid #ffe082",
                        borderRadius: "8px",
                        color: "#b45309",
                        fontSize: "12px",
                        fontWeight: 700,
                      }}
                    >
                      ⚠️ This farm is {checkoutTripKm.toFixed(1)} km away —
                      beyond the {DELIVERY_RANGE_KM} km delivery service range.
                      Delivery partners may decline.
                      {checkoutTripKm > 50 && (
                        <> If the farm is actually nearby, your captured 📍
                        point is almost certainly WRONG (browsers often return
                        a city-level fix) — use “📌 Use Pasted Coordinates”
                        with exact coordinates from Google Maps.</>
                      )}
                    </p>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                    <span style={{ color: "#6b7280" }}>
                      Delivery Commission (5%, paid by farmer)
                    </span>
                    <span style={{ fontWeight: 700 }}>
                      ₹{Math.max(10, Math.min(120, ((Number(selectedProduct?.price) || 0) * (Number(orderQuantity) || 0)) * 0.05)).toFixed(2)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      paddingTop: "8px",
                      borderTop: "1px dashed #d7e1d4",
                      fontSize: "13px",
                    }}
                  >
                    <span style={{ color: "#6b7280" }}>
                      Farmer Receives (after delivery commission)
                    </span>
                    <span style={{ fontWeight: 800, color: "#2e7d32" }}>
                      ₹{(((Number(selectedProduct?.price) || 0) * (Number(orderQuantity) || 0)) - Math.max(10, Math.min(120, ((Number(selectedProduct?.price) || 0) * (Number(orderQuantity) || 0)) * 0.05))).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* CONSUMER DETAILS */}

              <FormSection title="👤 Consumer Details">

                <div
                  style={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      "1fr 1fr",
                    gap:
                      "14px",
                  }}
                >

                  <FormField
                    label="Full Name"
                    value={
                      consumerName
                    }
                    onChange={
                      setConsumerName
                    }
                    placeholder="Your full name"
                    required
                  />

                  <FormField
                    label="Mobile Number"
                    value={
                      consumerPhone
                    }
                    onChange={
                      setConsumerPhone
                    }
                    placeholder="10-digit mobile number"
                    required
                  />

                </div>

                <FormField
                  label="Email Address"
                  type="email"
                  value={
                    consumerEmail
                  }
                  onChange={
                    setConsumerEmail
                  }
                  placeholder="your@email.com"
                  required
                />

              </FormSection>

              {/* DELIVERY */}

              <FormSection title="🏠 Delivery Address">

                <FormField
                  label="Address"
                  value={
                    address
                  }
                  onChange={
                    setAddress
                  }
                  placeholder="House number, street, area"
                  textarea
                  required
                />

                <div
                  style={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      "1fr 1fr",
                    gap:
                      "14px",
                  }}
                >

                  <FormField
                    label="City"
                    value={
                      city
                    }
                    onChange={
                      setCity
                    }
                    placeholder="City"
                    required
                  />

                  <FormField
                    label="PIN Code"
                    value={
                      pincode
                    }
                    onChange={
                      setPincode
                    }
                    placeholder="6-digit PIN"
                    required
                  />

                </div>

              </FormSection>

              {/* LOCATION */}

              <FormSection title="📍 Delivery Location">

                <button
                  type="button"
                  onClick={
                    getCurrentLocation
                  }
                  disabled={
                    locationLoading
                  }
                  style={{
                    padding:
                      "11px 15px",
                    border:
                      "none",
                    borderRadius:
                      "10px",
                    background:
                      "#e8f5e9",
                    color:
                      "#2e7d32",
                    fontWeight:
                      800,
                    cursor:
                      "pointer",
                  }}
                >
                  {locationLoading
                    ? "📍 Getting location..."
                    : "📍 Use My Current Location"}
                </button>

                {/* Manual coordinates — a browser without real GPS
                    can return a city-level fix hundreds of km off;
                    pasting exact coordinates always wins.            */}
                <input
                  type="text"
                  value={manualCoords}
                  onChange={(e) => setManualCoords(e.target.value)}
                  placeholder='Paste "14.13773, 79.86397" or a Google Maps link'
                  style={{
                    padding: "10px 12px",
                    border: "1px solid #dce5da",
                    borderRadius: "10px",
                    fontSize: "13px",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  type="button"
                  onClick={applyManualCoords}
                  style={{
                    padding: "10px 15px",
                    border: "none",
                    borderRadius: "10px",
                    background: "#eef4ff",
                    color: "#1d4ed8",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  📌 Use Pasted Coordinates
                </button>

                {/* Visual map — the foolproof way to set the drop
                    point (browser GPS can be hundreds of km off). */}
                <LocationPicker
                  latitude={latitude}
                  longitude={longitude}
                  centerHint={
                    farmerPickups[selectedProduct?.farmerId] || null
                  }
                  onChange={setDropFromMap}
                />


                {locationMessage && (
                  <p
                    style={{
                      fontSize:
                        "12px",
                      color:
                        "#5f6b5f",
                      marginBottom:
                        0,
                    }}
                  >
                    {
                      locationMessage
                    }
                  </p>
                )}

                {latitude &&
                  longitude && (

                  <div
                    style={{
                      marginTop:
                        "12px",
                      padding:
                        "12px",
                      borderRadius:
                        "10px",
                      background:
                        "#f5faf4",
                      fontSize:
                        "12px",
                    }}
                  >

                    <strong>
                      Latitude:
                    </strong>{" "}
                    {latitude}

                    <br />

                    <strong>
                      Longitude:
                    </strong>{" "}
                    {longitude}

                  </div>

                )}

              </FormSection>

              {/* PAYMENT */}

              <FormSection title="💳 Payment">

                <div
                  style={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      "1fr 1fr",
                    gap:
                      "12px",
                  }}
                >

                  <button
                    type="button"
                    onClick={() =>
                      setPaymentMethod(
                        "Cash on Delivery"
                      )
                    }
                    style={{
                      padding:
                        "15px",
                      border:
                        paymentMethod ===
                        "Cash on Delivery"
                          ? "2px solid #2e7d32"
                          : "1px solid #dce5da",
                      borderRadius:
                        "11px",
                      background:
                        paymentMethod ===
                        "Cash on Delivery"
                          ? "#eef8ee"
                          : "#ffffff",
                      cursor:
                        "pointer",
                    }}
                  >
                    <strong>
                      💵 Cash on Delivery
                    </strong>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setPaymentMethod(
                        "Online Payment"
                      )
                    }
                    style={{
                      padding:
                        "15px",
                      border:
                        paymentMethod ===
                        "Online Payment"
                          ? "2px solid #2e7d32"
                          : "1px solid #dce5da",
                      borderRadius:
                        "11px",
                      background:
                        paymentMethod ===
                        "Online Payment"
                          ? "#eef8ee"
                          : "#ffffff",
                      cursor:
                        "pointer",
                    }}
                  >
                    <strong>
                      📱 Online Payment
                    </strong>
                  </button>

                </div>

                {paymentMethod ===
                  "Online Payment" && (

                  <div
                    style={{
                      marginTop:
                        "12px",
                      padding:
                        "12px",
                      background:
                        "#fff8e1",
                      borderRadius:
                        "10px",
                      color:
                        "#7a5b00",
                      fontSize:
                        "12px",
                    }}
                  >
                    ℹ️ Online payment gateway
                    can be connected here.
                    For now, the payment is
                    recorded as pending.
                  </div>

                )}

              </FormSection>

              {/* TOTAL */}

              <div
                style={{
                  marginTop:
                    "18px",
                  marginBottom:
                    "18px",
                  padding:
                    "18px",
                  background:
                    "#eaf6e9",
                  borderRadius:
                    "13px",
                  display:
                    "flex",
                  justifyContent:
                    "space-between",
                  alignItems:
                    "center",
                }}
              >

                <span>
                  Total Amount
                </span>

                <strong
                  style={{
                    fontSize:
                      "24px",
                    color:
                      "#1b5e20",
                  }}
                >
                  ₹
                  {orderTotal.toFixed(
                    2
                  )}
                </strong>

              </div>

              {/* SUBMIT */}

              {orderTotal <
                MIN_ORDER_VALUE && (
                <p
                  style={{
                    margin:
                      "-6px 0 14px",
                    padding:
                      "9px 12px",
                    background:
                      "#fef3c7",
                    border:
                      "1px solid #fde68a",
                    borderRadius:
                      "10px",
                    color:
                      "#b45309",
                    fontSize:
                      "12px",
                    fontWeight:
                      700,
                    textAlign:
                      "center",
                  }}
                >
                  ⚠️ Minimum order
                  value is ₹
                  {MIN_ORDER_VALUE}{" "}
                  — add ₹
                  {(
                    MIN_ORDER_VALUE -
                    orderTotal
                  ).toFixed(2)}{" "}
                  more to place this
                  order.
                </p>
              )}

              <button
                type="submit"
                disabled={
                  placingOrder || orderTotal < MIN_ORDER_VALUE
                }
                style={{
                  width: "100%",
                  padding: "15px",
                  border: "none",
                  borderRadius: "12px",
                  background:
                    placingOrder || orderTotal < MIN_ORDER_VALUE
                      ? "#aab8aa"
                      : "#2e7d32",
                  color: "#ffffff",
                  fontSize: "14px",
                  fontWeight: 800,
                  cursor:
                    placingOrder || orderTotal < MIN_ORDER_VALUE
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {placingOrder
                  ? "⏳ PLACING ORDER..."
                  : orderTotal < MIN_ORDER_VALUE
                  ? `🚫 MINIMUM ORDER ₹${MIN_ORDER_VALUE}`
                  : `🛒 PLACE ORDER • ₹${orderTotal.toFixed(2)}`}
              </button>

            </form>

          </div>

        </div>

      )}
      {/* =====================================================
          CART DRAWER (multi-product, one farmer at a time)
      ===================================================== */}
      {cartOpen && (
        <>
          <div className="cd-cart-overlay" onClick={() => setCartOpen(false)} />
          <div className="cd-cart-drawer">
            <div className="cd-cart-header">
              <h2>
                🛒 Your Cart{cartCount > 0 ? ` (${cartCount})` : ""}
              </h2>
              <button className="cd-cart-close" onClick={() => setCartOpen(false)}>
                ✕
              </button>
            </div>

            <div className="cd-cart-body">
              {cart.length === 0 ? (
                <div className="cd-cart-empty">
                  <div className="cd-cart-empty-ico">🧺</div>
                  <p>Your cart is empty.</p>
                  <p style={{ fontSize: "12px", marginTop: "4px" }}>
                    Add products from one farmer's shop, then checkout.
                  </p>
                </div>
              ) : (
                <>
                  <div
                    style={{
                      padding: "10px 14px",
                      marginBottom: "12px",
                      background: "#eef8ee",
                      border: "1px solid #d6f0dc",
                      borderRadius: "10px",
                      fontSize: "12.5px",
                    }}
                  >
                    <strong>👨‍🌾 {cartFarmerName}'s Shop</strong>
                    <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                      You can only shop from one farmer at a time.
                    </div>
                  </div>

                  <div className="cd-cart-farmer">
                    <div className="cd-cart-farmer-header">
                      <span className="cd-cart-farmer-name">{cartFarmerName}</span>
                      <span className="cd-cart-farmer-subtotal">
                        ₹{cartSubtotal.toFixed(2)}
                      </span>
                    </div>

                    <div className="cd-cart-items">
                      {cart.map((item) => (
                        <div key={item.productId} className="cd-cart-item">
                          <div className="cd-cart-item-emoji">
                            {veggieEmoji(item.name)}
                          </div>
                          <div className="cd-cart-item-info">
                            <div className="cd-cart-item-name">{item.name}</div>
                            <div className="cd-cart-item-meta">
                              {item.category && (
                                <span className="cd-cart-item-category">
                                  {item.category}
                                </span>
                              )}
                              <span className="cd-cart-item-farmer">
                                {item.farmerName}
                              </span>
                            </div>
                            <div className="cd-cart-item-price">
                              <strong>₹{Number(item.price).toFixed(2)}</strong>{" "}
                              / unit
                            </div>
                          </div>
                          <div className="cd-cart-qty">
                            <button
                              type="button"
                              onClick={() => changeCartQty(item.productId, -1)}
                            >
                              −
                            </button>
                            <span>{item.qty}</span>
                            <button
                              type="button"
                              onClick={() => changeCartQty(item.productId, 1)}
                            >
                              +
                            </button>
                          </div>
                          <button
                            className="cd-cart-item-remove"
                            type="button"
                            onClick={() => removeFromCart(item.productId)}
                            title="Remove"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {cartSubtotal < MIN_ORDER_VALUE && (
                    <div className="cd-cart-min-order">
                      ⚠️ Minimum order value is ₹{MIN_ORDER_VALUE} — add ₹
                      {(MIN_ORDER_VALUE - cartSubtotal).toFixed(2)} more.
                    </div>
                  )}

                  <div className="cd-cart-total">
                    <span>Subtotal ({cartCount} items)</span>
                    <span>₹{cartSubtotal.toFixed(2)}</span>
                  </div>
                </>
              )}
            </div>

            {cart.length > 0 && (
              <div
                style={{
                  padding: "16px 24px",
                  borderTop: "1px solid #e4ece6",
                  background: "#f9faf9",
                }}
              >
                {cartSubtotal < MIN_ORDER_VALUE ? (
                  <button className="cd-cart-checkout-btn" disabled>
                    🚫 MINIMUM ORDER ₹{MIN_ORDER_VALUE}
                  </button>
                ) : (
                  <button
                    className="cd-cart-checkout-btn"
                    onClick={openCartCheckout}
                  >
                    PROCEED TO CHECKOUT • ₹{cartSubtotal.toFixed(2)}
                  </button>
                )}
                <button className="cd-cart-clear-btn" onClick={clearCart}>
                  🗑️ Clear Cart
                </button>
              </div>
            )}
          </div>
        </>
      )}

{/* =====================================================
          CART CHECKOUT MODAL (multi-product, single farmer)
      ===================================================== */}
      {cartCheckoutOpen && cart.length > 0 && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(15,30,16,0.65)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeCartCheckout();
          }}
        >
          <div
            style={{
              width: "min(880px, 100%)",
              maxHeight: "92vh",
              overflowY: "auto",
              background: "#ffffff",
              borderRadius: "22px",
              boxShadow: "0 30px 80px rgba(0,0,0,0.3)",
            }}
          >
            {/* MODAL HEADER */}

            <div
              style={{
                padding: "22px 25px",
                borderBottom: "1px solid #e8eee6",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <h2 style={{ margin: 0 }}>
                  🛒 Checkout — {cartFarmerName}'s Shop
                </h2>
                <p style={{ margin: "5px 0 0", color: "#6b7280" }}>
                  {cartCount} item(s) from one farmer • Complete your delivery
                  and payment details.
                </p>
              </div>
              <button
                type="button"
                onClick={closeCartCheckout}
                disabled={placingCartOrder}
                style={{
                  width: "38px",
                  height: "38px",
                  border: "none",
                  borderRadius: "50%",
                  background: "#f1f4f1",
                  cursor: "pointer",
                  fontSize: "18px",
                }}
              >
                ✕
              </button>
            </div>

            {/* MODAL BODY */}

            <form onSubmit={handlePlaceCartOrder} style={{ padding: "25px" }}>
              {/* ORDER SUMMARY */}

              <div
                style={{
                  padding: "16px",
                  background: "#f5faf4",
                  borderRadius: "14px",
                  marginBottom: "20px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "6px",
                  }}
                >
                  <strong>Order Summary</strong>
                  <span style={{ fontSize: "12px", color: "#6b7280" }}>
                    👨‍🌾 {cartFarmerName}
                  </span>
                </div>

                {cart.map((item) => (
                  <div
                    key={item.productId}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "7px 0",
                      borderTop: "1px solid #e8f0e6",
                      fontSize: "13px",
                    }}
                  >
                    <span>
                      {veggieEmoji(item.name)} {item.name} × {item.qty}
                    </span>
                    <strong>
                      ₹{(Number(item.price) * Number(item.qty)).toFixed(2)}
                    </strong>
                  </div>
                ))}

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    paddingTop: "12px",
                    fontSize: "13px",
                  }}
                >
                  <span style={{ color: "#6b7280" }}>Subtotal</span>
                  <span style={{ fontWeight: 700 }}>
                    ₹{cartSubtotal.toFixed(2)}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "13px",
                  }}
                >
                  <span style={{ color: "#6b7280" }}>
                    Delivery Charge
                    {cartTripKm != null && (
                      <em style={{ fontSize: "11px", color: "#8a938b" }}>
                        {" "}
                        • 📏 {cartTripKm.toFixed(1)} km from farm
                      </em>
                    )}
                  </span>
                  <span style={{ fontWeight: 700 }}>
                    ₹{cartDeliveryCharge.toFixed(2)}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "13px",
                  }}
                >
                  <span style={{ color: "#6b7280" }}>
                    Delivery Commission (5%, paid by farmer)
                  </span>
                  <span style={{ fontWeight: 700 }}>
                    ₹{Math.max(10, Math.min(120, cartSubtotal * 0.05)).toFixed(2)}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "13px",
                  }}
                >
                  <span style={{ color: "#6b7280" }}>
                    Farmer Receives (after delivery commission)
                  </span>
                  <span style={{ fontWeight: 700 }}>
                    ₹{(cartSubtotal - Math.max(10, Math.min(120, cartSubtotal * 0.05))).toFixed(2)}
                  </span>
                </div>
                {cartTripKm != null && cartTripKm > DELIVERY_RANGE_KM && (
                  <p
                    style={{
                      margin: "6px 0 0",
                      padding: "8px 10px",
                      background: "#fff8e1",
                      border: "1px solid #ffe082",
                      borderRadius: "8px",
                      color: "#b45309",
                      fontSize: "12px",
                      fontWeight: 700,
                    }}
                  >
                    ⚠️ This farm is {cartTripKm.toFixed(1)} km away — beyond
                    the {DELIVERY_RANGE_KM} km delivery service range. Delivery
                    partners may decline.
                    {cartTripKm > 50 && (
                      <> If the farm is actually nearby, your captured 📍 point
                      is almost certainly WRONG (browsers often return a
                      city-level fix) — use “📌 Use Pasted Coordinates” with
                      exact coordinates from Google Maps.</>
                    )}
                  </p>
                )}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    paddingTop: "8px",
                    borderTop: "2px solid #e0e8de",
                    fontSize: "15px",
                    fontWeight: 800,
                    color: "#141d16",
                  }}
                >
                  <span>Total</span>
                  <span style={{ color: "#2e7d32" }}>
                    ₹{cartTotal.toFixed(2)}
                  </span>
                </div>
              </div>

{/* CONSUMER DETAILS */}

              <FormSection title="👤 Consumer Details">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "14px",
                  }}
                >
                  <FormField
                    label="Full Name"
                    value={consumerName}
                    onChange={setConsumerName}
                    placeholder="Your full name"
                    required
                  />
                  <FormField
                    label="Mobile Number"
                    value={consumerPhone}
                    onChange={setConsumerPhone}
                    placeholder="10-digit mobile number"
                    required
                  />
                </div>

                <FormField
                  label="Email Address"
                  type="email"
                  value={consumerEmail}
                  onChange={setConsumerEmail}
                  placeholder="your@email.com"
                  required
                />
              </FormSection>

              {/* DELIVERY ADDRESS */}

              <FormSection title="🏠 Delivery Address">
                <FormField
                  label="Address"
                  value={address}
                  onChange={setAddress}
                  placeholder="House number, street, area"
                  textarea
                  required
                />

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "14px",
                  }}
                >
                  <FormField
                    label="City"
                    value={city}
                    onChange={setCity}
                    placeholder="City"
                    required
                  />
                  <FormField
                    label="PIN Code"
                    value={pincode}
                    onChange={setPincode}
                    placeholder="6-digit PIN"
                    required
                  />
                </div>
              </FormSection>

{/* LOCATION */}

              <FormSection title="📍 Delivery Location">
                <button
                  type="button"
                  onClick={getCurrentLocation}
                  disabled={locationLoading}
                  style={{
                    padding: "11px 15px",
                    border: "none",
                    borderRadius: "10px",
                    background: "#e8f5e9",
                    color: "#2e7d32",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  {locationLoading
                    ? "📍 Getting location..."
                    : "📍 Use My Current Location"}
                </button>

                {/* Manual coordinates — a browser without real GPS
                    can return a city-level fix hundreds of km off;
                    pasting exact coordinates always wins.            */}
                <input
                  type="text"
                  value={manualCoords}
                  onChange={(e) => setManualCoords(e.target.value)}
                  placeholder='Paste "14.13773, 79.86397" or a Google Maps link'
                  style={{
                    padding: "10px 12px",
                    border: "1px solid #dce5da",
                    borderRadius: "10px",
                    fontSize: "13px",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  type="button"
                  onClick={applyManualCoords}
                  style={{
                    padding: "10px 15px",
                    border: "none",
                    borderRadius: "10px",
                    background: "#eef4ff",
                    color: "#1d4ed8",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  📌 Use Pasted Coordinates
                </button>

                {/* Visual map — the foolproof way to set the drop
                    point (browser GPS can be hundreds of km off). */}
                <LocationPicker
                  latitude={latitude}
                  longitude={longitude}
                  centerHint={farmerPickups[cartFarmerId] || null}
                  onChange={setDropFromMap}
                />


                {locationMessage && (
                  <p
                    style={{
                      fontSize: "12px",
                      color: "#5f6b5f",
                      marginBottom: 0,
                    }}
                  >
                    {locationMessage}
                  </p>
                )}

                {latitude && longitude && (
                  <div
                    style={{
                      marginTop: "12px",
                      padding: "12px",
                      borderRadius: "10px",
                      background: "#f5faf4",
                      fontSize: "12px",
                    }}
                  >
                    <strong>Latitude:</strong> {latitude}
                    <br />
                    <strong>Longitude:</strong> {longitude}
                  </div>
                )}
              </FormSection>

              {/* PAYMENT */}

              <FormSection title="💳 Payment">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "12px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("Cash on Delivery")}
                    style={{
                      padding: "15px",
                      border:
                        paymentMethod === "Cash on Delivery"
                          ? "2px solid #2e7d32"
                          : "1px solid #dce5da",
                      borderRadius: "11px",
                      background:
                        paymentMethod === "Cash on Delivery"
                          ? "#eef8ee"
                          : "#ffffff",
                      cursor: "pointer",
                    }}
                  >
                    <strong>💵 Cash on Delivery</strong>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("Online Payment")}
                    style={{
                      padding: "15px",
                      border:
                        paymentMethod === "Online Payment"
                          ? "2px solid #2e7d32"
                          : "1px solid #dce5da",
                      borderRadius: "11px",
                      background:
                        paymentMethod === "Online Payment"
                          ? "#eef8ee"
                          : "#ffffff",
                      cursor: "pointer",
                    }}
                  >
                    <strong>📱 Online Payment</strong>
                  </button>
                </div>

                {paymentMethod === "Online Payment" && (
                  <div
                    style={{
                      marginTop: "12px",
                      padding: "12px",
                      background: "#fff8e1",
                      borderRadius: "10px",
                      color: "#7a5b00",
                      fontSize: "12px",
                    }}
                  >
                    ℹ️ Online payment gateway can be connected here. For now,
                    the payment is recorded as pending.
                  </div>
                )}
              </FormSection>
{/* TOTAL */}

              <div
                style={{
                  marginTop: "18px",
                  marginBottom: "18px",
                  padding: "18px",
                  background: "#eaf6e9",
                  borderRadius: "13px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>Total Amount</span>
                <strong style={{ fontSize: "24px", color: "#1b5e20" }}>
                  ₹{cartTotal.toFixed(2)}
                </strong>
              </div>

              {cartSubtotal < MIN_ORDER_VALUE && (
                <p
                  style={{
                    margin: "-6px 0 14px",
                    padding: "9px 12px",
                    background: "#fef3c7",
                    border: "1px solid #fde68a",
                    borderRadius: "10px",
                    color: "#b45309",
                    fontSize: "12px",
                    fontWeight: 700,
                    textAlign: "center",
                  }}
                >
                  ⚠️ Minimum order value is ₹{MIN_ORDER_VALUE} — add ₹
                  {(MIN_ORDER_VALUE - cartSubtotal).toFixed(2)} more to place
                  this cart order.
                </p>
              )}

              {/* SUBMIT */}

              <button
                type="submit"
                disabled={placingCartOrder || cartSubtotal < MIN_ORDER_VALUE}
                style={{
                  width: "100%",
                  padding: "15px",
                  border: "none",
                  borderRadius: "12px",
                  background:
                    placingCartOrder || cartSubtotal < MIN_ORDER_VALUE
                      ? "#aab8aa"
                      : "#2e7d32",
                  color: "#ffffff",
                  fontSize: "14px",
                  fontWeight: 800,
                  cursor:
                    placingCartOrder || cartSubtotal < MIN_ORDER_VALUE
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {placingCartOrder
                  ? "⏳ PLACING ORDER..."
                  : cartSubtotal < MIN_ORDER_VALUE
                  ? `🚫 MINIMUM ORDER ₹${MIN_ORDER_VALUE}`
                  : `🛒 PLACE ORDER • ₹${cartTotal.toFixed(2)}`}
              </button>
            </form>
          </div>
        </div>
      )}
        </main>
    </div>
  </>
  );
}

// =============================================================
// STAT CARD
// =============================================================

function StatCard({
  icon,
  title,
  value,
}) {
  return (
    <div
      style={{
        padding:
          "20px",
        background:
          "#ffffff",
        border:
          "1px solid #e3ebe1",
        borderRadius:
          "18px",
        display:
          "flex",
        alignItems:
          "center",
        gap:
          "14px",
        boxShadow:
          "0 7px 25px rgba(0,0,0,0.05)",
      }}
    >

      <div
        style={{
          width:
            "50px",
          height:
            "50px",
          borderRadius:
            "14px",
          background:
            "#e8f5e9",
          display:
            "flex",
          alignItems:
            "center",
          justifyContent:
            "center",
          fontSize:
            "24px",
        }}
      >
        {icon}
      </div>

      <div>

        <div
          style={{
            fontSize:
              "12px",
            color:
              "#737b73",
            marginBottom:
              "4px",
          }}
        >
          {title}
        </div>

        <strong
          style={{
            fontSize:
              "24px",
            color:
              "#1b5e20",
          }}
        >
          {value}
        </strong>

      </div>

    </div>
  );
}

// =============================================================
// EMPTY BOX
// =============================================================

function EmptyBox({
  icon,
  title,
  text,
}) {
  return (
    <div
      style={{
        padding:
          "45px 20px",
        textAlign:
          "center",
        border:
          "1px dashed #cad8c7",
        borderRadius:
          "15px",
        background:
          "#fbfdfb",
      }}
    >

      <div
        style={{
          fontSize:
            "42px",
          marginBottom:
            "8px",
        }}
      >
        {icon}
      </div>

      <h3
        style={{
          margin:
            "0 0 7px",
        }}
      >
        {title}
      </h3>

      {text && (
        <p
          style={{
            margin: 0,
            color:
              "#7b827b",
            fontSize:
              "13px",
          }}
        >
          {text}
        </p>
      )}

    </div>
  );
}

// =============================================================
// ORDER BOX
// =============================================================

function OrderBox({
  title,
  children,
}) {
  return (
    <div
      style={{
        padding:
          "15px",
        borderRadius:
          "12px",
        background:
          "#f9fbf8",
        border:
          "1px solid #edf1eb",
      }}
    >

      <h4
        style={{
          margin:
            "0 0 9px",
          fontSize:
            "12px",
          color:
            "#687168",
          textTransform:
            "uppercase",
        }}
      >
        {title}
      </h4>

      {children}

    </div>
  );
}

// =============================================================
// FORM SECTION
// =============================================================

function FormSection({
  title,
  children,
}) {
  return (
    <div
      style={{
        marginBottom:
          "20px",
        padding:
          "18px",
        border:
          "1px solid #e1e9df",
        borderRadius:
          "14px",
        background:
          "#fbfdfb",
      }}
    >

      <h3
        style={{
          margin:
            "0 0 15px",
          fontSize:
            "15px",
        }}
      >
        {title}
      </h3>

      <div
        style={{
          display:
            "flex",
          flexDirection:
            "column",
          gap:
            "13px",
        }}
      >
        {children}
      </div>

    </div>
  );
}

// =============================================================
// FORM FIELD
// =============================================================

function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  textarea = false,
  required = false,
}) {
  const commonProps = {
    value,
    onChange: (e) =>
      onChange(e.target.value),
    placeholder,
    required,
  };

  return (
    <div
      style={{
        display:
          "flex",
        flexDirection:
          "column",
        gap:
          "6px",
      }}
    >

      <label
        style={{
          fontSize:
            "12px",
          fontWeight:
            700,
          color:
            "#465146",
        }}
      >
        {label}
      </label>

      {textarea ? (

        <textarea
          {...commonProps}
          rows="3"
          style={{
            width:
              "100%",
            boxSizing:
              "border-box",
            padding:
              "12px",
            border:
              "1px solid #d7e1d4",
            borderRadius:
              "10px",
            resize:
              "vertical",
            fontSize:
              "14px",
          }}
        />

      ) : (

        <input
          {...commonProps}
          type={type}
          style={{
            width:
              "100%",
            boxSizing:
              "border-box",
            padding:
              "12px",
            border:
              "1px solid #d7e1d4",
            borderRadius:
              "10px",
            fontSize:
              "14px",
          }}
        />

      )}

    </div>
  );
}

export default ConsumerDashboard;