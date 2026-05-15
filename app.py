import os
import json
import uuid
import base64
import hashlib
import io
import re
import shutil
import zipfile
import requests
from datetime import datetime, timezone
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename

def load_dotenv_file(path='.env', environ=None):
    environ = environ if environ is not None else os.environ
    if not os.path.exists(path):
        return False

    with open(path, 'r', encoding='utf-8') as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith('export '):
                line = line[len('export '):].strip()
            if '=' not in line:
                continue

            key, value = line.split('=', 1)
            key = key.strip().lstrip('\ufeff')
            value = value.strip()
            if not key or key in environ:
                continue
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            environ[key] = value

    return True


load_dotenv_file()

app = Flask(__name__, static_folder='static')
DEFAULT_CORS_ORIGINS = 'http://localhost:5000,http://127.0.0.1:5000'

def parse_cors_origins(value=None):
    origins = value if value is not None else os.getenv('PINDROP_CORS_ORIGINS', DEFAULT_CORS_ORIGINS)
    return [origin.strip() for origin in origins.split(',') if origin.strip()]

def server_config_from_env(env=None):
    if env is None:
        env = os.environ
    return {
        'host': env.get('PINDROP_HOST', '127.0.0.1'),
        'debug': env.get('PINDROP_DEBUG') == '1',
        'port': int(env.get('PINDROP_PORT', '5000')),
    }

def map_config_from_env(env=None):
    if env is None:
        env = os.environ
    provider = env.get('PINDROP_MAP_PROVIDER', '').strip().lower()
    maptiler_key = env.get('PINDROP_MAPTILER_KEY', '').strip()

    if provider in ('', 'maptiler') and maptiler_key:
        style_url = env.get(
            'PINDROP_MAP_STYLE_URL',
            f'https://api.maptiler.com/maps/streets-v2/style.json?key={maptiler_key}',
        )
        return {
            'enabled': True,
            'provider': 'maptiler',
            'apiKey': maptiler_key,
            'styleUrl': style_url,
        }

    return {
        'enabled': False,
        'provider': 'none',
        'apiKey': '',
        'styleUrl': '',
    }

CORS_ORIGINS = parse_cors_origins()
CORS(app, origins=CORS_ORIGINS)

UPLOAD_FOLDER  = os.getenv('PINDROP_UPLOAD_FOLDER', 'uploads')
PINS_FILE      = os.getenv('PINDROP_PINS_FILE', 'pins.json')
ALLOWED_EXT    = {'jpg', 'jpeg', 'png', 'heic', 'webp'}
ALLOWED_TAGS   = {'음식', '풍경', '인물', '건축', '자연', '도시', '교통', '동물', '실내', '야경'}
BROAD_CONTEXT_TAGS = {'풍경', '자연', '도시', '야경'}
TAG_CACHE      = {}
MAX_MB         = 30
OLLAMA_BASE    = 'http://localhost:11434'
OLLAMA_URL     = f'{OLLAMA_BASE}/api/chat'
OLLAMA_MODEL   = 'llama3.2-vision'
RERANK_MODEL   = 'llama3.2'
REQUIRED_MODELS = {
    'vision': OLLAMA_MODEL,
    'rerank': RERANK_MODEL,
}
TOP_K          = 10
RERANK_K       = 5
PIN_DEFAULTS   = {
    'regionScope': 'unknown',
    'transportMode': 'unknown',
}
SOURCE_PHOTO_DEFAULTS = {
    'originalFilename': '',
    'storedFilename': '',
    'mimeType': '',
    'fileSize': None,
    'importedAt': '',
}
ORGANIZATION_DEFAULTS = {
    'candidateCaptureDate': '',
    'candidatePlace': '',
    'confidence': 'unknown',
    'reason': '',
    'status': 'pending',
    'outputPath': '',
}
WINDOWS_RESERVED_NAMES = {
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
}
WINDOWS_INVALID_PATH_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
KNOWN_CAPTURE_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
DEFAULT_TRIP_KEY = '__default_trip__'
TRIP_SPLIT_GAP_DAYS = 3
TRIP_SPLIT_SCORE_THRESHOLD = 4
DATE_GAP_SPLIT_SCORE = 4
COUNTRY_CHANGE_SPLIT_SCORE = 5
CITY_CHANGE_SPLIT_SCORE = 3
SAME_LOCATION_KEEP_SCORE = 4
TRIP_SIGNAL_CONFIDENCE_VALUES = {'high', 'medium'}
TRANSPORT_MODES = {
    'unknown',
    'bus',
    'ktx',
    'srt',
    'rail',
    'subway',
    'car',
    'ferry',
    'airplane',
}

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

class JsonObjectBodyRequired(Exception):
    pass

@app.errorhandler(JsonObjectBodyRequired)
def handle_json_object_body_required(_error):
    return jsonify({'error': 'JSON object body required'}), 400

# ── ChromaDB + CLIP (lazy init) ───────────────────────────
_chroma_client     = None
_chroma_collection = None
_clip_model        = None

def get_clip():
    global _clip_model
    if _clip_model is None:
        from sentence_transformers import SentenceTransformer
        _clip_model = SentenceTransformer('clip-ViT-B-32')
    return _clip_model

def get_collection():
    global _chroma_client, _chroma_collection
    if _chroma_collection is None:
        import chromadb
        _chroma_client     = chromadb.PersistentClient(path='./chroma_db')
        _chroma_collection = _chroma_client.get_or_create_collection(
            name='pindrop',
            metadata={'hnsw:space': 'cosine'},
        )
    return _chroma_collection

