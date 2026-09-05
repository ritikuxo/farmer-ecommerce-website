// ==========================================================
//  E-FARM DELIVERY EARNINGS ENGINE
//
//  Single source of truth for how a delivery partner is
//  paid. Every dashboard imports from here so the numbers
//  always match.
//
//  MODEL
//  ─────────────────────────────────────────────────────────
//  Minimum order value (platform rule):
//      ₹200 — no order below this can be placed, which keeps
//      small orders viable on a farmer-first marketplace
//
//  Delivery charge (consumer pays the delivery partner):
//      FLAT ₹10 — the consumer adds this at checkout. Same small
//      amount for every order, whatever the trip distance.
//      Distance still drives the 7 km service-range rule and the
//      km display, just not the price.
//
//  Delivery commission (the FARMER pays the delivery partner):
//      5% of the order value, clamped to ₹10 … ₹120, paid OUT OF
//      the farmer's sale proceeds. So every delivery the partner
//      earns from BOTH ends:
//        • delivery charge  ← paid by the consumer
//        • farmer commission ← paid by the farmer (deducted from
//          the farmer's share of the sale)
//
//  Farmer keeps per sale: order value − farmer commission
//
//  Partner earning per delivery =
//      delivery charge + farmer commission
// ==========================================================

export const DELIVERY_RATES = {
  BASE_FEE: 10,
  // Flat platform fee: FREE_KM covers every practical trip and
  // MAX_CHARGE pins the charge to the base fee, so the delivery
  // charge is ALWAYS ₹10 regardless of trip distance.
  FREE_KM: 7,
  PER_KM: 5,
  MIN_CHARGE: 10,
  MAX_CHARGE: 10,
  COMMISSION_PCT: 5,
  COMMISSION_MIN: 10,
  COMMISSION_MAX: 120,
};

// Platform rule: orders below this value cannot be placed.
// Keeps delivery economical for a farmer-first marketplace.
export const MIN_ORDER_VALUE = 200;

// Platform rule: a delivery partner can only accept orders
// whose trip starts within this range (km) of the farmer
// location — keeps deliveries hyperlocal and produce fresh.
export const DELIVERY_RANGE_KM = 7;

export const round2 = (n) =>
  Math.round(Number(n) * 100) / 100;

