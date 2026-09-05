import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";

import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../firebase/config";

import "./Login.css";

/*
=====================================================
ROLES
=====================================================
*/

const ROLES = {
  consumer: {
    name: "Consumer",
    icon: "🛒",
    dashboard: "/consumer-dashboard",
  },

  farmer: {
    name: "Farmer",
    icon: "👨‍🌾",
    dashboard: "/farmer-dashboard",
  },

  delivery: {
    name: "Delivery Partner",
    icon: "🚚",
    dashboard: "/delivery-dashboard",
  },

  admin: {
    name: "Admin",
    icon: "🛡️",
    dashboard: "/admin-dashboard",
  },
};

/*
=====================================================
LOGIN COMPONENT
=====================================================
*/

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  /*
  =====================================================
  GET ROLE FROM PREVIOUS PAGE
  =====================================================
  */

  const roleFromPreviousPage = location.state?.role;

  const validRoles = Object.keys(ROLES);

  const initialRole = validRoles.includes(
    roleFromPreviousPage
  )
    ? roleFromPreviousPage
    : "consumer";

  const [selectedRole, setSelectedRole] =
    useState(initialRole);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /*
  =====================================================
  UPDATE ROLE WHEN NAVIGATION STATE CHANGES
  =====================================================
  */

  useEffect(() => {
    if (
      roleFromPreviousPage &&
      validRoles.includes(roleFromPreviousPage)
    ) {
      setSelectedRole(roleFromPreviousPage);
      setError("");
    }
  }, [roleFromPreviousPage]);

  /*
  =====================================================
  ROLE CHANGE
  =====================================================
  */

  const handleRoleChange = (role) => {
    setSelectedRole(role);
    setError("");

    /*
    Clear password when changing role.
    This avoids accidentally trying to login
    with credentials for another role.
    */

    setPassword("");
  };

  /*
  =====================================================
  LOGIN
  =====================================================
  */

  const handleLogin = async (e) => {
    e.preventDefault();

    setError("");

    /*
    VALIDATION
    */

    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }

    if (!password) {
      setError("Please enter your password.");
      return;
    }

    try {
      setLoading(true);

      console.log("=================================");
      console.log("E-FARM LOGIN");
      console.log("Selected Role:", selectedRole);
      console.log("Email:", email.trim());
      console.log("=================================");

      /*
      =====================================================
      STEP 1
      FIREBASE AUTHENTICATION
      =====================================================
      */

      const result =
        await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );

      const uid = result.user.uid;

      console.log(
        "Firebase authentication successful."
      );

      console.log("UID:", uid);

      /*
      =====================================================
      STEP 2
      GET USER PROFILE
      =====================================================
      */

      const userRef = doc(
        db,
        "users",
        uid
      );

      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        setError(
          "User profile not found. Please contact the administrator."
        );

        return;
      }

      const userData = userSnap.data();

      console.log(
        "Firestore user profile:",
        userData
      );

      /*
      =====================================================
      STEP 3
      GET FIRESTORE ROLE
      =====================================================
      */

      const firebaseRole = String(
        userData.role || ""
      )
        .trim()
        .toLowerCase();

      console.log(
        "Firestore Role:",
        firebaseRole
      );

      /*
      =====================================================
      STEP 4
      CHECK ROLE
      =====================================================
      */

      if (!firebaseRole) {
        setError(
          "Your account does not have a valid role. Please contact the administrator."
        );

        return;
      }

      if (!ROLES[firebaseRole]) {
        setError(
          `Invalid account role: ${firebaseRole}`
        );

        return;
      }

      /*
      SELECTED ROLE MUST MATCH FIRESTORE ROLE
      */

      if (firebaseRole !== selectedRole) {
        setError(
          `This account is registered as ${ROLES[firebaseRole].name}, not ${ROLES[selectedRole].name}.`
        );

        return;
      }

      /*
      =====================================================
      STEP 5
      APPROVAL CHECK
      =====================================================
      */

      /*
      Farmer and Delivery accounts need
      Admin approval.

      Consumer and Admin can login directly.
      */

      if (
        (selectedRole === "farmer" ||
          selectedRole === "delivery") &&
        userData.status !== "approved"
      ) {
        if (selectedRole === "farmer") {
          setError(
            "Your Farmer account is waiting for Admin approval."
          );
        } else {
          setError(
            "Your Delivery Partner account is waiting for Admin approval."
          );
        }

        return;
      }

      /*
      =====================================================
      STEP 6
      SAVE LOGIN INFORMATION
      =====================================================
      */

      localStorage.setItem(
        "eFarmUser",
        JSON.stringify({
          uid: uid,

          email: result.user.email,

          role: firebaseRole,

          name: userData.name || "",

          phone: userData.phone || "",

          status: userData.status || "",
        })
      );

      console.log(
        "Login information saved."
      );

      /*
      =====================================================
      STEP 7
      REDIRECT TO CORRECT DASHBOARD
      =====================================================
      */

      const dashboard =
        ROLES[firebaseRole].dashboard;

      console.log(
        "Redirecting to:",
        dashboard
      );

      navigate(dashboard, {
        replace: true,
      });

    } catch (err) {
      console.error(
        "================================="
      );

      console.error(
        "LOGIN ERROR:",
        err
      );

      console.error(
        "ERROR CODE:",
        err?.code
      );

      console.error(
        "ERROR MESSAGE:",
        err?.message
      );

      console.error(
        "================================="
      );

      /*
      =====================================================
      FIREBASE ERRORS
      =====================================================
      */

      if (
        err?.code ===
        "auth/invalid-credential"
      ) {
        setError(
          "Invalid email or password."
        );
      }

      else if (
        err?.code ===
        "auth/user-not-found"
      ) {
        setError(
          "No account found with this email."
        );
      }

      else if (
        err?.code ===
        "auth/wrong-password"
      ) {
        setError(
          "Incorrect password."
        );
      }

      else if (
        err?.code ===
        "auth/invalid-email"
      ) {
        setError(
          "Please enter a valid email address."
        );
      }

      else if (
        err?.code ===
        "auth/too-many-requests"
      ) {
        setError(
          "Too many login attempts. Please try again later."
        );
      }

      else if (
        err?.code ===
        "auth/network-request-failed"
      ) {
        setError(
          "Network error. Please check your internet connection."
        );
      }

      else if (
        err?.code ===
        "permission-denied" ||
        err?.code ===
        "firestore/permission-denied"
      ) {
        setError(
          "Firestore permission denied. Please check your Firestore security rules."
        );
      }

      else {
        setError(
          err?.message ||
            "Login failed. Please try again."
        );
      }

    } finally {
      setLoading(false);
    }
  };

  /*
  =====================================================
  GO TO REGISTER
  =====================================================
  */

  const handleRegister = () => {
    navigate("/register", {
      state: {
        role: selectedRole,
      },
    });
  };

  /*
  =====================================================
  GO HOME
  =====================================================
  */

  const handleBackHome = () => {
    navigate("/");
  };

  /*
  =====================================================
  PAGE
  =====================================================
  */

  return (
    <div className="login-page">

      <div className="login-shell">

        {/* =========================================
            LEFT HERO
        ========================================= */}

        <div className="login-hero">

          <div className="login-hero-bg"></div>

          <div className="login-hero-overlay"></div>

          <div className="login-hero-glow login-hero-glow-top"></div>
          <div className="login-hero-glow login-hero-glow-bottom"></div>

          <div className="login-hero-content">

            {/* BRAND */}

            <div className="login-brand">
              <div className="login-brand-mark">🌿</div>

              <div className="login-brand-text">
                <div className="login-brand-name">E-FARM</div>
                <div className="login-brand-tag">
                  Direct Farmer to Consumer
                </div>
              </div>
            </div>

            {/* COPY */}

            <div className="login-hero-copy">
              <h1>
                Fresh From Farm,
                <br />
                Straight To Your Table
              </h1>

              <p className="login-hero-desc">
                E-Farm connects local farmers directly with
                consumers and delivery partners — no
                middlemen, fair prices and guaranteed
                freshness.
              </p>

              <ul className="login-feature-list">

                <li>
                  <span className="login-feature-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
                      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
                    </svg>
                  </span>
                  <div>
                    <strong>100% Fresh Produce</strong>
                    <span>Harvested locally and delivered without middlemen.</span>
                  </div>
                </li>

                <li>
                  <span className="login-feature-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
                      <path d="M15 18H9" />
                      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
                      <circle cx="17" cy="18" r="2" />
                      <circle cx="7" cy="18" r="2" />
                    </svg>
                  </span>
                  <div>
                    <strong>Fast &amp; Safe Delivery</strong>
                    <span>Trusted partners bring orders to your doorstep.</span>
                  </div>
                </li>

                <li>
                  <span className="login-feature-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
                      <path d="M8 8h8" />
                      <path d="M12 8v8" />
                      <path d="M8 12h5" />
                    </svg>
                  </span>
                  <div>
                    <strong>Fair Pricing</strong>
                    <span>Farmers earn more while consumers pay less.</span>
                  </div>
                </li>

              </ul>
            </div>

          </div>
        </div>

        {/* =========================================
            RIGHT FORM CARD
        ========================================= */}

        <div className="login-form-side">

          <motion.div
            className="login-card"

            initial={{
              opacity: 0,
              y: 30,
            }}

            animate={{
              opacity: 1,
              y: 0,
            }}

            transition={{
              duration: 0.6,
            }}
          >

        {/* =========================================
            LOGO
        ========================================= */}

        <div className="login-logo">
          <h1>🌾 E-FARM</h1>

          <p>
            DIRECT FARMER TO CONSUMER
          </p>
        </div>

        {/* =========================================
            TITLE
        ========================================= */}

        <h2 className="login-title">
          Welcome Back
        </h2>

        <p className="login-subtitle">
          Select your account type
        </p>

        {/* =========================================
            ROLE SELECTION
        ========================================= */}

        <div className="role-grid">

          {/* CONSUMER */}

          <button
            type="button"
            className={`role-button ${
              selectedRole === "consumer"
                ? "active"
                : ""
            }`}
            onClick={() =>
              handleRoleChange("consumer")
            }
            disabled={loading}
          >
            <span className="role-icon">
              🛒
            </span>

            Consumer
          </button>

          {/* FARMER */}

          <button
            type="button"
            className={`role-button ${
              selectedRole === "farmer"
                ? "active"
                : ""
            }`}
            onClick={() =>
              handleRoleChange("farmer")
            }
            disabled={loading}
          >
            <span className="role-icon">
              👨‍🌾
            </span>

            Farmer
          </button>

          {/* DELIVERY */}

          <button
            type="button"
            className={`role-button ${
              selectedRole === "delivery"
                ? "active"
                : ""
            }`}
            onClick={() =>
              handleRoleChange("delivery")
            }
            disabled={loading}
          >
            <span className="role-icon">
              🚚
            </span>

            Delivery
          </button>

          {/* ADMIN */}

          <button
            type="button"
            className={`role-button ${
              selectedRole === "admin"
                ? "active"
                : ""
            }`}
            onClick={() =>
              handleRoleChange("admin")
            }
            disabled={loading}
          >
            <span className="role-icon">
              🛡️
            </span>

            Admin
          </button>

        </div>

        {/* =========================================
            SELECTED ROLE
        ========================================= */}

        <div
          style={{
            textAlign: "center",
            marginBottom: "15px",
            fontWeight: "600",
          }}
        >
          {ROLES[selectedRole].icon}{" "}
          Login as{" "}
          {ROLES[selectedRole].name}
        </div>

        {/* =========================================
            LOGIN FORM
        ========================================= */}

        <form onSubmit={handleLogin}>

          {/* EMAIL */}

          <div className="input-group">

            <label htmlFor="login-email">
              Email
            </label>

            <input
              id="login-email"
              type="email"
              placeholder={`Enter ${ROLES[selectedRole].name} email`}
              value={email}
              onChange={(e) =>
                setEmail(e.target.value)
              }
              disabled={loading}
              autoComplete="email"
            />

          </div>

          {/* PASSWORD */}

          <div className="input-group">

            <label htmlFor="login-password">
              Password
            </label>

            <input
              id="login-password"
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) =>
                setPassword(e.target.value)
              }
              disabled={loading}
              autoComplete="current-password"
            />

          </div>

          {/* ERROR */}

          {error && (
            <div className="login-message">
              {error}
            </div>
          )}

          {/* LOGIN BUTTON */}

          <button
            type="submit"
            className="login-button"
            disabled={loading}
          >
            {loading
              ? "Logging in..."
              : `Login as ${ROLES[selectedRole].name}`}
          </button>

        </form>

        {/* =========================================
            REGISTER
        ========================================= */}

        <div className="register-link">

          Don't have an account?{" "}

          <button
            type="button"
            onClick={handleRegister}
            disabled={loading}
          >
            Register
          </button>

        </div>

        {/* =========================================
            HOME
        ========================================= */}

        <button
          type="button"
          className="back-home"
          onClick={handleBackHome}
          disabled={loading}
        >
          ← Back to E-Farm
        </button>

        </motion.div>

        </div>

      </div>

    </div>
  );
}