# ── helpers ──────────────────────────────────────────────
def allowed(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXT

def utc_now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

def non_empty(value):
    return value is not None and value != ''

def normalize_file_size(value):
    if value in (None, '') or isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None

def normalize_source_photo(pin):
    source = pin.get('sourcePhoto') if isinstance(pin.get('sourcePhoto'), dict) else {}
    stored_filename = (
        source.get('storedFilename')
        or pin.get('storedFilename')
        or pin.get('filename')
        or SOURCE_PHOTO_DEFAULTS['storedFilename']
    )
    return {
        'originalFilename': (
            source.get('originalFilename')
            or pin.get('originalFilename')
            or pin.get('clientFilename')
            or stored_filename
            or SOURCE_PHOTO_DEFAULTS['originalFilename']
        ),
        'storedFilename': stored_filename,
        'mimeType': (
            source.get('mimeType')
            or pin.get('mimeType')
            or SOURCE_PHOTO_DEFAULTS['mimeType']
        ),
        'fileSize': normalize_file_size(source.get('fileSize', pin.get('fileSize'))),
        'importedAt': (
            source.get('importedAt')
            or pin.get('importedAt')
            or pin.get('uploadedAt')
            or SOURCE_PHOTO_DEFAULTS['importedAt']
        ),
    }

def organization_reason(pin, candidate_place):
    org = pin.get('organization') if isinstance(pin.get('organization'), dict) else {}
    reason = org.get('reason') or pin.get('organizationReason') or pin.get('placeReason')
    if reason:
        return reason
    if candidate_place and pin.get('lat') is not None and pin.get('lng') is not None:
        return 'Place candidate came from GPS reverse geocoding.'
    if candidate_place:
        return 'Place candidate came from existing photo metadata.'
    return 'Place has not been resolved yet.'

def normalize_organization(pin):
    org = pin.get('organization') if isinstance(pin.get('organization'), dict) else {}
    candidate_capture_date = (
        org.get('candidateCaptureDate')
        or pin.get('candidateCaptureDate')
        or pin.get('date')
        or ORGANIZATION_DEFAULTS['candidateCaptureDate']
    )
    candidate_place = (
        org.get('candidatePlace')
        or pin.get('candidatePlace')
        or pin.get('place')
        or ORGANIZATION_DEFAULTS['candidatePlace']
    )
    normalized = {
        'candidateCaptureDate': candidate_capture_date,
        'candidatePlace': candidate_place,
        'confidence': (
            org.get('confidence')
            or pin.get('organizationConfidence')
            or pin.get('placeConfidence')
            or ORGANIZATION_DEFAULTS['confidence']
        ),
        'reason': organization_reason(pin, candidate_place),
        'status': (
            org.get('status')
            or pin.get('organizationStatus')
            or ORGANIZATION_DEFAULTS['status']
        ),
        'outputPath': (
            org.get('outputPath')
            or pin.get('outputPath')
            or ORGANIZATION_DEFAULTS['outputPath']
        ),
    }
    candidate_filename = org.get('candidateFilename') or pin.get('candidateFilename')
    if candidate_filename:
        normalized['candidateFilename'] = candidate_filename
    trip_id = org.get('tripId') or pin.get('tripId')
    if trip_id:
        normalized['tripId'] = str(trip_id)
    trip_name = org.get('tripName') or pin.get('tripName')
    if trip_name:
        normalized['tripName'] = str(trip_name)
    trip_group_id = org.get('tripGroupId') or pin.get('tripGroupId')
    if trip_group_id:
        normalized['tripGroupId'] = str(trip_group_id)
    trip_signals = normalize_trip_signals(org.get('tripSignals') or pin.get('tripSignals'))
    if trip_signals:
        normalized['tripSignals'] = trip_signals
    return normalized

def normalize_pin(pin):
    normalized = dict(pin)
    for key, value in PIN_DEFAULTS.items():
        if normalized.get(key) in (None, ''):
            normalized[key] = value
    if normalized.get('transportMode') not in TRANSPORT_MODES:
        normalized['transportMode'] = PIN_DEFAULTS['transportMode']
    normalized['sourcePhoto'] = normalize_source_photo(normalized)
    if not normalized.get('filename') and normalized['sourcePhoto']['storedFilename']:
        normalized['filename'] = normalized['sourcePhoto']['storedFilename']
    normalized['organization'] = normalize_organization(normalized)
    if not non_empty(normalized.get('date')) and normalized['organization']['candidateCaptureDate']:
        normalized['date'] = normalized['organization']['candidateCaptureDate']
    if not non_empty(normalized.get('place')) and normalized['organization']['candidatePlace']:
        normalized['place'] = normalized['organization']['candidatePlace']
    return normalized

def safe_path_segment(value, fallback):
    text = str(value if value is not None else '').strip()
    text = text.replace('..', '_')
    text = WINDOWS_INVALID_PATH_CHARS_RE.sub('_', text)
    text = re.sub(r'\s+', ' ', text)
    text = re.sub(r'_+', '_', text).strip(' ._')
    if not text or text in ('.', '..'):
        text = fallback
    if text.upper() in WINDOWS_RESERVED_NAMES:
        text = f'_{text}'
    return text

def safe_output_filename(value, fallback='photo'):
    safe_name = safe_path_segment(value, fallback)
    stem, ext = os.path.splitext(safe_name)
    stem = safe_path_segment(stem or fallback, fallback)
    ext = WINDOWS_INVALID_PATH_CHARS_RE.sub('_', ext)
    ext = re.sub(r'_+', '_', ext).strip(' ._')
    return f'{stem}.{ext.lower()}' if ext else stem

def organization_folder_name(capture_date, place):
    safe_date = safe_path_segment(capture_date or 'Unknown Date', 'Unknown Date')
    safe_place = safe_path_segment(place or 'Unknown Location', 'Unknown Location')
    return f'{safe_date}_{safe_place}'

def organization_capture_date(pin):
    organization = pin.get('organization') if isinstance(pin.get('organization'), dict) else {}
    return organization.get('candidateCaptureDate') or pin.get('date') or 'Unknown Date'

def organization_place(pin):
    organization = pin.get('organization') if isinstance(pin.get('organization'), dict) else {}
    return organization.get('candidatePlace') or pin.get('place') or 'Unknown Location'

def organization_trip_key(pin):
    organization = pin.get('organization') if isinstance(pin.get('organization'), dict) else {}
    return organization.get('tripId') or pin.get('tripId') or DEFAULT_TRIP_KEY

def organization_trip_group_id(pin):
    organization = pin.get('organization') if isinstance(pin.get('organization'), dict) else {}
    return organization.get('tripGroupId') or pin.get('tripGroupId') or ''

def organization_trip_name(pin):
    organization = pin.get('organization') if isinstance(pin.get('organization'), dict) else {}
    return organization.get('tripName') or pin.get('tripName') or ''

def normalize_trip_signals(value):
    if not isinstance(value, dict):
        return {}
    normalized = {}
    for key in ['city', 'country', 'landmark', 'sceneType', 'confidence', 'reason', 'source']:
        raw = value.get(key)
        if raw is None:
            continue
        text = str(raw).strip()
        if text:
            normalized[key] = text
    return normalized

def organization_trip_signals(pin):
    organization = pin.get('organization') if isinstance(pin.get('organization'), dict) else {}
    return normalize_trip_signals(organization.get('tripSignals') or pin.get('tripSignals'))

def accepted_trip_signal(signals):
    confidence = str(signals.get('confidence', '')).strip().lower()
    return confidence in TRIP_SIGNAL_CONFIDENCE_VALUES

def comparable_signal(value):
    return str(value or '').strip().casefold()

def known_capture_date_value(pin):
    capture_date = organization_capture_date(pin)
    if not isinstance(capture_date, str) or not KNOWN_CAPTURE_DATE_RE.match(capture_date):
        return None
    return datetime.strptime(capture_date, '%Y-%m-%d').date()

def trip_date_range(pins):
    dates = sorted({
        capture_date
        for capture_date in (organization_capture_date(pin) for pin in pins)
        if isinstance(capture_date, str) and KNOWN_CAPTURE_DATE_RE.match(capture_date)
    })
    if not dates:
        return 'Unknown Date'
    if dates[0] == dates[-1]:
        return dates[0]
    return f'{dates[0]}_to_{dates[-1]}'

def trip_place_name(pins):
    counts = {}
    first_seen = {}
    for index, pin in enumerate(pins):
        place = organization_place(pin)
        if not place or place in {'Unknown Location', 'GPS 없음'}:
            continue
        safe_place = safe_path_segment(place, 'Unknown Location')
        if safe_place == 'Unknown Location':
            continue
        counts[safe_place] = counts.get(safe_place, 0) + 1
        first_seen.setdefault(safe_place, index)
    if not counts:
        return 'Unknown Location'
    return min(counts, key=lambda place: (-counts[place], first_seen[place]))

def trip_folder_name(pins):
    for pin in pins:
        trip_name = safe_path_segment(organization_trip_name(pin), '')
        if trip_name:
            return trip_name
    return safe_path_segment(
        f'Trip_{trip_date_range(pins)}_{trip_place_name(pins)}',
        'Trip_Unknown Date_Unknown Location',
    )

def split_trip_group(indexed_pins):
    known_pins = [
        (index, pin, capture_date)
        for index, pin in indexed_pins
        for capture_date in [known_capture_date_value(pin)]
        if capture_date is not None
    ]
    if not known_pins:
        return [indexed_pins]

    segments = []
    current_segment = []
    for index, pin, capture_date in sorted(known_pins, key=lambda item: (item[2], item[0])):
        if current_segment and should_start_new_trip_segment(current_segment[-1][1], pin):
            segments.append(current_segment)
            current_segment = []
        current_segment.append((index, pin))
    if current_segment:
        segments.append(current_segment)

    unknown_pins = [
        (index, pin)
        for index, pin in indexed_pins
        if known_capture_date_value(pin) is None
    ]
    if unknown_pins:
        segments[0].extend(unknown_pins)

    return [
        sorted(segment, key=lambda item: item[0])
        for segment in segments
    ]

def should_start_new_trip_segment(previous_pin, current_pin):
    previous_date = known_capture_date_value(previous_pin)
    current_date = known_capture_date_value(current_pin)
    score = 0
    if (
        previous_date is not None
        and current_date is not None
        and (current_date - previous_date).days > TRIP_SPLIT_GAP_DAYS
    ):
        score += DATE_GAP_SPLIT_SCORE

    previous_signals = organization_trip_signals(previous_pin)
    current_signals = organization_trip_signals(current_pin)
    if accepted_trip_signal(previous_signals) and accepted_trip_signal(current_signals):
        previous_country = comparable_signal(previous_signals.get('country'))
        current_country = comparable_signal(current_signals.get('country'))
        previous_city = comparable_signal(previous_signals.get('city'))
        current_city = comparable_signal(current_signals.get('city'))
        if previous_country and current_country and previous_country != current_country:
            score += COUNTRY_CHANGE_SPLIT_SCORE
        elif previous_city and current_city and previous_city != current_city:
            score += CITY_CHANGE_SPLIT_SCORE
        if (
            previous_country
            and current_country
            and previous_country == current_country
            and previous_city
            and current_city
            and previous_city == current_city
        ):
            score -= SAME_LOCATION_KEEP_SCORE

    return score >= TRIP_SPLIT_SCORE_THRESHOLD

def unique_output_filename(filename, used_names):
    stem, ext = os.path.splitext(filename)
    candidate = filename
    suffix = 2
    while candidate.casefold() in used_names:
        candidate = f'{stem}-{suffix}{ext}'
        suffix += 1
    used_names.add(candidate.casefold())
    return candidate

def output_path_for_pin(pin, used_by_folder=None, trip_folder=None):
    organization = pin.get('organization') if isinstance(pin.get('organization'), dict) else {}
    source_photo = pin.get('sourcePhoto') if isinstance(pin.get('sourcePhoto'), dict) else {}
    detail_folder = organization_folder_name(
        organization_capture_date(pin),
        organization_place(pin),
    )
    folder = f'{trip_folder}/{detail_folder}' if trip_folder else detail_folder
    filename = safe_output_filename(
        organization.get('candidateFilename')
        or source_photo.get('originalFilename')
        or pin.get('filename')
        or f"photo-{pin.get('id', 'unknown')}",
    )
    if used_by_folder is not None:
        used_names = used_by_folder.setdefault(folder.casefold(), set())
        filename = unique_output_filename(filename, used_names)
    return f'{folder}/{filename}'

def build_output_paths(pins):
    manual_groups = {}
    auto_groups = {}
    for index, pin in enumerate(pins):
        manual_group_id = organization_trip_group_id(pin)
        if manual_group_id:
            manual_groups.setdefault(manual_group_id, []).append((index, pin))
        else:
            key = organization_trip_key(pin)
            auto_groups.setdefault(key, []).append((index, pin))
    trip_folders_by_index = {}
    for group_pins in manual_groups.values():
        folder_name = trip_folder_name([pin for _index, pin in group_pins])
        for index, _pin in group_pins:
            trip_folders_by_index[index] = folder_name
    for group_pins in auto_groups.values():
        for segment in split_trip_group(group_pins):
            folder_name = trip_folder_name([pin for _index, pin in segment])
            for index, _pin in segment:
                trip_folders_by_index[index] = folder_name
    used_by_folder = {}
    return [
        {
            'id': pin.get('id'),
            'outputPath': output_path_for_pin(
                pin,
                used_by_folder,
                trip_folders_by_index[index],
            ),
        }
        for index, pin in enumerate(pins)
    ]

def attach_output_paths(pins):
    normalized = [normalize_pin(pin) for pin in pins]
    output_paths = build_output_paths(normalized)
    for pin, item in zip(normalized, output_paths):
        organization = dict(pin.get('organization') or {})
        organization['outputPath'] = item['outputPath']
        pin['organization'] = organization
    return normalized

def stored_upload_filename(pin):
    source_photo = pin.get('sourcePhoto') if isinstance(pin.get('sourcePhoto'), dict) else {}
    return source_photo.get('storedFilename') or pin.get('filename') or ''

def export_manifest_item(pin):
    organization = pin.get('organization') if isinstance(pin.get('organization'), dict) else {}
    source_photo = pin.get('sourcePhoto') if isinstance(pin.get('sourcePhoto'), dict) else {}
    stored_filename = stored_upload_filename(pin)
    return {
        'id': pin.get('id'),
        'originalFilename': source_photo.get('originalFilename') or pin.get('filename') or '',
        'storedFilename': stored_filename,
        'outputPath': organization.get('outputPath') or output_path_for_pin(pin),
        'date': organization.get('candidateCaptureDate') or pin.get('date') or 'Unknown Date',
        'place': organization.get('candidatePlace') or pin.get('place') or 'Unknown Location',
        'confidence': organization.get('confidence') or 'unknown',
        'reason': organization.get('reason') or '',
    }

def organization_export_entries(pins):
    entries = []
    missing = []
    for pin in attach_output_paths(pins):
        organization = pin.get('organization') if isinstance(pin.get('organization'), dict) else {}
        output_path = organization.get('outputPath') or output_path_for_pin(pin)
        stored_filename = stored_upload_filename(pin)
        safe_stored_filename = secure_filename(stored_filename)
        if not safe_stored_filename:
            missing.append({
                'id': pin.get('id'),
                'outputPath': output_path,
                'reason': 'stored filename is missing',
            })
            continue

        source_path = os.path.join(UPLOAD_FOLDER, safe_stored_filename)
        if not os.path.isfile(source_path):
            missing.append({
                'id': pin.get('id'),
                'storedFilename': stored_filename,
                'outputPath': output_path,
                'reason': 'stored upload is missing',
            })
            continue

        entries.append({
            'pin': pin,
            'sourcePath': source_path,
            'outputPath': output_path,
        })
    return entries, missing

def build_organization_zip(pins):
    entries, missing = organization_export_entries(pins)
    if missing:
        return None, missing

    archive = io.BytesIO()
    manifest = []
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        for entry in entries:
            with open(entry['sourcePath'], 'rb') as f:
                zf.writestr(entry['outputPath'], f.read())
            manifest.append(export_manifest_item(entry['pin']))
        zf.writestr(
            'manifest.json',
            json.dumps({'photos': manifest}, ensure_ascii=False, indent=2),
        )
    archive.seek(0)
    return archive, []

def has_model(models, model):
    return model in models or f'{model}:latest' in models

def json_dict():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise JsonObjectBodyRequired()
    return data

def parse_tag_content(content):
    s = content.find('[')
    e = content.rfind(']') + 1
    if s == -1 or e <= s:
        return []
    tags = json.loads(content[s:e])
    if not isinstance(tags, list):
        return []
    return normalize_tags(tags)

def normalize_tags(tags):
    unique = []
    seen = set()
    for tag in tags:
        if not isinstance(tag, str) or tag not in ALLOWED_TAGS or tag in seen:
            continue
        unique.append(tag)
        seen.add(tag)

    if '인물' in seen:
        unique = [tag for tag in unique if tag not in BROAD_CONTEXT_TAGS]
        if '인물' not in unique:
            unique.insert(0, '인물')

    return unique[:2]

def file_sha256(filepath):
    digest = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

def parse_place_inference_content(content):
    s = content.find('{')
    e = content.rfind('}') + 1
    if s == -1 or e <= s:
        return {
            'place': 'Unknown Location',
            'confidence': 'low',
            'reason': 'Vision response did not include structured place data.',
        }
    try:
        data = json.loads(content[s:e])
    except json.JSONDecodeError:
        return {
            'place': 'Unknown Location',
            'confidence': 'low',
            'reason': 'Vision response JSON could not be parsed.',
        }
    if not isinstance(data, dict):
        return {
            'place': 'Unknown Location',
            'confidence': 'low',
            'reason': 'Vision response was not an object.',
        }
    place = data.get('place') or data.get('inferredPlace') or 'Unknown Location'
    confidence = data.get('confidence') or 'unknown'
    reason = data.get('reason') or 'No reason returned by vision model.'
    city = str(data.get('city') or '').strip()
    country = str(data.get('country') or '').strip()
    landmark = str(data.get('landmark') or '').strip()
    scene_type = str(data.get('sceneType') or data.get('scene_type') or '').strip()
    cleaned_confidence = str(confidence).strip() or 'unknown'
    cleaned_reason = str(reason).strip() or 'No reason returned by vision model.'
    trip_signals = normalize_trip_signals({
        'city': city,
        'country': country,
        'landmark': landmark,
        'sceneType': scene_type,
        'confidence': cleaned_confidence,
        'reason': cleaned_reason,
        'source': 'vlm',
    })
    return {
        'place': str(place).strip() or 'Unknown Location',
        'city': city,
        'country': country,
        'landmark': landmark,
        'sceneType': scene_type,
        'confidence': cleaned_confidence,
        'reason': cleaned_reason,
        'tripSignals': trip_signals,
    }

def available_ollama_models():
    try:
        r = requests.get(f'{OLLAMA_BASE}/api/tags', timeout=3)
        if not r.ok:
            return []
        return [m['name'] for m in r.json().get('models', [])]
    except Exception:
        return []

def unique_filename(filename):
    stem, ext = filename.rsplit('.', 1) if '.' in filename else (filename, '')
    safe_stem = secure_filename(stem) or 'upload'
    ext = ext.lower()
    while True:
        candidate = f'{safe_stem}-{uuid.uuid4().hex[:8]}.{ext}'
        if not os.path.exists(os.path.join(UPLOAD_FOLDER, candidate)):
            return candidate

def load_pins():
    if not os.path.exists(PINS_FILE):
        return []
    try:
        with open(PINS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, list):
            return []
        valid = [p for p in data if isinstance(p, dict) and 'id' in p]
        return attach_output_paths(valid)
    except Exception:
        return []

def save_pins(pins):
    with open(PINS_FILE, 'w', encoding='utf-8') as f:
        json.dump(attach_output_paths(pins), f, ensure_ascii=False, indent=2)

def delete_upload(filename):
    if not isinstance(filename, str):
        return
    safe = secure_filename(filename)
    if not safe:
        return
    path = os.path.join(UPLOAD_FOLDER, safe)
    if os.path.isfile(path):
        os.remove(path)

def write_move_log(results, log_path):
    if not log_path:
        return
    successful_moves = [
        {
            'sourcePath': result['sourcePath'],
            'destinationPath': result['destinationPath'],
        }
        for result in results
        if result.get('status') == 'success'
    ]
    if not successful_moves:
        return

    log_dir = os.path.dirname(log_path)
    if log_dir:
        os.makedirs(log_dir, exist_ok=True)
    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(json.dumps({
            'movedAt': utc_now_iso(),
            'moves': successful_moves,
        }, ensure_ascii=False) + '\n')

def move_originals(items, confirm=False, log_path=None):
    if not isinstance(items, list):
        return [{'index': 0, 'status': 'unsupported_access', 'reason': 'items must be a list'}]

    results = []
    destination_keys = set()
    has_error = not confirm

    for index, item in enumerate(items):
        if not isinstance(item, dict):
            results.append({'index': index, 'status': 'unsupported_access', 'reason': 'item must be an object'})
            has_error = True
            continue

        source_path = item.get('sourcePath')
        destination_path = item.get('destinationPath')
        if not source_path or not destination_path:
            results.append({'index': index, 'status': 'unsupported_access', 'reason': 'sourcePath and destinationPath are required'})
            has_error = True
            continue

        result = {
            'index': index,
            'sourcePath': source_path,
            'destinationPath': destination_path,
        }
        if not confirm:
            result.update({'status': 'not_confirmed', 'reason': 'explicit confirmation is required'})
            results.append(result)
            continue

        destination_key = os.path.abspath(destination_path).casefold()
        if destination_key in destination_keys or os.path.exists(destination_path):
            result.update({'status': 'duplicate_destination', 'reason': 'destination already exists'})
            has_error = True
        elif not os.path.isfile(source_path):
            result.update({'status': 'missing_source', 'reason': 'source file is missing'})
            has_error = True
        else:
            destination_keys.add(destination_key)
            result.update({'status': 'pending'})
        results.append(result)

    if has_error:
        return [
            {**result, 'status': 'blocked', 'reason': 'another item failed validation'}
            if result.get('status') == 'pending' else result
            for result in results
        ]

    moved = []
    try:
        for result in results:
            shutil.move(result['sourcePath'], result['destinationPath'])
            moved.append(result)
            result['status'] = 'success'
            result.pop('reason', None)
        write_move_log(results, log_path)
        return results
    except Exception as exc:
        for result in results:
            if result in moved:
                continue
            result['status'] = 'blocked'
            result['reason'] = str(exc)
        return results

def build_metadata_text(pin: dict) -> str:
    parts = []
    if pin.get('filename'): parts.append(f"파일: {pin['filename']}")
    if pin.get('place'):  parts.append(f"장소: {pin['place']}")
    if pin.get('date'):   parts.append(f"날짜: {pin['date']}")
    if pin.get('tags'):   parts.append(f"분류: {', '.join(pin['tags'])}")
    if pin.get('regionScope'): parts.append(f"범위: {pin['regionScope']}")
    if pin.get('transportMode'): parts.append(f"이동수단: {pin['transportMode']}")
    if pin.get('caption'): parts.append(pin['caption'])
    if pin.get('lat') is not None and pin.get('lng') is not None:
        parts.append(f"위도 {pin['lat']:.2f} 경도 {pin['lng']:.2f}")
    return '. '.join(parts) if parts else '사진'

# ── routes ───────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


@app.route('/ping', methods=['GET'])
def ping():
    return jsonify({'flask': True})


@app.route('/map-config', methods=['GET'])
def map_config():
    return jsonify(map_config_from_env())


@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

# 서버·Ollama 상태 확인
@app.route('/health', methods=['GET'])
def health():
    ollama_ok = False
    models    = []
    try:
        r = requests.get(f'{OLLAMA_BASE}/api/tags', timeout=3)
        if r.ok:
            ollama_ok = True
            models = [m['name'] for m in r.json().get('models', [])]
    except Exception:
        pass

    try:
        col   = get_collection()
        indexed = col.count()
    except Exception:
        indexed = -1
    required = {
        key: {'name': model, 'available': has_model(models, model)}
        for key, model in REQUIRED_MODELS.items()
    }

    return jsonify({
        'flask':   True,
        'ollama':  ollama_ok,
        'models':  models,
        'required_models': required,
        'indexed': indexed,
    })

# 파일 업로드
@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': '파일이 없습니다'}), 400
    file = request.files['file']
    if not file.filename or not allowed(file.filename):
        return jsonify({'error': '지원하지 않는 파일 형식입니다'}), 400
    file.seek(0, 2)
    size_mb = file.tell() / (1024 * 1024)
    file.seek(0)
    if size_mb > MAX_MB:
        return jsonify({'error': f'파일이 너무 큽니다 ({size_mb:.1f}MB). {MAX_MB}MB 이하만 지원합니다'}), 413
    filename = unique_filename(file.filename)
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)
    file_size = os.path.getsize(filepath)
    uploaded_at = utc_now_iso()
    return jsonify({
        'filename': filename,
        'url': f'/uploads/{filename}',
        'originalFilename': file.filename,
        'storedFilename': filename,
        'mimeType': file.mimetype or '',
        'fileSize': file_size,
        'uploadedAt': uploaded_at,
    })

