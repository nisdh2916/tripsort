import os
import json
import uuid
import base64
import requests
from flask import Flask, request, jsonify, send_from_directory
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

def normalize_pin(pin):
    normalized = dict(pin)
    for key, value in PIN_DEFAULTS.items():
        if normalized.get(key) in (None, ''):
            normalized[key] = value
    if normalized.get('transportMode') not in TRANSPORT_MODES:
        normalized['transportMode'] = PIN_DEFAULTS['transportMode']
    return normalized

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
    return [tag for tag in tags if isinstance(tag, str) and tag in ALLOWED_TAGS]

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
        return [normalize_pin(p) for p in data if isinstance(p, dict) and 'id' in p]
    except Exception:
        return []

def save_pins(pins):
    with open(PINS_FILE, 'w', encoding='utf-8') as f:
        json.dump([normalize_pin(p) for p in pins], f, ensure_ascii=False, indent=2)

def delete_upload(filename):
    if not isinstance(filename, str):
        return
    safe = secure_filename(filename)
    if not safe:
        return
    path = os.path.join(UPLOAD_FOLDER, safe)
    if os.path.isfile(path):
        os.remove(path)

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
    return jsonify({'filename': filename, 'url': f'/uploads/{filename}'})

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

    with open(filepath, 'rb') as f:
        image_b64 = base64.b64encode(f.read()).decode('utf-8')

    prompt = (
        '이 사진을 보고 아래 카테고리 중 해당하는 것을 모두 골라 JSON 배열로만 답하세요. '
        '설명 없이 JSON만 출력하세요.\n'
        '카테고리: ["음식", "풍경", "인물", "건축", "자연", "도시", "교통", "동물", "실내", "야경"]\n'
        '예시 출력: ["풍경", "자연"]'
    )
    try:
        resp = requests.post(OLLAMA_URL, json={
            'model': OLLAMA_MODEL,
            'messages': [{'role': 'user', 'content': prompt, 'images': [image_b64]}],
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
            headers={'User-Agent': 'Pindrop/1.0'},
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
