const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '..', '..', 'static', 'js', 'exif.js'), 'utf8');
const context = {
  console,
  Date,
  Intl,
  exifr: { parse: async () => null },
};
vm.createContext(context);
vm.runInContext(code, context);

const { resolveCaptureDate, formatDateFolder } = context;

assert.equal(
  resolveCaptureDate(
    { lastModified: Date.UTC(2026, 4, 10) },
    { DateTimeOriginal: '2024:07:15 14:30:00' },
  ).folderDate,
  '2024-07-15',
);
assert.equal(
  resolveCaptureDate(
    { lastModified: Date.UTC(2026, 4, 10) },
    { DateTimeOriginal: '2024:07:15 14:30:00' },
  ).source,
  'exif',
);

const modified = resolveCaptureDate({ lastModified: Date.UTC(2026, 4, 10) }, {});
assert.equal(modified.folderDate, '2026-05-10');
assert.equal(modified.source, 'fileModified');

const invalidExif = resolveCaptureDate(
  { lastModified: Date.UTC(2026, 4, 11) },
  { DateTimeOriginal: 'not a date' },
);
assert.equal(invalidExif.folderDate, '2026-05-11');
assert.equal(invalidExif.source, 'fileModified');

const unknown = resolveCaptureDate({ lastModified: Number.NaN }, { DateTimeOriginal: 'bad' });
assert.equal(unknown.folderDate, 'Unknown Date');
assert.equal(unknown.source, 'unknown');
assert.equal(formatDateFolder('bad'), 'Unknown Date');
