const REGION_SCOPE = {
  DOMESTIC: 'domestic',
  INTERNATIONAL: 'international',
  UNKNOWN: 'unknown',
};

const KOREA_BOUNDS = {
  minLat: 33.0,
  maxLat: 38.7,
  minLng: 124.5,
  maxLng: 132.0,
};
const KOREA_MAP_VIEWBOX = {
  width: 360,
  height: 520,
  paddingX: 30,
  paddingY: 45,
};

function isValidCoordinate(lat, lng) {
  return Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180;
}

function classifyRegionScope(lat, lng) {
  const numericLat = typeof lat === 'string' ? Number(lat) : lat;
  const numericLng = typeof lng === 'string' ? Number(lng) : lng;
  if (!isValidCoordinate(numericLat, numericLng)) return REGION_SCOPE.UNKNOWN;

  const inKorea = numericLat >= KOREA_BOUNDS.minLat &&
    numericLat <= KOREA_BOUNDS.maxLat &&
    numericLng >= KOREA_BOUNDS.minLng &&
    numericLng <= KOREA_BOUNDS.maxLng;

  return inKorea ? REGION_SCOPE.DOMESTIC : REGION_SCOPE.INTERNATIONAL;
}

function projectKoreaMapPoint(lat, lng) {
  const numericLat = typeof lat === 'string' ? Number(lat) : lat;
  const numericLng = typeof lng === 'string' ? Number(lng) : lng;
  if (classifyRegionScope(numericLat, numericLng) !== REGION_SCOPE.DOMESTIC) return null;

  const mapWidth = KOREA_MAP_VIEWBOX.width - KOREA_MAP_VIEWBOX.paddingX * 2;
  const mapHeight = KOREA_MAP_VIEWBOX.height - KOREA_MAP_VIEWBOX.paddingY * 2;
  return {
    x: ((numericLng - KOREA_BOUNDS.minLng) / (KOREA_BOUNDS.maxLng - KOREA_BOUNDS.minLng)) * mapWidth + KOREA_MAP_VIEWBOX.paddingX,
    y: ((KOREA_BOUNDS.maxLat - numericLat) / (KOREA_BOUNDS.maxLat - KOREA_BOUNDS.minLat)) * mapHeight + KOREA_MAP_VIEWBOX.paddingY,
  };
}

if (typeof window !== 'undefined') {
  window.REGION_SCOPE = REGION_SCOPE;
  window.classifyRegionScope = classifyRegionScope;
  window.projectKoreaMapPoint = projectKoreaMapPoint;
}

if (typeof module !== 'undefined') {
  module.exports = { REGION_SCOPE, classifyRegionScope, isValidCoordinate, projectKoreaMapPoint };
}