# Vision AI 태그
@app.route('/tag', methods=['POST'])
def tag():
    data     = json_dict()
    filename = data.get('filename')
    if not filename:
        return jsonify({'error': 'filename 필요'}), 400
    filepath = os.path.join(UPLOAD_FOLDER, secure_filename(filename))
    if not os.path.exists(filepath):
        return jsonify({'error': '파일을 찾을 수 없습니다'}), 404
    cache_key = file_sha256(filepath)
    if cache_key in TAG_CACHE:
        return jsonify({'tags': TAG_CACHE[cache_key]})

    with open(filepath, 'rb') as f:
        image_b64 = base64.b64encode(f.read()).decode('utf-8')

    prompt = (
        '이 사진에서 명확하게 보이는 주요 대상만 태그로 고르세요. '
        '추측하지 마세요. 배경이 작거나 흐리면 도시, 자연, 야경, 풍경 태그를 붙이지 마세요. '
        '사람 얼굴이나 단체 셀카가 주요 대상이면 보통 ["인물"]만 답하세요. '
        '확실한 태그가 없으면 빈 배열 []을 답하세요. 최대 2개까지만 고르세요. '
        '설명 없이 JSON 배열만 출력하세요.\n'
        '카테고리: ["음식", "풍경", "인물", "건축", "자연", "도시", "교통", "동물", "실내", "야경"]\n'
        '예시 출력: ["인물"]'
    )
    try:
        resp = requests.post(OLLAMA_URL, json={
            'model': OLLAMA_MODEL,
            'messages': [{'role': 'user', 'content': prompt, 'images': [image_b64]}],
            'options': {'temperature': 0, 'seed': 0, 'top_p': 0.1},
            'stream': False,
        }, timeout=60)
        resp.raise_for_status()
        content = resp.json()['message']['content'].strip()
        tags = parse_tag_content(content)
    except requests.RequestException as ex:
        print(f'Ollama 태그 오류: {ex}')
        return jsonify({'tags': [], 'error': 'Ollama 연결 실패'}), 502
    except Exception as ex:
        print(f'Ollama 태그 오류: {ex}')
        tags = []
    TAG_CACHE[cache_key] = tags
    return jsonify({'tags': tags})

