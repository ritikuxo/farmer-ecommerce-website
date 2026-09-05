import {
  BrowserRouter,
  Routes,
  Route,
} from "react-router-dom";

import Home from "./pages/Home";
import Roles from "./pages/Roles";
import Login from "./pages/Login";
import Register from "./pages/Register";

import FarmerDashboard from "./dashboards/FarmerDashboard";
import ConsumerDashboard from "./dashboards/ConsumerDashboard";
import DeliveryDashboard from "./dashboards/DeliveryDashboard";
import AdminDashboard from "./dashboards/AdminDashboard";

import "./index.css";

/* =========================================
   APP ROUTES
========================================= */

function App() {
  return (
    <BrowserRouter>

      <Routes>

        {/* STARTING PAGE - WELCOME */}
        <Route
          path="/"
          element={<Home />}
        />

        {/* ROLE SELECTION */}
        <Route
          path="/roles"
          element={<Roles />}
        />

        {/* LOGIN */}
        <Route
          path="/login"
          element={<Login />}
        />

        {/* REGISTER */}
        <Route
          path="/register"
          element={<Register />}
        />

        {/* FARMER */}
        <Route
          path="/farmer-dashboard"
          element={<FarmerDashboard />}
        />

        {/* CONSUMER */}
        <Route
          path="/consumer-dashboard"
          element={<ConsumerDashboard />}
        />

        {/* DELIVERY */}
        <Route
          path="/delivery-dashboard"
          element={<DeliveryDashboard />}
        />

        {/* ADMIN */}
        <Route
          path="/admin-dashboard"
          element={<AdminDashboard />}
        />

        {/* UNKNOWN URL */}
        <Route
          path="*"
          element={<Home />}
        />

      </Routes>

    </BrowserRouter>
  );
}

export default App;
