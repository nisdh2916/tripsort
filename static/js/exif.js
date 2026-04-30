async function extractExif(file) {
  try {
    const tags = await exifr.parse(file, {
      gps: true,
      tiff: true,
      exif: true,
      ifd0: true,
    });

    if (!tags) return null;

    const lat = tags.latitude ?? tags.GPSLatitude ?? null;
    const lng = tags.longitude ?? tags.GPSLongitude ?? null;

    if (lat == null || lng == null) return null;

    const date = tags.DateTimeOriginal ?? tags.DateTime ?? null;

    return {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      date: date ? formatDate(date) : null,
    };
  } catch (e) {
    console.warn('EXIF 파싱 실패:', e);
    return null;
  }
}

function formatDate(d) {
  if (d instanceof Date) {
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  // "2024:07:15 14:30:00" 형식
  if (typeof d === 'string') {
    const parts = d.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
    const parsed = new Date(parts);
    if (!isNaN(parsed)) {
      return parsed.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    }
  }
  return String(d);
}