# AI 사진 설명 (캡션)
@app.route('/caption', methods=['POST'])
def caption():
    data     = json_dict()
    filename = data.get('filename')
    if not filename:
        return jsonify({'error': 'filename 필요'}), 400
    filepath = os.path.join(UPLOAD_FOLDER, secure_filename(filename))
    if not os.path.exists(filepath):
        return jsonify({'error': '파일을 찾을 수 없습니다'}), 404

    with open(filepath, 'rb') as f:
        image_b64 = base64.b64encode(f.read()).decode('utf-8')

    place = data.get('place', '')
    date  = data.get('date', '')
    ctx   = f"이 사진은 {place}에서 {date}에 촬영됐습니다. " if (place or date) else ''

    prompt = (
        f'{ctx}사진을 보고 한국어로 1~2문장의 자연스러운 여행 기록 문장을 써주세요. '
        '장소·분위기·인상을 담아 간결하게. 앞에 "이 사진은" 같은 말 없이 바로 시작하세요.'
    )
    try:
        resp = requests.post(OLLAMA_URL, json={
            'model': OLLAMA_MODEL,
            'messages': [{'role': 'user', 'content': prompt, 'images': [image_b64]}],
            'stream': False,
        }, timeout=90)
        resp.raise_for_status()
        text = resp.json()['message']['content'].strip()
    except Exception as ex:
        print(f'Ollama 캡션 오류: {ex}')
        text = ''
    return jsonify({'caption': text})

