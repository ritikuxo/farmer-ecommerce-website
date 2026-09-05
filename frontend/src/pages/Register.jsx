import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";

import { createUserWithEmailAndPassword } from "firebase/auth";

import {
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";

import "./Register.css";

function Register() {
  const navigate = useNavigate();
  const location = useLocation();

  /*
  =====================================================
  GET SELECTED ROLE
  =====================================================
  */

  const passedRole = location.state?.role;

  const validRoles = [
    "farmer",
    "consumer",
    "delivery",
  ];

  const role = validRoles.includes(passedRole)
    ? passedRole
    : "consumer";

  /*
  =====================================================
  ROLE DATA
  =====================================================
  */

  const roleData = {
    farmer: {
      icon: "👨‍🌾",
      name: "Farmer",
    },

    consumer: {
      icon: "🛒",
      name: "Consumer",
    },

    delivery: {
      icon: "🚚",
      name: "Delivery Partner",
    },
  };

  const currentRole = roleData[role];

  /*
  =====================================================
  FORM STATE
  =====================================================
  */

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /*
  =====================================================
  REGISTER
  =====================================================
  */

  const handleRegister = async (e) => {
    e.preventDefault();

    setError("");

    /*
    VALIDATION
    */

    if (
      !name.trim() ||
      !email.trim() ||
      !phone.trim() ||
      !password
    ) {
      setError("Please fill all fields.");
      return;
    }

    if (name.trim().length < 2) {
      setError("Please enter your full name.");
      return;
    }

    if (password.length < 6) {
      setError(
        "Password must be at least 6 characters."
      );
      return;
    }

    const cleanPhone = phone.replace(/\D/g, "");

    if (cleanPhone.length !== 10) {
      setError(
        "Please enter a valid 10-digit mobile number."
      );
      return;
    }

    try {
      setLoading(true);

      console.log("=================================");
      console.log("E-FARM REGISTRATION");
      console.log("Selected Role:", role);
      console.log("=================================");

      /*
      =====================================================
      STEP 1
      CREATE FIREBASE AUTH ACCOUNT
      =====================================================
      */

      const userCredential =
        await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );

      const user = userCredential.user;

      console.log(
        "Firebase UID:",
        user.uid
      );

      /*
      =====================================================
      STEP 2
      STATUS
      =====================================================
      */

      let status = "approved";

      if (
        role === "farmer" ||
        role === "delivery"
      ) {
        status = "pending";
      }

      /*
      =====================================================
      STEP 3
      FIRESTORE USER PROFILE
      =====================================================
      */

      const userProfile = {
        uid: user.uid,

        name: name.trim(),

        email: email.trim(),

        phone: cleanPhone,

        role: role,

        status: status,

        createdAt: serverTimestamp(),
      };

      console.log(
        "Saving Firestore profile:",
        userProfile
      );

      await setDoc(
        doc(db, "users", user.uid),
        userProfile
      );

      console.log(
        "User profile saved successfully."
      );

      /*
      =====================================================
      SUCCESS
      =====================================================
      */

      if (role === "farmer") {
        alert(
          "✅ Farmer account created successfully!\n\nYour account is waiting for Admin approval."
        );
      }

      else if (role === "delivery") {
        alert(
          "✅ Delivery Partner account created successfully!\n\nYour account is waiting for Admin approval."
        );
      }

      else {
        alert(
          "✅ Consumer account created successfully!"
        );
      }

      /*
      =====================================================
      GO TO LOGIN
      =====================================================
      */

      navigate("/login", {
        replace: true,
        state: {
          role: role,
        },
      });

    } catch (err) {

      console.error(
        "REGISTRATION ERROR:",
        err
      );

      /*
      FIREBASE ERRORS
      */

      if (
        err?.code ===
        "auth/email-already-in-use"
      ) {
        setError(
          "This email is already registered. Please login instead."
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
        "auth/weak-password"
      ) {
        setError(
          "Password must be at least 6 characters."
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
          "Firestore permission denied. Check your Firestore security rules."
        );
      }

      else {
        setError(
          err?.message
            ? `Registration failed: ${err.message}`
            : "Registration failed. Please try again."
        );
      }

    } finally {
      setLoading(false);
    }
  };

  /*
  =====================================================
  PAGE
  =====================================================
  */

  return (
    <div className="register-page">

      {/* Background image */}
      <div className="register-bg"></div>

      {/* Light overlay for readability */}
      <div className="register-overlay"></div>

      {/* Decorative leaves in the corners */}
      <span className="register-leaf register-leaf-1">🍃</span>
      <span className="register-leaf register-leaf-2">🍃</span>
      <span className="register-leaf register-leaf-3">🍃</span>
      <span className="register-leaf register-leaf-4">🍃</span>

      <motion.div
        className="register-content"

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

      <div className="auth-card register-card">

        {/* BACK */}

        <button
          type="button"
          className="auth-back"
          onClick={() =>
            navigate("/login", {
              state: {
                role: role,
              },
            })
          }
          disabled={loading}
        >
          ← Back to Login
        </button>

        {/* ROLE ICON */}

        <div className="auth-icon">
          {currentRole.icon}
        </div>

        {/* BRAND */}

        <div className="auth-brand">
          🌾 E-FARM
        </div>

        {/* TITLE */}

        <h1>
          Create {currentRole.name} Account
        </h1>

        <p className="auth-description">
          Join E-Farm and get started today.
        </p>

        {/* ERROR */}

        {error && (
          <div className="auth-error">
            {error}
          </div>
        )}

        {/* FORM */}

        <form onSubmit={handleRegister}>

          {/* NAME */}

          <label htmlFor="name">
            Full Name
          </label>

          <input
            id="name"
            type="text"
            placeholder="Enter your full name"
            value={name}
            onChange={(e) =>
              setName(e.target.value)
            }
            disabled={loading}
            autoComplete="name"
          />

          {/* EMAIL */}

          <label htmlFor="email">
            Email Address
          </label>

          <input
            id="email"
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
            disabled={loading}
            autoComplete="email"
          />

          {/* PHONE */}

          <label htmlFor="phone">
            Mobile Number
          </label>

          <input
            id="phone"
            type="tel"
            placeholder="Enter 10-digit mobile number"
            value={phone}
            onChange={(e) =>
              setPhone(
                e.target.value.replace(/\D/g, "")
              )
            }
            disabled={loading}
            maxLength={10}
            autoComplete="tel"
          />

          {/* PASSWORD */}

          <label htmlFor="password">
            Password
          </label>

          <input
            id="password"
            type="password"
            placeholder="Create a password"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
            disabled={loading}
            autoComplete="new-password"
          />

          {/* ROLE INFORMATION */}

          <div
            style={{
              marginTop: "15px",
              marginBottom: "15px",
              padding: "12px",
              borderRadius: "10px",
              background: "#f0f8ed",
              textAlign: "center",
              color: "#176b35",
              fontWeight: "700",
            }}
          >
            {currentRole.icon} Registering as{" "}
            {currentRole.name}
          </div>

          {/* SUBMIT */}

          <button
            type="submit"
            className="auth-submit"
            disabled={loading}
          >
            {loading
              ? "CREATING ACCOUNT..."
              : `CREATE ${currentRole.name.toUpperCase()} ACCOUNT`}
          </button>

        </form>

        {/* LOGIN */}

        <p className="login-text">
          Already have an account?
        </p>

        <button
          type="button"
          className="register-button"
          onClick={() =>
            navigate("/login", {
              state: {
                role: role,
              },
            })
          }
          disabled={loading}
        >
          LOGIN
        </button>

      </div>

      </motion.div>

    </div>
  );
}

export default Register;