#!/usr/bin/env python3
"""Offline transport failure checks; signature resolution has its own integration suite."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('fetcher', Path(__file__).resolve().parents[1] / 'scripts/fetch-ubuntu-runtime-inputs.py')
fetcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetcher)


class AcquisitionTests(unittest.TestCase):
    def run_case(self, response_bytes=b'valid', existing=None, partial=None):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = root / 'cache'
            filename = 'pool/main/t/test/test.deb'
            target = cache / filename
            target.parent.mkdir(parents=True)
            if existing is not None:
                target.write_bytes(existing)
            partial_path = target.with_name(target.name + '.partial')
            if partial is not None:
                partial_path.write_bytes(partial)
            digest = hashlib.sha256(b'valid').hexdigest()
            lock = {'packages': [{'filename': filename, 'size': 5, 'sha256': digest, 'source': {'name': 'test', 'version': '1'}}]}
            lock_path = root / 'lock.json'
            lock_path.write_text(json.dumps(lock))
            source = f'Package: test\nVersion: 1\nDirectory: pool/main/t/test\nChecksums-Sha256:\n {digest} 5 test.tar.xz\n\n'
            response = io.BytesIO(response_bytes)
            response.url = 'https://archive.ubuntu.com/ubuntu/' + filename
            opener = Mock()
            opener.open.return_value = response
            error = None
            with patch.object(fetcher.lock_module, 'build_lock', return_value=lock), patch.object(fetcher.lzma, 'open', side_effect=lambda *args: io.StringIO(source)), patch.object(fetcher.urllib.request, 'build_opener', return_value=opener), patch('sys.argv', ['fetch', str(root), str(lock_path), str(cache), '--download', 'binaries']), contextlib.redirect_stdout(io.StringIO()):
                try:
                    fetcher.main()
                except (ValueError, FileExistsError) as caught:
                    error = caught
            return {'error': error, 'calls': opener.open.call_count, 'target': target.read_bytes() if target.exists() else None, 'partial': partial_path.read_bytes() if partial_path.exists() else None, 'report': json.loads((cache / 'acquisition-binaries.json').read_text())}

    def test_valid_response_publishes_verified_bytes(self):
        result = self.run_case()
        self.assertIsNone(result['error'])
        self.assertEqual(result['target'], b'valid')
        self.assertIsNone(result['partial'])
        self.assertEqual(result['report']['status'], 'passed')

    def test_wrong_hash_short_and_oversized_responses_are_not_published(self):
        for payload in [b'wrong', b'shorter!', b'x']:
            with self.subTest(payload=payload):
                result = self.run_case(response_bytes=payload)
                self.assertIsNotNone(result['error'])
                self.assertIsNone(result['target'])
                self.assertIsNone(result['partial'])
                self.assertEqual(result['report']['status'], 'failed')
                self.assertEqual(result['report']['verified'], [])

    def test_invalid_existing_archive_stops_before_network(self):
        result = self.run_case(existing=b'wrong')
        self.assertIsNotNone(result['error'])
        self.assertEqual(result['calls'], 0)
        self.assertEqual(result['target'], b'wrong')

    def test_existing_partial_is_never_deleted_or_overwritten(self):
        result = self.run_case(partial=b'other writer')
        self.assertIsInstance(result['error'], FileExistsError)
        self.assertEqual(result['partial'], b'other writer')
        self.assertIsNone(result['target'])

    def test_redirect_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'redirect'):
            fetcher.NoRedirect().redirect_request(None, None, 302, 'Found', {}, 'https://example.com/')


if __name__ == '__main__':
    unittest.main()