@app.route('/infer-place', methods=['POST'])
def infer_place():
    data = json_dict()
    filename = data.get('filename')
    if not filename:
        return jsonify({'error': 'filename 필요'}), 400
    filepath = os.path.join(UPLOAD_FOLDER, secure_filename(filename))
    if not os.path.exists(filepath):
        return jsonify({'error': '파일을 찾을 수 없습니다'}), 404

    if not has_model(available_ollama_models(), OLLAMA_MODEL):
        return jsonify({
            'available': False,
            'place': '',
            'confidence': 'unavailable',
            'reason': f'Vision model unavailable: {OLLAMA_MODEL}',
        })

    with open(filepath, 'rb') as f:
        image_b64 = base64.b64encode(f.read()).decode('utf-8')

    original_filename = data.get('originalFilename') or filename
    source_folder = data.get('sourceFolder') or ''
    prompt = (
        'Analyze this travel photo and infer the most likely place if possible. '
        'Look for landmarks, signs, venue names, storefronts, road signs, transit signs, '
        'natural context, urban context, and broad scene context. '
        'Treat filename and source folder as weak clues only, not proof. '
        'Be explicit about uncertainty. Use "Unknown Location" when the place cannot be inferred. '
        'Return only JSON with keys: place, city, country, landmark, sceneType, confidence, reason. '
        'Confidence must be one of high, medium, low, or unknown. '
        'Use empty strings for city, country, landmark, or sceneType when they cannot be inferred. '
        f'Weak filename clue: {original_filename}. '
        f'Weak source folder clue: {source_folder}.'
    )
    try:
        resp = requests.post(OLLAMA_URL, json={
            'model': OLLAMA_MODEL,
            'messages': [{'role': 'user', 'content': prompt, 'images': [image_b64]}],
            'stream': False,
        }, timeout=90)
        resp.raise_for_status()
        content = resp.json()['message']['content'].strip()
        inferred = parse_place_inference_content(content)
    except requests.RequestException as ex:
        print(f'Ollama place inference error: {ex}')
        return jsonify({
            'available': False,
            'place': '',
            'confidence': 'unavailable',
            'reason': 'Vision place inference request failed.',
        })
    except Exception as ex:
        print(f'Ollama place inference parse error: {ex}')
        inferred = {
            'place': 'Unknown Location',
            'confidence': 'low',
            'reason': 'Vision place inference failed to return structured data.',
        }
    inferred['available'] = True
    return jsonify(inferred)