export const rupee = (n) =>
  `₹${round2(n || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;

// Great-circle distance between two coordinates, in km.
export function haversineKm(lat1, lng1, lat2, lng2) {
  const ok = (v) =>
    Number.isFinite(Number(v)) && Number(v) !== 0;
  if (!ok(lat1) || !ok(lng1) || !ok(lat2) || !ok(lng2)) {
    return null;
  }

  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const R = 6371; // Earth radius, km

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  const straight = 2 * R * Math.asin(Math.sqrt(a));

  // Roads are never straight: apply a typical 1.3x detour factor.
  return round2(straight * 1.3);
}

// Delivery charge for a trip of `km` km (null km → flat base fee).
export function calcDeliveryCharge(km) {
  if (km == null) {
    return DELIVERY_RATES.BASE_FEE;
  }
  const extraKm = Math.max(
    0,
    Number(km) - DELIVERY_RATES.FREE_KM
  );
  const raw =
    DELIVERY_RATES.BASE_FEE +
    extraKm * DELIVERY_RATES.PER_KM;
  return round2(
    Math.min(
      Math.max(raw, DELIVERY_RATES.MIN_CHARGE),
      DELIVERY_RATES.MAX_CHARGE
    )
  );
}

// Farmer-funded delivery commission on an order worth
// `orderValue`. The farmer pays this to the delivery partner
// out of their sale proceeds (farmer keeps the rest).
export function calcCommission(orderValue) {
  const value = Number(orderValue) || 0;
  if (value <= 0) return 0;
  const pct =
    (value * DELIVERY_RATES.COMMISSION_PCT) / 100;
  return round2(
    Math.min(
      Math.max(pct, DELIVERY_RATES.COMMISSION_MIN),
      DELIVERY_RATES.COMMISSION_MAX
    )
  );
}

// Order value (mirrors the dashboards' fallback logic).
export function getOrderValue(order) {
  const total = Number(order?.totalAmount);
  if (Number.isFinite(total) && total > 0) return total;
  return (
    (Number(order?.price) || 0) *
    (Number(order?.quantity) || 0)
  );
}

function firstCoord(...candidates) {
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return null;
}

// Resolve pickup (farmer) and drop (consumer) coordinates from
// the many field layouts used across the app, then compute the
// trip distance. `fallbackPickup` (e.g. the viewing farmer's own
// profile location) is used when the order has no pickup coords
// yet — e.g. pending orders before the farmer accepts.
// `pickupOverride` (e.g. the farmer's CURRENT profile location,
// fetched live by the dashboard) beats the coordinates frozen on
// the order: `farmLocation` is a checkout-time snapshot, so if
// the farmer later fixes a wrong farm location the stale
// snapshot used to keep every dashboard showing a huge distance
// (e.g. 504 km) forever. Used only when it is a valid pair.
// Returns null when either side is unknown.
export function getTripKm(
  order,
  fallbackPickup = null,
  pickupOverride = null
) {
  if (!order) return null;

  const fbLat = Number(fallbackPickup?.latitude);
  const fbLng = Number(fallbackPickup?.longitude);
  const hasFallback =
    Number.isFinite(fbLat) && fbLat !== 0 &&
    Number.isFinite(fbLng) && fbLng !== 0;

  const ovLat = Number(pickupOverride?.latitude);
  const ovLng = Number(pickupOverride?.longitude);
  const hasOverride =
    Number.isFinite(ovLat) && ovLat !== 0 &&
    Number.isFinite(ovLng) && ovLng !== 0;

  const farmerLat = firstCoord(
    hasOverride ? ovLat : null,
    // Farm anchor written on the order at checkout — the exact
    // pickup point the consumer was quoted at checkout, kept so
    // delivery/farmer dashboards measure from the FARM, not from
    // wherever the farmer happened to accept the order.
    order.farmLocation?.latitude,
    order.farmLocation?.lat,
    order.farmAnchor?.latitude,
    order.farmAnchor?.lat,
    order.farmPickup?.latitude,
    order.farmPickup?.lat,
    order.farmerLatitude,
    order.farmerLat,
    order.farmerLocation?.latitude,
    order.farmerLocation?.lat,
    order.farmer?.latitude,
    order.farmer?.lat,
    order.pickupLatitude,
    order.pickupLat,
    hasFallback ? fbLat : null
  );
  const farmerLng = firstCoord(
    hasOverride ? ovLng : null,
    order.farmLocation?.longitude,
    order.farmLocation?.lng,
    order.farmAnchor?.longitude,
    order.farmAnchor?.lng,
    order.farmPickup?.longitude,
    order.farmPickup?.lng,
    order.farmerLongitude,
    order.farmerLng,
    order.farmerLocation?.longitude,
    order.farmerLocation?.lng,
    order.farmer?.longitude,
    order.farmer?.lng,
    order.pickupLongitude,
    order.pickupLng,
    hasFallback ? fbLng : null
  );
  const consumerLat = firstCoord(
    order.consumerLatitude,
    order.consumerLat,
    order.location?.latitude,
    order.location?.lat,
    order.customerLatitude,
    order.customerLat,
    order.consumer?.latitude,
    order.customer?.latitude
  );
  const consumerLng = firstCoord(
    order.consumerLongitude,
    order.consumerLng,
    order.location?.longitude,
    order.location?.lng,
    order.customerLongitude,
    order.customerLng,
    order.consumer?.longitude,
    order.customer?.longitude
  );

  if (farmerLat == null || farmerLng == null) return null;
  if (consumerLat == null || consumerLng == null) return null;

  return haversineKm(farmerLat, farmerLng, consumerLat, consumerLng);
}

// Full, human-readable earnings breakdown for one order.
export function calcDeliveryEarnings(order, opts = {}) {
  const orderValue = getOrderValue(order);
  const km = getTripKm(order, null, opts?.pickupOverride ?? null);
  const deliveryCharge = calcDeliveryCharge(km);
  const commission = calcCommission(orderValue);
  const totalEarning = round2(deliveryCharge + commission);

  return {
    orderValue: round2(orderValue),
    distanceKm: km,
    deliveryCharge,
    commission,
    totalEarning,
    /* What the farmer keeps after paying the delivery
       commission out of the sale.                            */
    farmerPayout: round2(Math.max(0, orderValue - commission)),
    breakdown:
      `${rupee(deliveryCharge)} delivery charge (from consumer) + ` +
      `${rupee(commission)} farmer commission ` +
      `(${DELIVERY_RATES.COMMISSION_PCT}% of ${rupee(orderValue)})`,
  };
}
