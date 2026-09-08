/**
 * Geo Utilities for Geo-Tagged Attendance System
 * High-precision Haversine formula and geofence verification
 */

const EARTH_RADIUS_METERS = 6371000; // Mean Earth radius in meters

/**
 * Convert degrees to radians
 */
function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculates the great-circle distance between two geographic coordinates using the Haversine formula.
 * @param {number} lat1 Latitude of point 1 in degrees
 * @param {number} lon1 Longitude of point 1 in degrees
 * @param {number} lat2 Latitude of point 2 in degrees
 * @param {number} lon2 Longitude of point 2 in degrees
 * @returns {number} Distance in meters (rounded to 1 decimal place)
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) {
    return 0;
  }

  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lon2 - lon1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distanceMeters = EARTH_RADIUS_METERS * c;
  return Math.round(distanceMeters * 10) / 10;
}

/**
 * Verify whether an attendee's coordinates fall within the event's geofence boundary
 * @param {number} attendeeLat 
 * @param {number} attendeeLng 
 * @param {number} venueLat 
 * @param {number} venueLng 
 * @param {number} radiusMeters 
 * @returns {{ isWithin: boolean, distanceMeters: number, breachMeters: number }}
 */
function verifyGeofence(attendeeLat, attendeeLng, venueLat, venueLng, radiusMeters) {
  const distance = calculateDistance(attendeeLat, attendeeLng, venueLat, venueLng);
  const isWithin = distance <= radiusMeters;
  const breachMeters = isWithin ? 0 : Math.round((distance - radiusMeters) * 10) / 10;

  return {
    isWithin,
    distanceMeters: distance,
    breachMeters
  };
}

module.exports = {
  calculateDistance,
  verifyGeofence,
  EARTH_RADIUS_METERS
};
