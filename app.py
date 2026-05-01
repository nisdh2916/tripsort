import os
import json
import base64
import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__, static_folder='static')
CORS(app)

UPLOAD_FOLDER  = 'uploads'
PINS_FILE      = 'pins.json'
ALLOWED_EXT    = {'jpg', 'jpeg', 'png', 'heic', 'webp'}
MAX_MB         = 30
OLLAMA_URL     = 'http://localhost:11434/api/chat'
OLLAMA_MODEL   = 'llama3.2-vision'
RERANK_MODEL   = 'llama3.2'          # 텍스트 재랭킹용 (vision 불필요)
TOP_K          = 10                  # CLIP 1차 후보 수
RERANK_K       = 5                   # LLM 재랭킹 후 최종 수

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

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

def load_pins():
    if not os.path.exists(PINS_FILE):
        return []
    try:
        with open(PINS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []

def save_pins(pins):
    with open(PINS_FILE, 'w', encoding='utf-8') as f:
        json.dump(pins, f, ensure_ascii=False, indent=2)

def build_metadata_text(pin: dict) -> str:
    """핀 메타데이터를 CLIP 텍스트 임베딩용 문자열로 변환."""
    parts = []
    if pin.get('place'):
        parts.append(f"장소: {pin['place']}")
    if pin.get('date'):
        parts.append(f"날짜: {pin['date']}")
    if pin.get('tags'):
        parts.append(f"분류: {', '.join(pin['tags'])}")
    if pin.get('lat') and pin.get('lng'):
        parts.append(f"위도 {pin['lat']:.2f} 경도 {pin['lng']:.2f}")
    return '. '.join(parts) if parts else '사진'

# ── routes ───────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

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

    filename = secure_filename(file.filename)
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)
    return jsonify({'filename': filename, 'url': f'/uploads/{filename}'})

# Vision AI 태그
@app.route('/tag', methods=['POST'])
def tag():
    data     = request.get_json()
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
        start = content.find('[')
        end   = content.rfind(']') + 1
        tags  = json.loads(content[start:end]) if start != -1 else []
    except Exception as e:
        print(f'Ollama 오류: {e}')
        tags = []

    return jsonify({'tags': tags})

# CLIP 인덱싱 (Forward Pass)
@app.route('/index', methods=['POST'])
def index_pin():
    """사진 + 메타데이터를 CLIP으로 임베딩해 ChromaDB에 저장."""
    data     = request.get_json()
    pin_id   = data.get('id')
    filename = data.get('filename')
    if not pin_id or not filename:
        return jsonify({'error': 'id, filename 필요'}), 400

    filepath = os.path.join(UPLOAD_FOLDER, secure_filename(filename))
    if not os.path.exists(filepath):
        return jsonify({'error': '파일을 찾을 수 없습니다'}), 404

    try:
        from PIL import Image
        clip  = get_clip()
        col   = get_collection()

        # 이미지 임베딩
        img        = Image.open(filepath).convert('RGB')
        img_vec    = clip.encode(img).tolist()

        # 메타데이터 텍스트 임베딩
        meta_text  = build_metadata_text(data)
        meta_vec   = clip.encode(meta_text).tolist()

        # 두 벡터 평균 → 이미지 시각 정보 + 장소·날짜·태그 정보 통합
        combined   = [(a + b) / 2 for a, b in zip(img_vec, meta_vec)]

        col.upsert(
            ids=[str(pin_id)],
            embeddings=[combined],
            metadatas=[{
                'pin_id':   int(pin_id),
                'filename': filename,
                'place':    data.get('place', ''),
                'date':     data.get('date', ''),
                'tags':     json.dumps(data.get('tags', []), ensure_ascii=False),
            }],
            documents=[meta_text],
        )
        return jsonify({'ok': True})
    except Exception as e:
        print(f'인덱싱 오류: {e}')
        return jsonify({'error': str(e)}), 500

