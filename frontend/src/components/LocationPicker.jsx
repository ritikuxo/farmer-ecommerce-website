// ==========================================================
//  E-FARM LOCATION PICKER
//
//  A small interactive map (Leaflet + free OpenStreetMap
//  tiles — no API key) that lets the consumer drop / drag a
//  pin on the exact delivery spot. Browser geolocation can
//  return a city-level (IP-based) fix hundreds of km off;
//  a visual pin is impossible to get wrong.
// ==========================================================

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { haversineKm } from "../dashboards/deliveryEarnings";

/* Emoji pin as a divIcon — no image assets to bundle, no
   broken default-marker icons under Vite.                    */
const pinIcon = L.divIcon({
  className: "efarm-map-pin",
  html: '<div style="font-size:28px;line-height:28px;transform:translate(-50%,-96%);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));">📍</div>',
  iconSize: [28, 28],
  iconAnchor: [0, 0],
});

const validCoord = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0;
};

function LocationPicker({
  latitude,
  longitude,
  centerHint = null,
  onChange,
  height = 240,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /* Init once. The delivery trip is hyperlocal (≤ 7 km from the
     farm), so the FARM is the trustworthy frame of reference. A
     browser GPS fix can be a city-level guess hundreds of km off
     — if the current pin coords sit far outside the farm area,
     open on the farm and let the user drag the pin from there. */
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const hasCoords = validCoord(latitude) && validCoord(longitude);
    const hintOk =
      centerHint &&
      validCoord(centerHint.latitude) &&
      validCoord(centerHint.longitude);

    const coordsNearHint =
      hasCoords &&
      hintOk &&
      (() => {
        const d = haversineKm(
          latitude,
          longitude,
          centerHint.latitude,
          centerHint.longitude
        );
        return d != null && d <= 50;
      })();

    let center;
    let zoom;
    if (hintOk && hasCoords && coordsNearHint) {
      center = [Number(latitude), Number(longitude)];
      zoom = 15;
    } else if (hintOk) {
      center = [Number(centerHint.latitude), Number(centerHint.longitude)];
      zoom = 13;
    } else if (hasCoords) {
      center = [Number(latitude), Number(longitude)];
      zoom = 15;
    } else {
      center = [21.5, 78.9];
      zoom = 5;
    }

    const map = L.map(containerRef.current, {
      scrollWheelZoom: false, // the checkout modal scrolls too
      zoomControl: true,
    }).setView(center, zoom);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    const marker = L.marker(center, {
      draggable: true,
      icon: pinIcon,
    }).addTo(map);

    marker.on("dragend", () => {
      const p = marker.getLatLng();
      onChangeRef.current?.(p.lat, p.lng);
    });

    /* Click anywhere on the map moves the pin there.        */
    map.on("click", (e) => {
      marker.setLatLng(e.latlng);
      onChangeRef.current?.(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;
    markerRef.current = marker;

    /* The checkout modal animates in — give Leaflet a tick to
       measure its container, otherwise tiles render clipped. */
    const t = setTimeout(() => map.invalidateSize(), 300);

    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Follow outside coordinate changes (📍 GPS capture or
     pasted coordinates) — move the pin + keep it in view.
     Skips the echo of a map drag (marker already there).      */
  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return;
    if (!validCoord(latitude) || !validCoord(longitude)) return;
    const lat = Number(latitude);
    const lng = Number(longitude);
    const cur = markerRef.current.getLatLng();
    if (Math.abs(cur.lat - lat) < 1e-9 && Math.abs(cur.lng - lng) < 1e-9) {
      return;
    }
    markerRef.current.setLatLng([lat, lng]);
    mapRef.current.setView([lat, lng], Math.max(mapRef.current.getZoom(), 14), {
      animate: true,
    });
  }, [latitude, longitude]);

  /* When the farm location loads late (async profile fetch),
     move the map + pin onto the farm — but never move an
     already-set pin.                                          */
  useEffect(() => {
    if (!mapRef.current || !markerRef.current || !centerHint) return;
    if (!validCoord(centerHint.latitude) || !validCoord(centerHint.longitude))
      return;
    if (validCoord(latitude) && validCoord(longitude)) return;
    const c = [Number(centerHint.latitude), Number(centerHint.longitude)];
    markerRef.current.setLatLng(c);
    mapRef.current.setView(c, 13);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerHint]);

  return (
    <div style={{ position: "relative", zIndex: 0 }}>
      <div
        ref={containerRef}
        style={{
          height,
          borderRadius: 12,
          border: "1px solid #dce5da",
          background: "#eef2ec",
        }}
      />
      <p style={{ fontSize: 11, color: "#6b7280", margin: "6px 0 0" }}>
        Drag the 📍 pin — or click the map — to set the exact delivery spot.
      </p>
    </div>
  );
}

export default LocationPicker;