# CLIP 인덱싱 (Forward Pass)
@app.route('/index', methods=['POST'])
def index_pin():
    data     = normalize_pin(json_dict())
    pin_id   = data.get('id')
    filename = data.get('filename')
    if not pin_id or not filename:
        return jsonify({'error': 'id, filename 필요'}), 400
    filepath = os.path.join(UPLOAD_FOLDER, secure_filename(filename))
    if not os.path.exists(filepath):
        return jsonify({'error': '파일을 찾을 수 없습니다'}), 404

    try:
        from PIL import Image
        clip = get_clip()
        col  = get_collection()

        img       = Image.open(filepath).convert('RGB')
        img_vec   = clip.encode(img).tolist()
        meta_text = build_metadata_text(data)
        meta_vec  = clip.encode(meta_text).tolist()
        combined  = [(a + b) / 2 for a, b in zip(img_vec, meta_vec)]

        col.upsert(
            ids=[str(pin_id)],
            embeddings=[combined],
            metadatas=[{
                'pin_id':   int(pin_id),
                'filename': filename,
                'place':    data.get('place', ''),
                'date':     data.get('date', ''),
                'tags':     json.dumps(data.get('tags', []), ensure_ascii=False),
                'caption':  data.get('caption', ''),
                'regionScope': data.get('regionScope', 'unknown'),
                'transportMode': data.get('transportMode', 'unknown'),
                'lat':      data.get('lat') if data.get('lat') is not None else '',
                'lng':      data.get('lng') if data.get('lng') is not None else '',
            }],
            documents=[meta_text],
        )
        return jsonify({'ok': True})
    except Exception as e:
        print(f'인덱싱 오류: {e}')
        return jsonify({'error': str(e)}), 500