# 자연어 검색 (Backward Pass — 2단계 RAG)
@app.route('/search', methods=['POST'])
def search():
    """
    1단계: CLIP 텍스트 임베딩 → ChromaDB 코사인 유사도 검색 (Top-K)
    2단계: Ollama LLM으로 후보 재랭킹 → 최종 pin_id 목록 반환
    """
    data  = request.get_json()
    query = (data.get('query') or '').strip()
    if not query:
        return jsonify({'error': 'query 필요'}), 400

    try:
        clip = get_clip()
        col  = get_collection()

        if col.count() == 0:
            return jsonify({'pin_ids': [], 'message': '인덱싱된 사진이 없습니다'})

        # ── 1단계: CLIP 벡터 검색 ──────────────────────────
        query_vec = clip.encode(query).tolist()
        results   = col.query(
            query_embeddings=[query_vec],
            n_results=min(TOP_K, col.count()),
        )

        candidates = []
        for i, meta in enumerate(results['metadatas'][0]):
            candidates.append({
                'pin_id':   meta['pin_id'],
                'filename': meta['filename'],
                'place':    meta['place'],
                'date':     meta['date'],
                'tags':     json.loads(meta.get('tags', '[]')),
                'document': results['documents'][0][i],
                'distance': results['distances'][0][i],
            })

        if not candidates:
            return jsonify({'pin_ids': []})

        # ── 2단계: Ollama LLM 재랭킹 ───────────────────────
        candidate_text = '\n'.join(
            f"{i+1}. pin_id={c['pin_id']} | {c['document']}"
            for i, c in enumerate(candidates)
        )

        rerank_prompt = (
            f'사용자가 "{query}"라는 사진을 찾고 있습니다.\n\n'
            f'아래 후보 사진 목록에서 검색어와 관련 있는 것들의 번호를 '
            f'JSON 배열로만 출력하세요. 관련 없으면 빈 배열 []을 출력하세요.\n\n'
            f'{candidate_text}\n\n'
            f'출력 형식 예시: [1, 3, 5]'
        )

        try:
            resp = requests.post(OLLAMA_URL, json={
                'model':    RERANK_MODEL,
                'messages': [{'role': 'user', 'content': rerank_prompt}],
                'stream':   False,
            }, timeout=30)
            resp.raise_for_status()
            content = resp.json()['message']['content'].strip()
            start   = content.find('[')
            end     = content.rfind(']') + 1
            indices = json.loads(content[start:end]) if start != -1 else []
            # 1-based 인덱스 → pin_id 변환, 범위 검증
            pin_ids = [
                candidates[i - 1]['pin_id']
                for i in indices
                if isinstance(i, int) and 1 <= i <= len(candidates)
            ]
        except Exception as e:
            print(f'재랭킹 오류 (CLIP 결과만 반환): {e}')
            # 재랭킹 실패 시 CLIP 결과 상위 RERANK_K개 반환
            pin_ids = [c['pin_id'] for c in candidates[:RERANK_K]]

        return jsonify({'pin_ids': pin_ids, 'total_candidates': len(candidates)})

    except Exception as e:
        print(f'검색 오류: {e}')
        return jsonify({'error': str(e)}), 500

# 핀 목록 조회
@app.route('/pins', methods=['GET'])
def get_pins():
    return jsonify(load_pins())

# 핀 저장 (upsert)
@app.route('/pins', methods=['POST'])
def save_pin():
    pin = request.get_json()
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

# 핀 삭제
@app.route('/pins/<int:pin_id>', methods=['DELETE'])
def delete_pin(pin_id):
    # ChromaDB에서도 제거
    try:
        col = get_collection()
        col.delete(ids=[str(pin_id)])
    except Exception:
        pass

    pins = [p for p in load_pins() if p['id'] != pin_id]
    save_pins(pins)
    return jsonify({'ok': True})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
