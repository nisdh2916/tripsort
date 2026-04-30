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

os.makedirs(UPLOAD_FOLDER, exist_ok=True)


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

    # 파일 크기 검증
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
    data = request.get_json()
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
    idx = next((i for i, p in enumerate(pins) if p['id'] == pin['id']), None)
    if idx is not None:
        pins[idx] = pin
    else:
        pins.append(pin)
    save_pins(pins)
    return jsonify({'ok': True})


# 핀 삭제
@app.route('/pins/<int:pin_id>', methods=['DELETE'])
def delete_pin(pin_id):
    pins = load_pins()
    pins = [p for p in pins if p['id'] != pin_id]
    save_pins(pins)
    return jsonify({'ok': True})


if __name__ == '__main__':
    app.run(debug=True, port=5000)
