import React from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import "./Home.css";

function Home() {
  const navigate = useNavigate();

  return (
    <div className="efarm-home">

      {/* Background image */}
      <div className="hero-background"></div>

      {/* Dark/light overlay for readability */}
      <div className="hero-overlay"></div>

      {/* Main content */}
      <div className="hero-content">

        {/* Logo */}
        <motion.div
          className="efarm-logo"
          initial={{ opacity: 0, y: -25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <div className="logo-symbol">🌾</div>

          <div className="logo-text">
            <div className="logo-name">E-FARM</div>
            <div className="logo-tagline">
              DIRECT FARMER TO CONSUMER
            </div>
          </div>
        </motion.div>


        {/* Heading */}
        <motion.h1
          initial={{ opacity: 0, y: 35 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 }}
        >
          WELCOME TO
          <br />
          <span>E-FARM</span>
        </motion.h1>


        {/* Subtitle */}
        <motion.p
          className="main-subtitle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.8 }}
        >
          Empowering Farmers • Connecting Consumers
        </motion.p>


        {/* Feature bar */}
        <motion.div
          className="feature-bar"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.8 }}
        >

          <div className="feature">
            <div className="feature-icon">👨‍🌾</div>
            <div>
              <strong>Empowering</strong>
              <span>Farmers</span>
            </div>
          </div>

          <div className="feature-divider"></div>

          <div className="feature">
            <div className="feature-icon">🥬</div>
            <div>
              <strong>Fresh</strong>
              <span>Products</span>
            </div>
          </div>

          <div className="feature-divider"></div>

          <div className="feature">
            <div className="feature-icon">🚚</div>
            <div>
              <strong>Fast & Safe</strong>
              <span>Delivery</span>
            </div>
          </div>

          <div className="feature-divider"></div>

          <div className="feature">
            <div className="feature-icon">💰</div>
            <div>
              <strong>Fair</strong>
              <span>Pricing</span>
            </div>
          </div>

        </motion.div>


        {/* Enter button */}
        <motion.button
          className="enter-efarm"
          onClick={() => navigate("/roles")}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1, duration: 0.8 }}
          whileHover={{
            scale: 1.06,
            boxShadow: "0 15px 35px rgba(0, 80, 30, 0.35)",
          }}
          whileTap={{ scale: 0.96 }}
        >
          ENTER E-FARM
          <span>→</span>
        </motion.button>


        {/* Bottom information bar */}
        <motion.div
          className="bottom-bar"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 1 }}
        >
          <span>🌱 Fresh From Farmers</span>
          <b>•</b>
          <span>💰 Fair Pricing</span>
          <b>•</b>
          <span>🚚 Reliable Delivery</span>
        </motion.div>

      </div>
    </div>
  );
}

export default Home;