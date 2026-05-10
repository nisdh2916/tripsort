async function extractPhotoMetadata(file) {
  try {
    const tags = await exifr.parse(file, {
      gps: true,
      tiff: true,
      exif: true,
      ifd0: true,
    });

    const resolvedDate = resolveCaptureDate(file, tags);
    if (!tags) return fallbackPhotoMetadata(resolvedDate);

    const lat = tags.latitude ?? tags.GPSLatitude ?? null;
    const lng = tags.longitude ?? tags.GPSLongitude ?? null;
    const hasGps = lat != null && lng != null;

    return {
      lat: hasGps ? parseFloat(lat) : null,
      lng: hasGps ? parseFloat(lng) : null,
      hasGps,
      date: resolvedDate.displayDate,
      captureDate: resolvedDate.folderDate,
      dateSource: resolvedDate.source,
    };
  } catch (e) {
    console.warn('EXIF 파싱 실패:', e);
    return fallbackPhotoMetadata(resolveCaptureDate(file, null));
  }
}

async function extractExif(file) {
  const metadata = await extractPhotoMetadata(file);
  if (!metadata?.hasGps) return null;
  return {
    lat: metadata.lat,
    lng: metadata.lng,
    date: metadata.date,
    captureDate: metadata.captureDate,
    dateSource: metadata.dateSource,
  };
}

function fallbackPhotoMetadata(resolvedDate) {
  return {
    lat: null,
    lng: null,
    hasGps: false,
    date: resolvedDate.displayDate,
    captureDate: resolvedDate.folderDate,
    dateSource: resolvedDate.source,
  };
}

function resolveCaptureDate(file, tags) {
  const exifDate = tags?.DateTimeOriginal ?? tags?.DateTime ?? null;
  const parsedExif = parseCaptureDate(exifDate);
  if (parsedExif) {
    return {
      source: 'exif',
      displayDate: formatDate(parsedExif),
      folderDate: formatDateFolder(parsedExif),
    };
  }

  const parsedModified = parseCaptureDate(file?.lastModified != null ? new Date(file.lastModified) : null);
  if (parsedModified) {
    return {
      source: 'fileModified',
      displayDate: formatDate(parsedModified),
      folderDate: formatDateFolder(parsedModified),
    };
  }

  return {
    source: 'unknown',
    displayDate: null,
    folderDate: 'Unknown Date',
  };
}

function parseCaptureDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function formatDateFolder(d) {
  const date = parseCaptureDate(d);
  if (!date) return 'Unknown Date';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(d) {
  const date = parseCaptureDate(d);
  if (!date) return String(d);
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}