# ChromaDB 인덱싱 누락 핀 일괄 재인덱싱
@app.route('/reindex', methods=['POST'])
def reindex():
    """서버 재시작 후 ChromaDB가 비어 있을 때 pins.json 기준으로 재인덱싱."""
    try:
        from PIL import Image
        clip = get_clip()
        col  = get_collection()

        pins    = load_pins()
        indexed = set(col.get()['ids']) if col.count() > 0 else set()
        missing = [p for p in pins if str(p['id']) not in indexed and p.get('filename')]

        count = 0
        for pin in missing:
            filepath = os.path.join(UPLOAD_FOLDER, secure_filename(pin['filename']))
            if not os.path.exists(filepath):
                continue
            try:
                img       = Image.open(filepath).convert('RGB')
                img_vec   = clip.encode(img).tolist()
                meta_text = build_metadata_text(pin)
                meta_vec  = clip.encode(meta_text).tolist()
                combined  = [(a + b) / 2 for a, b in zip(img_vec, meta_vec)]
                col.upsert(
                    ids=[str(pin['id'])],
                    embeddings=[combined],
                    metadatas=[{
                        'pin_id':   int(pin['id']),
                        'filename': pin['filename'],
                        'place':    pin.get('place', ''),
                        'date':     pin.get('date', ''),
                        'tags':     json.dumps(pin.get('tags', []), ensure_ascii=False),
                        'caption':  pin.get('caption', ''),
                        'regionScope': pin.get('regionScope', 'unknown'),
                        'transportMode': pin.get('transportMode', 'unknown'),
                        'lat':      pin.get('lat') if pin.get('lat') is not None else '',
                        'lng':      pin.get('lng') if pin.get('lng') is not None else '',
                    }],
                    documents=[meta_text],
                )
                count += 1
            except Exception as ex:
                print(f'재인덱싱 실패 pin={pin["id"]}: {ex}')

        return jsonify({'ok': True, 'reindexed': count, 'total': len(pins)})
    except Exception as e:
        print(f'재인덱싱 오류: {e}')
        return jsonify({'error': str(e)}), 500

