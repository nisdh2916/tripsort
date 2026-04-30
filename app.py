import os
import json
import base64
import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__, static_folder='static')
CORS(app)

UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'heic', 'webp'}
OLLAMA_URL = 'http://localhost:11434/api/chat'
OLLAMA_MODEL = 'llama3.2-vision'

os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': '파일이 없습니다'}), 400

    file = request.files['file']
    if file.filename == '' or not allowed_file(file.filename):
        return jsonify({'error': '지원하지 않는 파일 형식입니다'}), 400

    filename = secure_filename(file.filename)
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)

    return jsonify({'filename': filename, 'url': f'/uploads/{filename}'})


@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)


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

    ext = filename.rsplit('.', 1)[1].lower()
    mime = 'image/jpeg' if ext in ('jpg', 'jpeg') else f'image/{ext}'

    prompt = (
        '이 사진을 보고 아래 카테고리 중 해당하는 것을 모두 골라 JSON 배열로만 답하세요. '
        '설명 없이 JSON만 출력하세요.\n'
        '카테고리: ["음식", "풍경", "인물", "건축", "자연", "도시", "교통", "동물", "실내", "야경"]\n'
        '예시 출력: ["풍경", "자연"]'
    )

    try:
        response = requests.post(OLLAMA_URL, json={
            'model': OLLAMA_MODEL,
            'messages': [{
                'role': 'user',
                'content': prompt,
                'images': [image_b64]
            }],
            'stream': False
        }, timeout=60)
        response.raise_for_status()
        content = response.json()['message']['content'].strip()
        # JSON 배열만 추출
        start = content.find('[')
        end = content.rfind(']') + 1
        tags = json.loads(content[start:end]) if start != -1 else []
    except Exception as e:
        print(f'Ollama 오류: {e}')
        tags = []

    return jsonify({'tags': tags})


if __name__ == '__main__':
    app.run(debug=True, port=5000)
