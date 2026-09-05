import React from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import "./Roles.css";

function Roles() {
  const navigate = useNavigate();

  const roles = [
    {
      id: "admin",
      badge: "🛡️",
      art: "📋",
      title: "Admin",
      description:
        "Manage users, approve farmers and delivery partners, and oversee the platform.",
    },

    {
      id: "farmer",
      badge: "🌱",
      art: "👨‍🌾",
      title: "Farmer",
      description:
        "Sell your agricultural products directly to consumers and grow your business.",
    },

    {
      id: "consumer",
      badge: "🛒",
      art: "🧺",
      title: "Consumer",
      description:
        "Buy fresh and quality products directly from farmers at the best prices.",
    },

    {
      id: "delivery",
      badge: "🚚",
      art: "🛵",
      title: "Delivery Partner",
      description:
        "Deliver orders safely and on time and help farmers reach more customers.",
    },
  ];

  return (
    <div className="roles-page">

      {/* Background image */}
      <div className="roles-bg"></div>

      {/* Light overlay for readability */}
      <div className="roles-overlay"></div>

      {/* Decorative leaves in the top corners */}
      <span className="leaf leaf-1">🍃</span>
      <span className="leaf leaf-2">🍃</span>
      <span className="leaf leaf-3">🍃</span>
      <span className="leaf leaf-4">🍃</span>

      <motion.div
        className="roles-content"

        initial={{
          opacity: 0,
          y: 30,
        }}

        animate={{
          opacity: 1,
          y: 0,
        }}

        transition={{
          duration: 0.7,
        }}
      >

        {/* LOGO */}
        <div className="roles-logo">
          <span className="roles-logo-icon">🌿</span>
          <span className="roles-logo-text">E-FARM</span>
        </div>

        {/* HEADING */}
        <h1>Who are you?</h1>

        {/* SUBTITLE */}
        <div className="roles-subtitle">
          <span className="subtitle-arrow">⟶</span>
          <span>Choose your role to continue</span>
          <span className="subtitle-arrow">⟵</span>
        </div>

        {/* ROLE CARDS */}
        <div className="roles-grid">

          {roles.map((role, index) => (

            <motion.button
              key={role.id}

              className="roles-card"

              onClick={() =>
                navigate("/login", {
                  state: {
                    role: role.id,
                  },
                })
              }

              initial={{
                opacity: 0,
                y: 30,
              }}

              animate={{
                opacity: 1,
                y: 0,
              }}

              transition={{
                delay: 0.15 + index * 0.12,
                duration: 0.5,
              }}

              whileHover={{
                y: -8,
              }}

              whileTap={{
                scale: 0.97,
              }}
            >

              <span className="role-badge">
                {role.badge}
              </span>

              <span className="role-art">
                {role.art}
              </span>

              <span className="role-title">
                {role.title}
              </span>

              <span className="role-desc">
                {role.description}
              </span>

              <span className="role-continue">
                Continue →
              </span>

            </motion.button>

          ))}

        </div>

        {/* BACK BUTTON */}
        <motion.button
          className="roles-back"

          onClick={() =>
            navigate("/")
          }

          whileHover={{
            scale: 1.05,
          }}

          whileTap={{
            scale: 0.95,
          }}
        >
          ← Back to E-Farm
        </motion.button>

      </motion.div>

    </div>
  );
}

export default Roles;