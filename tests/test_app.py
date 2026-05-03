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

    def test_tag_rejects_missing_filename_without_500(self):
        response = self.client.post('/tag', json={'filename': None})

        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.json)

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

    def test_reverse_geocode_rejects_invalid_coordinates(self):
        response = self.client.get('/reverse-geocode?lat=91&lng=126')

        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.json)

    def test_pin_store_ignores_malformed_entries(self):
        with open(pindrop_app.PINS_FILE, 'w', encoding='utf-8') as f:
            json.dump([1, {'id': 2, 'place': 'old'}], f)

        save_response = self.client.post('/pins', json={'id': 3, 'place': 'new'})
        delete_response = self.client.delete('/pins/2')
        pins_response = self.client.get('/pins')

        self.assertEqual(save_response.status_code, 200)
        self.assertEqual(delete_response.status_code, 200)
        self.assertEqual(pins_response.json, [{'id': 3, 'place': 'new'}])

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
            {'id': 7, 'lat': 37.5, 'lng': 127.0, 'place': '서울'},
        ])

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