# 자연어 검색 (Backward Pass)
@app.route('/search', methods=['POST'])
def search():
    data  = json_dict()
    query = (data.get('query') or '').strip()
    if not query:
        return jsonify({'error': 'query 필요'}), 400

    try:
        clip = get_clip()
        col  = get_collection()

        if col.count() == 0:
            return jsonify({'pin_ids': [], 'message': '인덱싱된 사진이 없습니다'})

        # 1단계: CLIP 벡터 검색
        query_vec  = clip.encode(query).tolist()
        results    = col.query(query_embeddings=[query_vec], n_results=min(TOP_K, col.count()))
        candidates = []
        for i, meta in enumerate(results['metadatas'][0]):
            candidates.append({
                'pin_id':   meta['pin_id'],
                'document': results['documents'][0][i],
                'distance': results['distances'][0][i],
            })

        if not candidates:
            return jsonify({'pin_ids': []})

        # 2단계: Ollama LLM 재랭킹
        candidate_text = '\n'.join(
            f"{i+1}. pin_id={c['pin_id']} | {c['document']}"
            for i, c in enumerate(candidates)
        )
        rerank_prompt = (
            f'사용자가 "{query}"라는 사진을 찾고 있습니다.\n\n'
            f'아래 후보 사진 목록에서 검색어와 관련 있는 것들의 번호를 '
            f'JSON 배열로만 출력하세요. 관련 없으면 빈 배열 []을 출력하세요.\n\n'
            f'{candidate_text}\n\n출력 형식 예시: [1, 3, 5]'
        )
        try:
            resp = requests.post(OLLAMA_URL, json={
                'model':    RERANK_MODEL,
                'messages': [{'role': 'user', 'content': rerank_prompt}],
                'stream':   False,
            }, timeout=30)
            resp.raise_for_status()
            content = resp.json()['message']['content'].strip()
            s = content.find('['); e = content.rfind(']') + 1
            indices = json.loads(content[s:e]) if s != -1 else []
            pin_ids = [
                candidates[i-1]['pin_id']
                for i in indices
                if isinstance(i, int) and 1 <= i <= len(candidates)
            ]
        except Exception as ex:
            print(f'재랭킹 오류: {ex}')
            pin_ids = [c['pin_id'] for c in candidates[:RERANK_K]]

        return jsonify({'pin_ids': pin_ids, 'total_candidates': len(candidates)})
    except Exception as e:
        print(f'검색 오류: {e}')
        return jsonify({'error': str(e)}), 500

# 핀 목록
@app.route('/pins', methods=['GET'])
def get_pins():
    return jsonify(load_pins())

@app.route('/pins', methods=['POST'])
def save_pin():
    pin = json_dict()
    if not pin or 'id' not in pin:
        return jsonify({'error': 'id 필요'}), 400
    pins = load_pins()
    idx  = next((i for i, p in enumerate(pins) if p['id'] == pin['id']), None)
    if idx is not None:
        pins[idx] = pin
    else:
        pins.append(pin)
    save_pins(pins)
    return jsonify({'ok': True})

@app.route('/pins/<int:pin_id>', methods=['DELETE'])
def delete_pin(pin_id):
    pins     = load_pins()
    target   = next((p for p in pins if p['id'] == pin_id), None)
    if target is None:
        return jsonify({'error': '핀을 찾을 수 없습니다'}), 404

    try:
        col = get_collection()
        col.delete(ids=[str(pin_id)])
    except Exception:
        pass
    remaining = [p for p in pins if p['id'] != pin_id]
    save_pins(remaining)
    # 다른 핀이 같은 파일을 공유하지 않을 때만 삭제
    if target and target.get('filename'):
        still_used = any(p.get('filename') == target['filename'] for p in remaining)
        if not still_used:
            delete_upload(target['filename'])
    return jsonify({'ok': True})

@app.route('/pins/import', methods=['POST'])
def import_pins():
    data = request.get_json(silent=True)
    if not isinstance(data, list):
        return jsonify({'error': 'JSON 배열이어야 합니다'}), 400
    valid = [p for p in data if isinstance(p, dict) and 'id' in p and 'lat' in p and 'lng' in p]
    save_pins(valid)
    return jsonify({'ok': True, 'count': len(valid)})

@app.route('/organization/preview', methods=['GET'])
def organization_preview():
    return jsonify({'items': build_output_paths(load_pins())})

@app.route('/organization/export.zip', methods=['GET'])
def organization_export_zip():
    pins = load_pins()
    if not pins:
        return jsonify({'error': 'No photos are available for ZIP export.'}), 400

    archive, missing = build_organization_zip(pins)
    if missing:
        return jsonify({
            'error': 'One or more stored uploads are missing.',
            'missing': missing,
        }), 400

    return send_file(
        archive,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f'tripsort-organized-{datetime.now(timezone.utc).date().isoformat()}.zip',
    )

@app.route('/reverse-geocode', methods=['GET'])
def reverse_geocode():
    try:
        lat = float(request.args['lat'])
        lng = float(request.args['lng'])
    except (KeyError, ValueError):
        return jsonify({'error': 'lat, lng 숫자 파라미터가 필요합니다'}), 400
    if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return jsonify({'error': '좌표 범위를 벗어났습니다'}), 400
    try:
        r = requests.get(
            'https://nominatim.openstreetmap.org/reverse',
            params={'lat': lat, 'lon': lng, 'format': 'json', 'accept-language': 'ko'},
            headers={'User-Agent': 'TripSort/1.0'},
            timeout=5,
        )
        r.raise_for_status()
        addr = r.json().get('address', {})
        place = (addr.get('city') or addr.get('town') or addr.get('village')
                 or addr.get('county') or addr.get('state') or addr.get('country')
                 or f'{lat:.3f}, {lng:.3f}')
        return jsonify({'place': place})
    except Exception as ex:
        return jsonify({'place': f'{lat:.3f}, {lng:.3f}', 'error': str(ex)})

if __name__ == '__main__':
    app.run(**server_config_from_env())
