const assert = require('node:assert/strict');
const {
  REGION_SCOPE,
  classifyRegionScope,
  isValidCoordinate,
  projectKoreaMapPoint,
} = require('../../static/js/scope.js');

assert.equal(classifyRegionScope(37.5665, 126.9780), REGION_SCOPE.DOMESTIC);
assert.equal(classifyRegionScope(35.1796, 129.0756), REGION_SCOPE.DOMESTIC);
assert.equal(classifyRegionScope(33.4996, 126.5312), REGION_SCOPE.DOMESTIC);
assert.equal(classifyRegionScope(35.6895, 139.6917), REGION_SCOPE.INTERNATIONAL);
assert.equal(classifyRegionScope(48.8566, 2.3522), REGION_SCOPE.INTERNATIONAL);
assert.equal(classifyRegionScope(0, 0), REGION_SCOPE.INTERNATIONAL);
assert.equal(classifyRegionScope('37.5665', '126.978'), REGION_SCOPE.DOMESTIC);
assert.equal(classifyRegionScope(null, 126.978), REGION_SCOPE.UNKNOWN);
assert.equal(classifyRegionScope(Number.NaN, 126.978), REGION_SCOPE.UNKNOWN);
assert.equal(classifyRegionScope(91, 126.978), REGION_SCOPE.UNKNOWN);
assert.equal(classifyRegionScope(37.5665, 181), REGION_SCOPE.UNKNOWN);
assert.equal(isValidCoordinate(0, 0), true);

for (const [name, lat, lng] of [
  ['Seoul', 37.5665, 126.9780],
  ['Busan', 35.1796, 129.0756],
  ['Jeju', 33.4996, 126.5312],
]) {
  const point = projectKoreaMapPoint(lat, lng);
  assert.ok(point, `${name} should project inside Korea map`);
  assert.ok(point.x >= 0 && point.x <= 360, `${name} x out of bounds: ${point.x}`);
  assert.ok(point.y >= 0 && point.y <= 520, `${name} y out of bounds: ${point.y}`);
}

assert.equal(projectKoreaMapPoint(35.6895, 139.6917), null);
