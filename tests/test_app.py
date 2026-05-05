import io
import json
import os
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
import requests

import app as pindrop_app


class PindropApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_upload_folder = pindrop_app.UPLOAD_FOLDER
        self.old_pins_file = pindrop_app.PINS_FILE

        pindrop_app.UPLOAD_FOLDER = os.path.join(self.tmp.name, 'uploads')
        pindrop_app.PINS_FILE = os.path.join(self.tmp.name, 'pins.json')
        os.makedirs(pindrop_app.UPLOAD_FOLDER, exist_ok=True)

        pindrop_app.app.config['TESTING'] = True
        self.client = pindrop_app.app.test_client()

    def tearDown(self):
        pindrop_app.UPLOAD_FOLDER = self.old_upload_folder
        pindrop_app.PINS_FILE = self.old_pins_file
        self.tmp.cleanup()

    def test_ping_is_lightweight_server_readiness_check(self):
        response = self.client.get('/ping')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {'flask': True})

    def test_server_config_defaults_to_local_browser_safe_values(self):
        config = pindrop_app.server_config_from_env({})

        self.assertEqual(config, {'host': '127.0.0.1', 'debug': False, 'port': 5000})

    def test_server_config_accepts_environment_overrides(self):
        config = pindrop_app.server_config_from_env({
            'PINDROP_HOST': '0.0.0.0',
            'PINDROP_PORT': '5050',
            'PINDROP_DEBUG': '1',
        })

        self.assertEqual(config, {'host': '0.0.0.0', 'debug': True, 'port': 5050})

    def test_load_dotenv_file_loads_missing_values(self):
        env_path = os.path.join(self.tmp.name, '.env')
        with open(env_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join([
                '# local settings',
                'PINDROP_MAPTILER_KEY=file-key',
                'export PINDROP_HOST=0.0.0.0',
                'PINDROP_PORT=5050',
                'PINDROP_MAP_STYLE_URL="https://example.test/style.json?key=file-key"',
            ]))
        env = {'PINDROP_PORT': '5001'}

        loaded = pindrop_app.load_dotenv_file(env_path, env)

        self.assertTrue(loaded)
        self.assertEqual(env['PINDROP_MAPTILER_KEY'], 'file-key')
        self.assertEqual(env['PINDROP_HOST'], '0.0.0.0')
        self.assertEqual(env['PINDROP_PORT'], '5001')
        self.assertEqual(env['PINDROP_MAP_STYLE_URL'], 'https://example.test/style.json?key=file-key')

    def test_load_dotenv_file_accepts_utf8_bom(self):
        env_path = os.path.join(self.tmp.name, '.env')
        with open(env_path, 'w', encoding='utf-8-sig') as f:
            f.write('PINDROP_MAPTILER_KEY=file-key')
        env = {}

        loaded = pindrop_app.load_dotenv_file(env_path, env)

        self.assertTrue(loaded)
        self.assertEqual(env['PINDROP_MAPTILER_KEY'], 'file-key')

    def test_load_dotenv_file_returns_false_for_missing_file(self):
        env = {}

        loaded = pindrop_app.load_dotenv_file(os.path.join(self.tmp.name, 'missing.env'), env)

        self.assertFalse(loaded)
        self.assertEqual(env, {})

    def test_map_config_is_disabled_without_provider_key(self):
        self.assertEqual(pindrop_app.map_config_from_env({}), {
            'enabled': False,
            'provider': 'none',
            'apiKey': '',
            'styleUrl': '',
        })

    def test_map_config_accepts_maptiler_key(self):
        config = pindrop_app.map_config_from_env({
            'PINDROP_MAPTILER_KEY': 'test-key',
        })

        self.assertEqual(config, {
            'enabled': True,
            'provider': 'maptiler',
            'apiKey': 'test-key',
            'styleUrl': 'https://api.maptiler.com/maps/streets-v2/style.json?key=test-key',
        })

    def test_map_config_accepts_custom_style_url(self):
        config = pindrop_app.map_config_from_env({
            'PINDROP_MAPTILER_KEY': 'test-key',
            'PINDROP_MAP_STYLE_URL': 'https://example.test/style.json?key=test-key',
        })

        self.assertEqual(config['styleUrl'], 'https://example.test/style.json?key=test-key')

    def test_map_config_route_returns_disabled_config_by_default(self):
        with patch.dict(pindrop_app.os.environ, {}, clear=True):
            response = self.client.get('/map-config')

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json['enabled'])
        self.assertEqual(response.json['provider'], 'none')

    def test_cors_origins_default_to_localhost_only(self):
        self.assertEqual(pindrop_app.parse_cors_origins(), [
            'http://localhost:5000',
            'http://127.0.0.1:5000',
        ])

    def test_cors_origins_accept_comma_separated_overrides(self):
        self.assertEqual(
            pindrop_app.parse_cors_origins('https://example.test, http://localhost:5000, '),
            ['https://example.test', 'http://localhost:5000'],
        )

    def test_upload_uses_unique_filenames(self):
        first = self.client.post(
            '/upload',
            data={'file': (io.BytesIO(b'first'), 'photo.jpg')},
            content_type='multipart/form-data',
        )
        second = self.client.post(
            '/upload',
            data={'file': (io.BytesIO(b'second'), 'photo.jpg')},
            content_type='multipart/form-data',
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertNotEqual(first.json['filename'], second.json['filename'])
        self.assertTrue(os.path.exists(os.path.join(pindrop_app.UPLOAD_FOLDER, first.json['filename'])))
        self.assertTrue(os.path.exists(os.path.join(pindrop_app.UPLOAD_FOLDER, second.json['filename'])))

    def test_upload_rejects_missing_file(self):
        response = self.client.post('/upload', data={}, content_type='multipart/form-data')

        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.json)

    def test_upload_rejects_unsupported_extension(self):
        response = self.client.post(
            '/upload',
            data={'file': (io.BytesIO(b'bad'), 'notes.txt')},
            content_type='multipart/form-data',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.json)

    def test_upload_accepts_supported_extensions(self):
        for extension in ['jpg', 'jpeg', 'png', 'heic', 'webp']:
            with self.subTest(extension=extension):
                response = self.client.post(
                    '/upload',
                    data={'file': (io.BytesIO(b'image'), f'photo.{extension}')},
                    content_type='multipart/form-data',
                )

                self.assertEqual(response.status_code, 200)
                self.assertIn('filename', response.json)
                self.assertIn('url', response.json)
                self.assertTrue(os.path.exists(os.path.join(pindrop_app.UPLOAD_FOLDER, response.json['filename'])))

    def test_tag_rejects_missing_filename_without_500(self):
        response = self.client.post('/tag', json={'filename': None})

        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.json)

    def test_json_object_endpoints_reject_null_body_without_500(self):
        for path in ['/tag', '/caption', '/index', '/search', '/pins']:
            with self.subTest(path=path):
                response = self.client.post(path, data='null', content_type='application/json')

                self.assertEqual(response.status_code, 400)
                self.assertIn('error', response.json)

    def test_json_object_endpoints_reject_non_object_bodies_without_500(self):
        for body in ['[]', '"bad"']:
            for path in ['/tag', '/caption', '/index', '/search', '/pins']:
                with self.subTest(body=body, path=path):
                    response = self.client.post(path, data=body, content_type='application/json')

                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(response.json, {'error': 'JSON object body required'})

    def test_valid_json_object_body_still_works(self):
        response = self.client.post('/pins', json={'id': 9, 'place': '서울'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {'ok': True})
        self.assertEqual(self.client.get('/pins').json, [{
            'id': 9,
            'place': '서울',
            'regionScope': 'unknown',
            'transportMode': 'unknown',
        }])

    def test_tag_reports_ollama_failure(self):
        image_path = os.path.join(pindrop_app.UPLOAD_FOLDER, 'photo.jpg')
        with open(image_path, 'wb') as f:
            f.write(b'fake image data')

        with (
            patch.object(pindrop_app.requests, 'post', side_effect=requests.RequestException('down')),
            patch('builtins.print'),
        ):
            response = self.client.post('/tag', json={'filename': 'photo.jpg'})

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json['tags'], [])
        self.assertIn('error', response.json)

    def test_tag_sends_image_to_ollama_and_filters_supported_tags(self):
        image_path = os.path.join(pindrop_app.UPLOAD_FOLDER, 'photo.jpg')
        with open(image_path, 'wb') as f:
            f.write(b'fake image data')
        captured = {}

        class FakeResponse:
            def raise_for_status(self):
                pass

            def json(self):
                return {'message': {'content': '분석 결과: ["도시", "없는태그", "야경"]'}}

        def fake_post(_url, json, timeout):
            captured['json'] = json
            captured['timeout'] = timeout
            return FakeResponse()

        with patch.object(pindrop_app.requests, 'post', side_effect=fake_post):
            response = self.client.post('/tag', json={'filename': 'photo.jpg'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {'tags': ['도시', '야경']})
        self.assertEqual(captured['json']['model'], 'llama3.2-vision')
        self.assertEqual(captured['timeout'], 60)
        self.assertTrue(captured['json']['messages'][0]['images'][0])

    def test_caption_sends_image_to_ollama_and_returns_text(self):
        image_path = os.path.join(pindrop_app.UPLOAD_FOLDER, 'photo.jpg')
        with open(image_path, 'wb') as f:
            f.write(b'fake image data')
        captured = {}

        class FakeResponse:
            def raise_for_status(self):
                pass

            def json(self):
                return {'message': {'content': '비 오는 서울 거리가 차분하게 담겼습니다.'}}

        def fake_post(_url, json, timeout):
            captured['json'] = json
            captured['timeout'] = timeout
            return FakeResponse()

        with patch.object(pindrop_app.requests, 'post', side_effect=fake_post):
            response = self.client.post('/caption', json={
                'filename': 'photo.jpg',
                'place': '서울',
                'date': '2026년 5월 5일',
            })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {'caption': '비 오는 서울 거리가 차분하게 담겼습니다.'})
        self.assertEqual(captured['json']['model'], 'llama3.2-vision')
        self.assertEqual(captured['timeout'], 90)
        self.assertIn('서울', captured['json']['messages'][0]['content'])
        self.assertTrue(captured['json']['messages'][0]['images'][0])

    def test_caption_failure_returns_empty_caption(self):
        image_path = os.path.join(pindrop_app.UPLOAD_FOLDER, 'photo.jpg')
        with open(image_path, 'wb') as f:
            f.write(b'fake image data')

        with (
            patch.object(pindrop_app.requests, 'post', side_effect=requests.RequestException('down')),
            patch('builtins.print'),
        ):
            response = self.client.post('/caption', json={'filename': 'photo.jpg'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {'caption': ''})

    def test_health_reports_required_model_status(self):
        class FakeTagsResponse:
            ok = True

            def json(self):
                return {
                    'models': [
                        {'name': 'llama3.2:latest'},
                        {'name': 'llama3.2-vision:latest'},
                    ],
                }

        class FakeCollection:
            def count(self):
                return 12

        with (
            patch.object(pindrop_app.requests, 'get', return_value=FakeTagsResponse()),
            patch.object(pindrop_app, 'get_collection', return_value=FakeCollection()),
        ):
            response = self.client.get('/health')

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json['flask'])
        self.assertTrue(response.json['ollama'])
        self.assertEqual(response.json['indexed'], 12)
        self.assertEqual(response.json['required_models'], {
            'rerank': {'name': 'llama3.2', 'available': True},
            'vision': {'name': 'llama3.2-vision', 'available': True},
        })

    def test_health_reports_missing_models_when_ollama_unavailable(self):
        with (
            patch.object(pindrop_app.requests, 'get', side_effect=requests.RequestException('down')),
            patch.object(pindrop_app, 'get_collection', side_effect=RuntimeError('missing')),
        ):
            response = self.client.get('/health')

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json['flask'])
        self.assertFalse(response.json['ollama'])
        self.assertEqual(response.json['models'], [])
        self.assertEqual(response.json['indexed'], -1)
        self.assertFalse(response.json['required_models']['vision']['available'])
        self.assertFalse(response.json['required_models']['rerank']['available'])

    def test_reverse_geocode_rejects_invalid_coordinates(self):
        response = self.client.get('/reverse-geocode?lat=91&lng=126')

        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.json)

    def test_reverse_geocode_uses_documented_place_priority(self):
        class FakeResponse:
            def raise_for_status(self):
                pass

            def json(self):
                return {
                    'address': {
                        'city': '서울시',
                        'town': '무시할 읍',
                        'village': '무시할 마을',
                        'county': '무시할 군',
                        'state': '무시할 도',
                        'country': '무시할 국가',
                    },
                }

        with patch.object(pindrop_app.requests, 'get', return_value=FakeResponse()):
            response = self.client.get('/reverse-geocode?lat=37.5665&lng=126.9780')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {'place': '서울시'})

    def test_reverse_geocode_falls_back_to_coordinates_on_failure(self):
        with patch.object(pindrop_app.requests, 'get', side_effect=requests.RequestException('down')):
            response = self.client.get('/reverse-geocode?lat=37.5665&lng=126.9780')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['place'], '37.566, 126.978')
        self.assertIn('error', response.json)

    def test_pin_store_ignores_malformed_entries(self):
        with open(pindrop_app.PINS_FILE, 'w', encoding='utf-8') as f:
            json.dump([1, {'id': 2, 'place': 'old'}], f)

        save_response = self.client.post('/pins', json={'id': 3, 'place': 'new'})
        delete_response = self.client.delete('/pins/2')
        pins_response = self.client.get('/pins')

        self.assertEqual(save_response.status_code, 200)
        self.assertEqual(delete_response.status_code, 200)
        self.assertEqual(pins_response.json, [{
            'id': 3,
            'place': 'new',
            'regionScope': 'unknown',
            'transportMode': 'unknown',
        }])

    def test_missing_pin_store_returns_empty_list(self):
        self.assertFalse(os.path.exists(pindrop_app.PINS_FILE))

        response = self.client.get('/pins')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, [])

    def test_corrupt_pin_store_returns_empty_list(self):
        with open(pindrop_app.PINS_FILE, 'w', encoding='utf-8') as f:
            f.write('{not valid json')

        response = self.client.get('/pins')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, [])

    def test_save_pin_preserves_full_metadata(self):
        pin = {
            'id': 10,
            'lat': 37.5665,
            'lng': 126.9780,
            'place': '서울',
            'date': '2026년 05월 05일',
            'filename': 'seoul.jpg',
            'tags': ['도시', '건축'],
            'caption': '서울 도심 사진',
            'regionScope': 'domestic',
            'transportMode': 'ktx',
        }

        response = self.client.post('/pins', json=pin)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get('/pins').json, [pin])

    def test_pin_store_defaults_missing_scope_and_transport_metadata(self):
        old_pin = {'id': 12, 'place': 'old'}
        with open(pindrop_app.PINS_FILE, 'w', encoding='utf-8') as f:
            json.dump([old_pin], f)

        self.client.post('/pins', json={'id': 13, 'place': 'new'})
        pins = self.client.get('/pins').json

        self.assertEqual(pins, [
            {
                'id': 12,
                'place': 'old',
                'regionScope': 'unknown',
                'transportMode': 'unknown',
            },
            {
                'id': 13,
                'place': 'new',
                'regionScope': 'unknown',
                'transportMode': 'unknown',
            },
        ])

    def test_pin_store_preserves_supported_transport_modes(self):
        modes = ['unknown', 'bus', 'ktx', 'srt', 'rail', 'subway', 'car', 'ferry', 'airplane']

        for idx, mode in enumerate(modes, start=20):
            response = self.client.post('/pins', json={
                'id': idx,
                'place': mode,
                'regionScope': 'domestic',
                'transportMode': mode,
            })
            self.assertEqual(response.status_code, 200)

        pins = self.client.get('/pins').json

        self.assertEqual([pin['transportMode'] for pin in pins], modes)

    def test_pin_store_normalizes_invalid_transport_mode(self):
        response = self.client.post('/pins', json={
            'id': 40,
            'place': 'bad transport',
            'transportMode': 'train',
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get('/pins').json, [{
            'id': 40,
            'place': 'bad transport',
            'regionScope': 'unknown',
            'transportMode': 'unknown',
        }])

    def test_delete_pin_removes_uploaded_file(self):
        filename = 'photo.jpg'
        image_path = os.path.join(pindrop_app.UPLOAD_FOLDER, filename)
        with open(image_path, 'wb') as f:
            f.write(b'image data')
        with open(pindrop_app.PINS_FILE, 'w', encoding='utf-8') as f:
            json.dump([{'id': 4, 'filename': filename, 'lat': 37.5, 'lng': 127.0}], f)

        response = self.client.delete('/pins/4')

        self.assertEqual(response.status_code, 200)
        self.assertFalse(os.path.exists(image_path))
        self.assertEqual(self.client.get('/pins').json, [])

    def test_delete_missing_pin_returns_not_found(self):
        response = self.client.delete('/pins/404')

        self.assertEqual(response.status_code, 404)
        self.assertIn('error', response.json)

    def test_deleted_pin_does_not_reappear_after_reload(self):
        pin = {'id': 11, 'lat': 37.5, 'lng': 127.0, 'place': '서울'}
        self.client.post('/pins', json=pin)

        delete_response = self.client.delete('/pins/11')
        reload_response = self.client.get('/pins')

        self.assertEqual(delete_response.status_code, 200)
        self.assertEqual(reload_response.json, [])

    def test_delete_pin_keeps_upload_used_by_another_pin(self):
        filename = 'shared.jpg'
        image_path = os.path.join(pindrop_app.UPLOAD_FOLDER, filename)
        with open(image_path, 'wb') as f:
            f.write(b'image data')
        with open(pindrop_app.PINS_FILE, 'w', encoding='utf-8') as f:
            json.dump([
                {'id': 4, 'filename': filename, 'lat': 37.5, 'lng': 127.0},
                {'id': 5, 'filename': filename, 'lat': 35.1, 'lng': 129.0},
            ], f)

        response = self.client.delete('/pins/4')

        self.assertEqual(response.status_code, 200)
        self.assertTrue(os.path.exists(image_path))
        self.assertEqual(len(self.client.get('/pins').json), 1)

    def test_import_pins_replaces_store_with_valid_pins(self):
        response = self.client.post('/pins/import', json=[
            {'id': 7, 'lat': 37.5, 'lng': 127.0, 'place': '서울'},
            {'id': 8, 'lat': 35.1},
            'bad',
        ])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['count'], 1)
        self.assertEqual(self.client.get('/pins').json, [
            {
                'id': 7,
                'lat': 37.5,
                'lng': 127.0,
                'place': '서울',
                'regionScope': 'unknown',
                'transportMode': 'unknown',
            },
        ])

    def test_index_pin_upserts_metadata_document_and_embedding(self):
        filename = 'indexed.jpg'
        Image.new('RGB', (1, 1), color=(255, 0, 0)).save(
            os.path.join(pindrop_app.UPLOAD_FOLDER, filename),
        )

        class FakeVector(list):
            def tolist(self):
                return list(self)

        class FakeClip:
            def encode(self, value):
                if isinstance(value, str):
                    return FakeVector([4.0, 6.0])
                return FakeVector([2.0, 4.0])

        class FakeCollection:
            def __init__(self):
                self.upserts = []

            def upsert(self, **kwargs):
                self.upserts.append(kwargs)

        collection = FakeCollection()
        with (
            patch.object(pindrop_app, 'get_clip', return_value=FakeClip()),
            patch.object(pindrop_app, 'get_collection', return_value=collection),
        ):
            response = self.client.post('/index', json={
                'id': 12,
                'filename': filename,
                'place': 'Seoul',
                'date': '2026-05-05',
                'tags': ['food', 'city'],
                'caption': 'Dinner by the river',
                'regionScope': 'domestic',
                'transportMode': 'ktx',
                'lat': 0,
                'lng': 0,
            })

        self.assertEqual(response.status_code, 200)
        upsert = collection.upserts[0]
        self.assertEqual(upsert['ids'], ['12'])
        self.assertEqual(upsert['embeddings'], [[3.0, 5.0]])
        self.assertEqual(upsert['metadatas'], [{
            'pin_id': 12,
            'filename': filename,
            'place': 'Seoul',
            'date': '2026-05-05',
            'tags': json.dumps(['food', 'city'], ensure_ascii=False),
            'caption': 'Dinner by the river',
            'regionScope': 'domestic',
            'transportMode': 'ktx',
            'lat': 0,
            'lng': 0,
        }])
        document = upsert['documents'][0]
        self.assertIn(filename, document)
        self.assertIn('Seoul', document)
        self.assertIn('food, city', document)
        self.assertIn('Dinner by the river', document)
        self.assertIn('domestic', document)
        self.assertIn('ktx', document)
        self.assertIn('0.00', document)

    def test_index_pin_returns_clear_error_for_missing_file(self):
        response = self.client.post('/index', json={'id': 13, 'filename': 'missing.jpg'})

        self.assertEqual(response.status_code, 404)
        self.assertIn('error', response.json)

    def test_index_pin_returns_clear_error_when_embedding_fails(self):
        filename = 'broken.jpg'
        Image.new('RGB', (1, 1), color=(255, 0, 0)).save(
            os.path.join(pindrop_app.UPLOAD_FOLDER, filename),
        )

        with patch.object(pindrop_app, 'get_clip', side_effect=RuntimeError('clip unavailable')):
            response = self.client.post('/index', json={'id': 14, 'filename': filename})

        self.assertEqual(response.status_code, 500)
        self.assertIn('clip unavailable', response.json['error'])

    def test_reindex_rebuilds_only_missing_saved_files(self):
        Image.new('RGB', (1, 1), color=(255, 0, 0)).save(
            os.path.join(pindrop_app.UPLOAD_FOLDER, 'already.jpg'),
        )
        Image.new('RGB', (1, 1), color=(0, 255, 0)).save(
            os.path.join(pindrop_app.UPLOAD_FOLDER, 'missing-index.jpg'),
        )
        with open(pindrop_app.PINS_FILE, 'w', encoding='utf-8') as f:
            json.dump([
                {'id': 1, 'filename': 'already.jpg', 'place': 'Seoul'},
                {
                    'id': 2,
                    'filename': 'missing-index.jpg',
                    'place': 'Busan',
                    'date': '2026-05-05',
                    'tags': ['food'],
                    'caption': 'Seafood dinner',
                    'lat': 35.1796,
                    'lng': 129.0756,
                    'regionScope': 'domestic',
                    'transportMode': 'ferry',
                },
                {'id': 3, 'place': 'No file'},
                {'id': 4, 'filename': 'not-on-disk.jpg', 'place': 'Missing file'},
            ], f)

        class FakeVector(list):
            def tolist(self):
                return list(self)

        class FakeClip:
            def encode(self, value):
                if isinstance(value, str):
                    return FakeVector([8.0, 10.0])
                return FakeVector([2.0, 4.0])

        class FakeCollection:
            def __init__(self):
                self.upserts = []

            def count(self):
                return 1

            def get(self):
                return {'ids': ['1']}

            def upsert(self, **kwargs):
                self.upserts.append(kwargs)

        collection = FakeCollection()
        with (
            patch.object(pindrop_app, 'get_clip', return_value=FakeClip()),
            patch.object(pindrop_app, 'get_collection', return_value=collection),
        ):
            response = self.client.post('/reindex')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['reindexed'], 1)
        self.assertEqual(response.json['total'], 4)
        upsert = collection.upserts[0]
        self.assertEqual(upsert['ids'], ['2'])
        self.assertEqual(upsert['embeddings'], [[5.0, 7.0]])
        self.assertEqual(upsert['metadatas'][0]['filename'], 'missing-index.jpg')
        self.assertEqual(upsert['metadatas'][0]['lat'], 35.1796)
        self.assertEqual(upsert['metadatas'][0]['lng'], 129.0756)
        self.assertEqual(upsert['metadatas'][0]['regionScope'], 'domestic')
        self.assertEqual(upsert['metadatas'][0]['transportMode'], 'ferry')
        self.assertIn('missing-index.jpg', upsert['documents'][0])
        self.assertIn('Seafood dinner', upsert['documents'][0])
        self.assertIn('domestic', upsert['documents'][0])
        self.assertIn('ferry', upsert['documents'][0])

    def test_search_returns_empty_result_when_index_is_empty(self):
        class FakeVector(list):
            def tolist(self):
                return list(self)

        class FakeClip:
            def encode(self, value):
                return FakeVector([1.0, 2.0])

        class FakeCollection:
            def count(self):
                return 0

        with (
            patch.object(pindrop_app, 'get_clip', return_value=FakeClip()),
            patch.object(pindrop_app, 'get_collection', return_value=FakeCollection()),
        ):
            response = self.client.post('/search', json={'query': 'food'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['pin_ids'], [])
        self.assertIn('message', response.json)

    def test_search_returns_reranked_pin_ids(self):
        class FakeVector(list):
            def tolist(self):
                return list(self)

        class FakeClip:
            def encode(self, value):
                return FakeVector([1.0, 2.0])

        class FakeCollection:
            def count(self):
                return 2

            def query(self, query_embeddings, n_results):
                return {
                    'metadatas': [[{'pin_id': 46}, {'pin_id': 47}]],
                    'documents': [['first document', 'second document']],
                    'distances': [[0.1, 0.2]],
                }

        class FakeResponse:
            def raise_for_status(self):
                pass

            def json(self):
                return {'message': {'content': '[2, 1]'}}

        with (
            patch.object(pindrop_app, 'get_clip', return_value=FakeClip()),
            patch.object(pindrop_app, 'get_collection', return_value=FakeCollection()),
            patch.object(pindrop_app.requests, 'post', return_value=FakeResponse()),
        ):
            response = self.client.post('/search', json={'query': 'food'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['pin_ids'], [47, 46])
        self.assertEqual(response.json['total_candidates'], 2)

    def test_search_falls_back_when_rerank_is_unavailable(self):
        class FakeVector(list):
            def tolist(self):
                return list(self)

        class FakeClip:
            def encode(self, value):
                return FakeVector([1.0, 2.0])

        class FakeCollection:
            def count(self):
                return 2

            def query(self, query_embeddings, n_results):
                return {
                    'metadatas': [[{'pin_id': 46}, {'pin_id': 47}]],
                    'documents': [['first document', 'second document']],
                    'distances': [[0.1, 0.2]],
                }

        with (
            patch.object(pindrop_app, 'get_clip', return_value=FakeClip()),
            patch.object(pindrop_app, 'get_collection', return_value=FakeCollection()),
            patch.object(pindrop_app.requests, 'post', side_effect=requests.RequestException('down')),
        ):
            response = self.client.post('/search', json={'query': 'food'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['pin_ids'], [46, 47])

    def test_search_returns_clear_error_when_dependency_fails(self):
        with patch.object(pindrop_app, 'get_clip', side_effect=RuntimeError('clip unavailable')):
            response = self.client.post('/search', json={'query': 'food'})

        self.assertEqual(response.status_code, 500)
        self.assertIn('clip unavailable', response.json['error'])

    def test_electron_launcher_uses_auxiliary_local_web_service_contract(self):
        launcher = os.path.join(os.path.dirname(__file__), '..', 'desktop', 'main.cjs')
        with open(launcher, encoding='utf-8') as f:
            source = f.read()

        self.assertIn("const BACKEND_URL = 'http://127.0.0.1:5000';", source)
        self.assertIn('const BACKEND_PING_URL = `${BACKEND_URL}/ping`;', source)
        self.assertIn('if (await requestOk(BACKEND_PING_URL)) return;', source)
        self.assertIn("spawn(pythonPath(), ['app.py']", source)
        self.assertIn("PINDROP_HOST: process.env.PINDROP_HOST || '127.0.0.1'", source)
        self.assertIn('win.loadURL(BACKEND_URL);', source)

    def test_metadata_text_includes_zero_coordinates(self):
        text = pindrop_app.build_metadata_text({'lat': 0, 'lng': 0})

        self.assertIn('위도 0.00 경도 0.00', text)

    def test_model_availability_accepts_latest_tag(self):
        self.assertTrue(pindrop_app.has_model(['llama3.2:latest'], 'llama3.2'))
        self.assertFalse(pindrop_app.has_model(['llama3.2:latest'], 'llama3.2-vision'))

    def test_gps_fixture_has_exif_gps_and_uploads(self):
        fixture = os.path.join(os.path.dirname(__file__), 'fixtures', 'gps_photo.jpg')
        with Image.open(fixture) as image:
            gps = image.getexif().get_ifd(34853)

        with open(fixture, 'rb') as f:
            response = self.client.post(
                '/upload',
                data={'file': (f, 'gps_photo.jpg')},
                content_type='multipart/form-data',
            )

        self.assertTrue(gps)
        self.assertEqual(response.status_code, 200)


if __name__ == '__main__':
    unittest.main()
