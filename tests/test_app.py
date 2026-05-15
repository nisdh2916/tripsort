import io
import hashlib
import json
import os
import tempfile
import unittest
import zipfile
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

    def assert_default_source_photo(self, source, original='', stored=''):
        self.assertEqual(source, {
            'originalFilename': original,
            'storedFilename': stored,
            'mimeType': '',
            'fileSize': None,
            'importedAt': '',
        })

    def assert_default_organization(self, organization, place='', date='', reason=None, status='pending', output_path=None):
        expected_reason = reason
        if expected_reason is None:
            expected_reason = (
                'Place candidate came from existing photo metadata.'
                if place else
                'Place has not been resolved yet.'
            )
        self.assertEqual(organization, {
            'candidateCaptureDate': date,
            'candidatePlace': place,
            'confidence': 'unknown',
            'reason': expected_reason,
            'status': status,
            'outputPath': output_path or organization.get('outputPath', ''),
        })

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

    def test_safe_path_segment_replaces_windows_invalid_characters(self):
        self.assertEqual(
            pindrop_app.safe_path_segment('Seoul:Busan/Trip*?', 'Unknown'),
            'Seoul_Busan_Trip',
        )

    def test_safe_output_filename_uses_fallback_for_empty_names(self):
        self.assertEqual(pindrop_app.safe_output_filename(' .<> ', 'photo'), 'photo')
        self.assertEqual(pindrop_app.safe_output_filename(None, 'photo'), 'photo')

    def test_safe_path_segment_prevents_traversal_segments(self):
        segment = pindrop_app.safe_path_segment('../..\\secret', 'Unknown')

        self.assertEqual(segment, 'secret')
        self.assertNotIn('..', segment)
        self.assertNotIn('/', segment)
        self.assertNotIn('\\', segment)

    def test_output_paths_apply_deterministic_duplicate_suffixes(self):
        pins = [
            {
                'id': 1,
                'sourcePhoto': {'originalFilename': 'IMG?.JPG'},
                'organization': {
                    'candidateCaptureDate': '2026-05-10',
                    'candidatePlace': 'Seoul',
                },
            },
            {
                'id': 2,
                'sourcePhoto': {'originalFilename': 'IMG?.jpg'},
                'organization': {
                    'candidateCaptureDate': '2026-05-10',
                    'candidatePlace': 'Seoul',
                },
            },
            {
                'id': 3,
                'sourcePhoto': {'originalFilename': 'IMG?.jpg'},
                'organization': {
                    'candidateCaptureDate': '2026-05-11',
                    'candidatePlace': 'Seoul',
                },
            },
        ]

        self.assertEqual(pindrop_app.build_output_paths(pins), [
            {'id': 1, 'outputPath': 'Trip_2026-05-10_to_2026-05-11_Seoul/2026-05-10_Seoul/IMG.jpg'},
            {'id': 2, 'outputPath': 'Trip_2026-05-10_to_2026-05-11_Seoul/2026-05-10_Seoul/IMG-2.jpg'},
            {'id': 3, 'outputPath': 'Trip_2026-05-10_to_2026-05-11_Seoul/2026-05-11_Seoul/IMG.jpg'},
        ])

    def test_output_path_uses_safe_unknown_fallbacks(self):
        path = pindrop_app.output_path_for_pin({
            'id': 4,
            'filename': '../bad:name.jpg',
            'organization': {
                'candidateCaptureDate': '',
                'candidatePlace': '..\\',
            },
        })

        self.assertEqual(path, 'Unknown Date_Unknown Location/bad_name.jpg')
        self.assertNotIn('..', path)

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
        self.assertEqual(first.json['originalFilename'], 'photo.jpg')
        self.assertEqual(first.json['storedFilename'], first.json['filename'])
        self.assertEqual(first.json['mimeType'], 'image/jpeg')
        self.assertEqual(first.json['fileSize'], len(b'first'))
        self.assertIn('uploadedAt', first.json)
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
        for path in ['/tag', '/caption', '/infer-place', '/index', '/search', '/pins']:
            with self.subTest(path=path):
                response = self.client.post(path, data='null', content_type='application/json')

                self.assertEqual(response.status_code, 400)
                self.assertIn('error', response.json)

    def test_json_object_endpoints_reject_non_object_bodies_without_500(self):
        for body in ['[]', '"bad"']:
            for path in ['/tag', '/caption', '/infer-place', '/index', '/search', '/pins']:
                with self.subTest(body=body, path=path):
                    response = self.client.post(path, data=body, content_type='application/json')

                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(response.json, {'error': 'JSON object body required'})

    def test_valid_json_object_body_still_works(self):
        response = self.client.post('/pins', json={'id': 9, 'place': '서울'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {'ok': True})
        pin = self.client.get('/pins').json[0]
        self.assertEqual(pin['id'], 9)
        self.assertEqual(pin['place'], '서울')
        self.assertEqual(pin['regionScope'], 'unknown')
        self.assertEqual(pin['transportMode'], 'unknown')
        self.assert_default_source_photo(pin['sourcePhoto'])
        self.assert_default_organization(pin['organization'], place='서울')

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

    def test_infer_place_returns_unavailable_when_vlm_model_is_missing(self):
        image_path = os.path.join(pindrop_app.UPLOAD_FOLDER, 'photo.jpg')
        with open(image_path, 'wb') as f:
            f.write(b'fake image data')

        class FakeTagsResponse:
            ok = True

            def json(self):
                return {'models': [{'name': 'llama3.2:latest'}]}

        with (
            patch.object(pindrop_app.requests, 'get', return_value=FakeTagsResponse()),
            patch.object(pindrop_app.requests, 'post') as post_mock,
        ):
            response = self.client.post('/infer-place', json={'filename': 'photo.jpg'})

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json['available'])
        self.assertEqual(response.json['place'], '')
        self.assertEqual(response.json['confidence'], 'unavailable')
        self.assertIn('llama3.2-vision', response.json['reason'])
        post_mock.assert_not_called()

    def test_infer_place_sends_weak_clues_and_returns_structured_result(self):
        image_path = os.path.join(pindrop_app.UPLOAD_FOLDER, 'photo.jpg')
        with open(image_path, 'wb') as f:
            f.write(b'fake image data')
        captured = {}

        class FakeTagsResponse:
            ok = True

            def json(self):
                return {'models': [{'name': 'llama3.2-vision:latest'}]}

        class FakeInferenceResponse:
            def raise_for_status(self):
                pass

            def json(self):
                return {
                    'message': {
                        'content': json.dumps({
                            'place': 'N Seoul Tower',
                            'city': 'Seoul',
                            'country': 'South Korea',
                            'landmark': 'N Seoul Tower',
                            'sceneType': 'city skyline',
                            'confidence': 'medium',
                            'reason': 'Visible tower and city skyline.',
                        }),
                    },
                }

        def fake_post(_url, json, timeout):
            captured['json'] = json
            captured['timeout'] = timeout
            return FakeInferenceResponse()

        with (
            patch.object(pindrop_app.requests, 'get', return_value=FakeTagsResponse()),
            patch.object(pindrop_app.requests, 'post', side_effect=fake_post),
        ):
            response = self.client.post('/infer-place', json={
                'filename': 'photo.jpg',
                'originalFilename': 'seoul-night.jpg',
                'sourceFolder': 'Korea Trip',
            })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {
            'available': True,
            'place': 'N Seoul Tower',
            'city': 'Seoul',
            'country': 'South Korea',
            'landmark': 'N Seoul Tower',
            'sceneType': 'city skyline',
            'confidence': 'medium',
            'reason': 'Visible tower and city skyline.',
            'tripSignals': {
                'city': 'Seoul',
                'country': 'South Korea',
                'landmark': 'N Seoul Tower',
                'sceneType': 'city skyline',
                'confidence': 'medium',
                'reason': 'Visible tower and city skyline.',
                'source': 'vlm',
            },
        })
        prompt = captured['json']['messages'][0]['content']
        self.assertEqual(captured['json']['model'], 'llama3.2-vision')
        self.assertEqual(captured['timeout'], 90)
        self.assertIn('landmarks', prompt)
        self.assertIn('signs', prompt)
        self.assertIn('venue names', prompt)
        self.assertIn('broad scene context', prompt)
        self.assertIn('city', prompt)
        self.assertIn('country', prompt)
        self.assertIn('sceneType', prompt)
        self.assertIn('uncertainty', prompt)
        self.assertIn('seoul-night.jpg', prompt)
        self.assertIn('Korea Trip', prompt)
        self.assertIn('weak clues', prompt)
        self.assertTrue(captured['json']['messages'][0]['images'][0])

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

    def test_gps_resolved_place_uses_safe_folder_name(self):
        path = pindrop_app.output_path_for_pin({
            'id': 20,
            'regionScope': 'domestic',
            'sourcePhoto': {'originalFilename': 'photo.jpg'},
            'organization': {
                'candidateCaptureDate': '2026-05-10',
                'candidatePlace': 'Seoul:City/Center',
            },
        })

        self.assertEqual(path, '2026-05-10_Seoul_City_Center/photo.jpg')
        self.assertNotIn('domestic', path)

    def test_gps_place_failure_coordinate_fallback_can_be_grouped(self):
        path = pindrop_app.output_path_for_pin({
            'id': 21,
            'sourcePhoto': {'originalFilename': 'fallback.jpg'},
            'organization': {
                'candidateCaptureDate': '2026-05-10',
                'candidatePlace': '37.566, 126.978',
            },
        })

        self.assertEqual(path, '2026-05-10_37.566, 126.978/fallback.jpg')

    def test_pin_store_ignores_malformed_entries(self):
        with open(pindrop_app.PINS_FILE, 'w', encoding='utf-8') as f:
            json.dump([1, {'id': 2, 'place': 'old'}], f)

        save_response = self.client.post('/pins', json={'id': 3, 'place': 'new'})
        delete_response = self.client.delete('/pins/2')
        pins_response = self.client.get('/pins')

        self.assertEqual(save_response.status_code, 200)
        self.assertEqual(delete_response.status_code, 200)
        pin = pins_response.json[0]
        self.assertEqual(pin['id'], 3)
        self.assertEqual(pin['place'], 'new')
        self.assertEqual(pin['regionScope'], 'unknown')
        self.assertEqual(pin['transportMode'], 'unknown')
        self.assert_default_source_photo(pin['sourcePhoto'])
        self.assert_default_organization(pin['organization'], place='new')

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
            'sourcePhoto': {
                'originalFilename': 'IMG_0001.JPG',
                'storedFilename': 'seoul.jpg',
                'mimeType': 'image/jpeg',
                'fileSize': 12345,
                'importedAt': '2026-05-10T12:00:00Z',
            },
            'organization': {
                'candidateCaptureDate': '2026년 05월 05일',
                'candidatePlace': '서울',
                'confidence': 'high',
                'reason': 'Place candidate came from EXIF GPS reverse geocoding.',
                'status': 'ready',
                'outputPath': 'Trip_Unknown Date_서울/2026년 05월 05일_서울/IMG_0001.jpg',
            },
        }

        response = self.client.post('/pins', json=pin)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get('/pins').json, [pin])

    def test_save_pin_preserves_gps_missing_organization_metadata(self):
        pin = {
            'id': 15,
            'place': 'Unknown Location',
            'date': None,
            'filename': 'screenshot.jpg',
            'regionScope': 'unknown',
            'transportMode': 'unknown',
            'sourcePhoto': {
                'originalFilename': 'Screenshot.jpg',
                'storedFilename': 'screenshot.jpg',
                'mimeType': 'image/jpeg',
                'fileSize': 2048,
                'importedAt': '2026-05-10T12:01:00Z',
            },
            'organization': {
                'candidateCaptureDate': '',
                'candidatePlace': 'Unknown Location',
                'confidence': 'low',
                'reason': 'GPS metadata is missing; VLM inference is pending.',
                'status': 'needs_inference',
                'outputPath': 'Trip_Unknown Date_Unknown Location/Unknown Date_Unknown Location/Screenshot.jpg',
            },
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

        self.assertEqual([pin['id'] for pin in pins], [12, 13])
        self.assertEqual([pin['place'] for pin in pins], ['old', 'new'])
        for pin in pins:
            self.assertEqual(pin['regionScope'], 'unknown')
            self.assertEqual(pin['transportMode'], 'unknown')
            self.assert_default_source_photo(pin['sourcePhoto'])
            self.assert_default_organization(pin['organization'], place=pin['place'])

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
        pin = self.client.get('/pins').json[0]
        self.assertEqual(pin['id'], 40)
        self.assertEqual(pin['place'], 'bad transport')
        self.assertEqual(pin['regionScope'], 'unknown')
        self.assertEqual(pin['transportMode'], 'unknown')
        self.assert_default_source_photo(pin['sourcePhoto'])
        self.assert_default_organization(pin['organization'], place='bad transport')

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
        pin = self.client.get('/pins').json[0]
        self.assertEqual(pin['id'], 7)
        self.assertEqual(pin['lat'], 37.5)
        self.assertEqual(pin['lng'], 127.0)
        self.assertEqual(pin['place'], '서울')
        self.assertEqual(pin['regionScope'], 'unknown')
        self.assertEqual(pin['transportMode'], 'unknown')
        self.assert_default_source_photo(pin['sourcePhoto'])
        self.assert_default_organization(
            pin['organization'],
            place='서울',
            reason='Place candidate came from GPS reverse geocoding.',
        )

    def test_organization_preview_builds_known_date_place_paths(self):
        self.client.post('/pins', json={
            'id': 30,
            'sourcePhoto': {'originalFilename': 'photo.jpg'},
            'organization': {
                'candidateCaptureDate': '2026-05-10',
                'candidatePlace': 'Seoul',
            },
        })

        response = self.client.get('/organization/preview')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {
            'items': [
                {'id': 30, 'outputPath': 'Trip_2026-05-10_Seoul/2026-05-10_Seoul/photo.jpg'},
            ],
        })

    def test_organization_preview_wraps_photos_in_trip_folder(self):
        self.client.post('/pins', json={
            'id': 300,
            'sourcePhoto': {'originalFilename': 'arrival.jpg'},
            'organization': {
                'candidateCaptureDate': '2026-05-01',
                'candidatePlace': 'Jeju City',
            },
        })
        self.client.post('/pins', json={
            'id': 301,
            'sourcePhoto': {'originalFilename': 'beach.jpg'},
            'organization': {
                'candidateCaptureDate': '2026-05-04',
                'candidatePlace': 'Seogwipo',
            },
        })

        response = self.client.get('/organization/preview')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {
            'items': [
                {
                    'id': 300,
                    'outputPath': 'Trip_2026-05-01_to_2026-05-04_Jeju City/2026-05-01_Jeju City/arrival.jpg',
                },
                {
                    'id': 301,
                    'outputPath': 'Trip_2026-05-01_to_2026-05-04_Jeju City/2026-05-04_Seogwipo/beach.jpg',
                },
            ],
        })

    def test_organization_preview_splits_import_session_by_large_date_gaps(self):
        for pin in [
            {
                'id': 310,
                'sourcePhoto': {'originalFilename': 'arrival.jpg'},
                'organization': {
                    'tripId': 'import-1',
                    'candidateCaptureDate': '2026-05-01',
                    'candidatePlace': 'Jeju City',
                },
            },
            {
                'id': 311,
                'sourcePhoto': {'originalFilename': 'beach.jpg'},
                'organization': {
                    'tripId': 'import-1',
                    'candidateCaptureDate': '2026-05-02',
                    'candidatePlace': 'Seogwipo',
                },
            },
            {
                'id': 312,
                'sourcePhoto': {'originalFilename': 'tokyo.jpg'},
                'organization': {
                    'tripId': 'import-1',
                    'candidateCaptureDate': '2026-05-10',
                    'candidatePlace': 'Tokyo',
                },
            },
        ]:
            self.client.post('/pins', json=pin)

        response = self.client.get('/organization/preview')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {
            'items': [
                {
                    'id': 310,
                    'outputPath': 'Trip_2026-05-01_to_2026-05-02_Jeju City/2026-05-01_Jeju City/arrival.jpg',
                },
                {
                    'id': 311,
                    'outputPath': 'Trip_2026-05-01_to_2026-05-02_Jeju City/2026-05-02_Seogwipo/beach.jpg',
                },
                {
                    'id': 312,
                    'outputPath': 'Trip_2026-05-10_Tokyo/2026-05-10_Tokyo/tokyo.jpg',
                },
            ],
        })

    def test_organization_preview_splits_import_session_by_trip_signals(self):
        for pin in [
            {
                'id': 330,
                'sourcePhoto': {'originalFilename': 'seoul.jpg'},
                'organization': {
                    'tripId': 'signal-trip',
                    'candidateCaptureDate': '2026-05-01',
                    'candidatePlace': 'Seoul',
                    'tripSignals': {
                        'city': 'Seoul',
                        'country': 'South Korea',
                        'confidence': 'high',
                    },
                },
            },
            {
                'id': 331,
                'sourcePhoto': {'originalFilename': 'tokyo.jpg'},
                'organization': {
                    'tripId': 'signal-trip',
                    'candidateCaptureDate': '2026-05-02',
                    'candidatePlace': 'Tokyo',
                    'tripSignals': {
                        'city': 'Tokyo',
                        'country': 'Japan',
                        'confidence': 'medium',
                    },
                },
            },
        ]:
            self.client.post('/pins', json=pin)

        response = self.client.get('/organization/preview')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {
            'items': [
                {
                    'id': 330,
                    'outputPath': 'Trip_2026-05-01_Seoul/2026-05-01_Seoul/seoul.jpg',
                },
                {
                    'id': 331,
                    'outputPath': 'Trip_2026-05-02_Tokyo/2026-05-02_Tokyo/tokyo.jpg',
                },
            ],
        })

    def test_organization_preview_keeps_large_date_gap_with_same_trip_signals(self):
        for pin in [
            {
                'id': 332,
                'sourcePhoto': {'originalFilename': 'day-one.jpg'},
                'organization': {
                    'tripId': 'same-signal-trip',
                    'candidateCaptureDate': '2026-05-01',
                    'candidatePlace': 'Seoul',
                    'tripSignals': {
                        'city': 'Seoul',
                        'country': 'South Korea',
                        'confidence': 'high',
                    },
                },
            },
            {
                'id': 333,
                'sourcePhoto': {'originalFilename': 'day-eight.jpg'},
                'organization': {
                    'tripId': 'same-signal-trip',
                    'candidateCaptureDate': '2026-05-08',
                    'candidatePlace': 'Seoul',
                    'tripSignals': {
                        'city': 'Seoul',
                        'country': 'South Korea',
                        'confidence': 'medium',
                    },
                },
            },
        ]:
            self.client.post('/pins', json=pin)

        response = self.client.get('/organization/preview')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {
            'items': [
                {
                    'id': 332,
                    'outputPath': 'Trip_2026-05-01_to_2026-05-08_Seoul/2026-05-01_Seoul/day-one.jpg',
                },
                {
                    'id': 333,
                    'outputPath': 'Trip_2026-05-01_to_2026-05-08_Seoul/2026-05-08_Seoul/day-eight.jpg',
                },
            ],
        })

    def test_organization_preview_manual_trip_group_overrides_auto_split(self):
        for pin in [
            {
                'id': 334,
                'sourcePhoto': {'originalFilename': 'seoul.jpg'},
                'organization': {
                    'tripId': 'manual-merge-source',
                    'tripGroupId': 'manual-group-1',
                    'candidateCaptureDate': '2026-05-01',
                    'candidatePlace': 'Seoul',
                    'tripSignals': {
                        'city': 'Seoul',
                        'country': 'South Korea',
                        'confidence': 'high',
                    },
                },
            },
            {
                'id': 335,
                'sourcePhoto': {'originalFilename': 'tokyo.jpg'},
                'organization': {
                    'tripId': 'manual-merge-source',
                    'tripGroupId': 'manual-group-1',
                    'candidateCaptureDate': '2026-05-02',
                    'candidatePlace': 'Tokyo',
                    'tripSignals': {
                        'city': 'Tokyo',
                        'country': 'Japan',
                        'confidence': 'high',
                    },
                },
            },
        ]:
            self.client.post('/pins', json=pin)

        response = self.client.get('/organization/preview')
        stored_pins = self.client.get('/pins').json

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {
            'items': [
                {
                    'id': 334,
                    'outputPath': 'Trip_2026-05-01_to_2026-05-02_Seoul/2026-05-01_Seoul/seoul.jpg',
                },
                {
                    'id': 335,
                    'outputPath': 'Trip_2026-05-01_to_2026-05-02_Seoul/2026-05-02_Tokyo/tokyo.jpg',
                },
            ],
        })
        self.assertEqual(stored_pins[0]['organization']['tripGroupId'], 'manual-group-1')
        self.assertEqual(stored_pins[1]['organization']['tripGroupId'], 'manual-group-1')

    def test_organization_preview_uses_manual_trip_name(self):
        for pin in [
            {
                'id': 320,
                'sourcePhoto': {'originalFilename': 'arrival.jpg'},
                'organization': {
                    'tripId': 'import-jeju',
                    'tripName': 'Jeju Spring 2026',
                    'candidateCaptureDate': '2026-05-01',
                    'candidatePlace': 'Jeju City',
                },
            },
            {
                'id': 321,
                'sourcePhoto': {'originalFilename': 'beach.jpg'},
                'organization': {
                    'tripId': 'import-jeju',
                    'candidateCaptureDate': '2026-05-02',
                    'candidatePlace': 'Seogwipo',
                },
            },
        ]:
            self.client.post('/pins', json=pin)

        response = self.client.get('/organization/preview')
        stored_pin = self.client.get('/pins').json[0]

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {
            'items': [
                {
                    'id': 320,
                    'outputPath': 'Jeju Spring 2026/2026-05-01_Jeju City/arrival.jpg',
                },
                {
                    'id': 321,
                    'outputPath': 'Jeju Spring 2026/2026-05-02_Seogwipo/beach.jpg',
                },
            ],
        })
        self.assertEqual(stored_pin['organization']['tripName'], 'Jeju Spring 2026')

    def test_organization_preview_uses_unknown_fallbacks(self):
        self.client.post('/pins', json={
            'id': 31,
            'sourcePhoto': {'originalFilename': 'screenshot.png'},
        })

        response = self.client.get('/organization/preview')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {
            'items': [
                {
                    'id': 31,
                    'outputPath': 'Trip_Unknown Date_Unknown Location/Unknown Date_Unknown Location/screenshot.png',
                },
            ],
        })

    def test_organization_preview_deduplicates_output_paths(self):
        for pin_id in [32, 33]:
            self.client.post('/pins', json={
                'id': pin_id,
                'sourcePhoto': {'originalFilename': 'IMG?.JPG'},
                'organization': {
                    'candidateCaptureDate': '2026-05-10',
                    'candidatePlace': 'Seoul:City',
                },
            })

        response = self.client.get('/organization/preview')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {
            'items': [
                {
                    'id': 32,
                    'outputPath': 'Trip_2026-05-10_Seoul_City/2026-05-10_Seoul_City/IMG.jpg',
                },
                {
                    'id': 33,
                    'outputPath': 'Trip_2026-05-10_Seoul_City/2026-05-10_Seoul_City/IMG-2.jpg',
                },
            ],
        })

    def test_organization_preview_uses_candidate_filename(self):
        self.client.post('/pins', json={
            'id': 35,
            'sourcePhoto': {'originalFilename': 'IMG_0001.JPG'},
            'organization': {
                'candidateCaptureDate': '2026-05-10',
                'candidatePlace': 'Seoul',
                'candidateFilename': 'Trip Day 1?.jpg',
            },
        })

        response = self.client.get('/organization/preview')
        stored_pin = self.client.get('/pins').json[0]

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {
            'items': [
                {'id': 35, 'outputPath': 'Trip_2026-05-10_Seoul/2026-05-10_Seoul/Trip Day 1.jpg'},
            ],
        })
        self.assertEqual(stored_pin['organization']['candidateFilename'], 'Trip Day 1?.jpg')
        self.assertEqual(
            stored_pin['organization']['outputPath'],
            'Trip_2026-05-10_Seoul/2026-05-10_Seoul/Trip Day 1.jpg',
        )

    def test_pin_store_persists_organization_preview_state(self):
        self.client.post('/pins', json={
            'id': 34,
            'sourcePhoto': {'originalFilename': 'photo.jpg'},
            'organization': {
                'candidateCaptureDate': '2026-05-10',
                'candidatePlace': 'Seoul',
                'confidence': 'medium',
                'reason': 'Visible landmark.',
                'status': 'ready',
            },
        })

        with open(pindrop_app.PINS_FILE, 'r', encoding='utf-8') as f:
            stored = json.load(f)
        response = self.client.get('/pins')

        self.assertEqual(stored[0]['organization'], {
            'candidateCaptureDate': '2026-05-10',
            'candidatePlace': 'Seoul',
            'confidence': 'medium',
            'reason': 'Visible landmark.',
            'status': 'ready',
            'outputPath': 'Trip_2026-05-10_Seoul/2026-05-10_Seoul/photo.jpg',
        })
        self.assertEqual(response.json[0]['organization'], stored[0]['organization'])

    def test_organization_zip_export_uses_preview_paths_and_manifest(self):
        first_bytes = b'first original bytes'
        second_bytes = b'second original bytes'
        with open(os.path.join(pindrop_app.UPLOAD_FOLDER, 'first.jpg'), 'wb') as f:
            f.write(first_bytes)
        with open(os.path.join(pindrop_app.UPLOAD_FOLDER, 'second.jpg'), 'wb') as f:
            f.write(second_bytes)
        self.client.post('/pins', json={
            'id': 36,
            'sourcePhoto': {
                'originalFilename': 'IMG_0001.JPG',
                'storedFilename': 'first.jpg',
            },
            'organization': {
                'candidateCaptureDate': '2026-05-10',
                'candidatePlace': 'Seoul',
                'confidence': 'high',
                'reason': 'GPS reverse geocoding.',
                'status': 'ready',
            },
        })
        self.client.post('/pins', json={
            'id': 37,
            'sourcePhoto': {
                'originalFilename': 'Screenshot.png',
                'storedFilename': 'second.jpg',
            },
        })
        preview_paths = [
            item['outputPath']
            for item in self.client.get('/organization/preview').json['items']
        ]

        response = self.client.get('/organization/export.zip')

        self.assertEqual(response.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(response.data)) as zf:
            self.assertEqual(
                sorted(name for name in zf.namelist() if name != 'manifest.json'),
                sorted(preview_paths),
            )
            self.assertEqual(zf.read(preview_paths[0]), first_bytes)
            self.assertEqual(zf.read(preview_paths[1]), second_bytes)
            manifest = json.loads(zf.read('manifest.json').decode('utf-8'))

        self.assertEqual(manifest, {
            'photos': [
                {
                    'id': 36,
                    'originalFilename': 'IMG_0001.JPG',
                    'storedFilename': 'first.jpg',
                    'outputPath': 'Trip_2026-05-10_Seoul/2026-05-10_Seoul/IMG_0001.jpg',
                    'date': '2026-05-10',
                    'place': 'Seoul',
                    'confidence': 'high',
                    'reason': 'GPS reverse geocoding.',
                },
                {
                    'id': 37,
                    'originalFilename': 'Screenshot.png',
                    'storedFilename': 'second.jpg',
                    'outputPath': 'Trip_2026-05-10_Seoul/Unknown Date_Unknown Location/Screenshot.png',
                    'date': 'Unknown Date',
                    'place': 'Unknown Location',
                    'confidence': 'unknown',
                    'reason': 'Place has not been resolved yet.',
                },
            ],
        })

    def test_organization_zip_export_fails_gracefully_for_missing_upload(self):
        self.client.post('/pins', json={
            'id': 38,
            'sourcePhoto': {
                'originalFilename': 'missing.jpg',
                'storedFilename': 'missing.jpg',
            },
            'organization': {
                'candidateCaptureDate': '2026-05-10',
                'candidatePlace': 'Seoul',
            },
        })

        response = self.client.get('/organization/export.zip')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json['error'], 'One or more stored uploads are missing.')
        self.assertEqual(response.json['missing'], [
            {
                'id': 38,
                'storedFilename': 'missing.jpg',
                'outputPath': 'Trip_2026-05-10_Seoul/2026-05-10_Seoul/missing.jpg',
                'reason': 'stored upload is missing',
            },
        ])

    def test_organization_zip_export_preserves_source_upload_bytes(self):
        source_bytes = bytes(range(256))
        source_path = os.path.join(pindrop_app.UPLOAD_FOLDER, 'bytes.jpg')
        with open(source_path, 'wb') as f:
            f.write(source_bytes)
        self.client.post('/pins', json={
            'id': 39,
            'sourcePhoto': {
                'originalFilename': 'bytes.jpg',
                'storedFilename': 'bytes.jpg',
            },
            'organization': {
                'candidateCaptureDate': '2026-05-10',
                'candidatePlace': 'Seoul',
            },
        })

        response = self.client.get('/organization/export.zip')

        self.assertEqual(response.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(response.data)) as zf:
            exported_bytes = zf.read('Trip_2026-05-10_Seoul/2026-05-10_Seoul/bytes.jpg')
        self.assertEqual(
            hashlib.sha256(exported_bytes).hexdigest(),
            hashlib.sha256(source_bytes).hexdigest(),
        )

    def test_mixed_photo_organization_demo_verifies_preview_zip_and_hashes(self):
        photos = [
            ('gps.jpg', b'gps original bytes', {
                'id': 70,
                'lat': 37.5665,
                'lng': 126.978,
                'place': 'Seoul',
                'date': '2026-05-10',
                'sourcePhoto': {'originalFilename': 'gps.jpg', 'storedFilename': 'gps.jpg'},
                'organization': {
                    'candidateCaptureDate': '2026-05-10',
                    'candidatePlace': 'Seoul',
                    'confidence': 'high',
                    'reason': 'GPS reverse geocoding.',
                    'status': 'ready',
                },
            }),
            ('vlm.jpg', b'vlm original bytes', {
                'id': 71,
                'place': 'N Seoul Tower',
                'sourcePhoto': {'originalFilename': 'vlm.jpg', 'storedFilename': 'vlm.jpg'},
                'organization': {
                    'candidateCaptureDate': '2026-05-10',
                    'candidatePlace': 'N Seoul Tower',
                    'confidence': 'medium',
                    'reason': 'Vision model found a landmark.',
                    'status': 'ready',
                },
            }),
            ('fallback.jpg', b'fallback original bytes', {
                'id': 72,
                'place': 'Unknown Location',
                'sourcePhoto': {'originalFilename': 'fallback.jpg', 'storedFilename': 'fallback.jpg'},
                'organization': {
                    'candidateCaptureDate': '',
                    'candidatePlace': 'Unknown Location',
                    'confidence': 'low',
                    'reason': 'No reliable place clues.',
                    'status': 'fallback',
                },
            }),
        ]
        for filename, data, pin in photos:
            with open(os.path.join(pindrop_app.UPLOAD_FOLDER, filename), 'wb') as f:
                f.write(data)
            self.client.post('/pins', json=pin)

        preview = self.client.get('/organization/preview').json['items']
        response = self.client.get('/organization/export.zip')

        self.assertEqual(preview, [
            {'id': 70, 'outputPath': 'Trip_2026-05-10_Seoul/2026-05-10_Seoul/gps.jpg'},
            {'id': 71, 'outputPath': 'Trip_2026-05-10_Seoul/2026-05-10_N Seoul Tower/vlm.jpg'},
            {
                'id': 72,
                'outputPath': 'Trip_2026-05-10_Seoul/Unknown Date_Unknown Location/fallback.jpg',
            },
        ])
        self.assertEqual(response.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(response.data)) as zf:
            names = set(zf.namelist())
            self.assertTrue({item['outputPath'] for item in preview}.issubset(names))
            for filename, source_bytes, pin in photos:
                output_path = next(item['outputPath'] for item in preview if item['id'] == pin['id'])
                self.assertEqual(
                    hashlib.sha256(zf.read(output_path)).hexdigest(),
                    hashlib.sha256(source_bytes).hexdigest(),
                )
            manifest = json.loads(zf.read('manifest.json').decode('utf-8'))
        self.assertEqual([photo['confidence'] for photo in manifest['photos']], ['high', 'medium', 'low'])

    def test_move_originals_reports_unsupported_access(self):
        result = pindrop_app.move_originals([{}], confirm=True)

        self.assertEqual(result, [
            {
                'index': 0,
                'status': 'unsupported_access',
                'reason': 'sourcePath and destinationPath are required',
            },
        ])

    def test_move_originals_reports_missing_source_without_moving_valid_files(self):
        valid_source = os.path.join(self.tmp.name, 'valid.jpg')
        valid_destination = os.path.join(self.tmp.name, 'valid-dest.jpg')
        missing_source = os.path.join(self.tmp.name, 'missing.jpg')
        missing_destination = os.path.join(self.tmp.name, 'missing-dest.jpg')
        with open(valid_source, 'wb') as f:
            f.write(b'valid bytes')

        result = pindrop_app.move_originals([
            {'sourcePath': valid_source, 'destinationPath': valid_destination},
            {'sourcePath': missing_source, 'destinationPath': missing_destination},
        ], confirm=True)

        self.assertEqual(result[0]['status'], 'blocked')
        self.assertEqual(result[1]['status'], 'missing_source')
        self.assertTrue(os.path.exists(valid_source))
        self.assertFalse(os.path.exists(valid_destination))

    def test_move_originals_refuses_duplicate_destination(self):
        source = os.path.join(self.tmp.name, 'source.jpg')
        destination = os.path.join(self.tmp.name, 'existing.jpg')
        with open(source, 'wb') as f:
            f.write(b'source bytes')
        with open(destination, 'wb') as f:
            f.write(b'existing bytes')

        result = pindrop_app.move_originals([
            {'sourcePath': source, 'destinationPath': destination},
        ], confirm=True)

        self.assertEqual(result[0]['status'], 'duplicate_destination')
        self.assertTrue(os.path.exists(source))
        with open(destination, 'rb') as f:
            self.assertEqual(f.read(), b'existing bytes')

    def test_move_originals_success_path_moves_file_after_confirmation(self):
        source = os.path.join(self.tmp.name, 'source.jpg')
        destination = os.path.join(self.tmp.name, 'destination.jpg')
        move_log = os.path.join(self.tmp.name, 'move-log.jsonl')
        with open(source, 'wb') as f:
            f.write(b'source bytes')

        result = pindrop_app.move_originals([
            {'sourcePath': source, 'destinationPath': destination},
        ], confirm=True, log_path=move_log)

        self.assertEqual(result, [
            {
                'index': 0,
                'sourcePath': source,
                'destinationPath': destination,
                'status': 'success',
            },
        ])
        self.assertFalse(os.path.exists(source))
        with open(destination, 'rb') as f:
            self.assertEqual(f.read(), b'source bytes')
        with open(move_log, 'r', encoding='utf-8') as f:
            log_entry = json.loads(f.readline())
        self.assertRegex(log_entry['movedAt'], r'^\d{4}-\d{2}-\d{2}T')
        self.assertEqual(log_entry['moves'], [
            {'sourcePath': source, 'destinationPath': destination},
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
