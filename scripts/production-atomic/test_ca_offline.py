"""Pinned public CA checks; no network or database access."""
import hashlib, os, ssl, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import run_atomic as r

class TrustStore(unittest.TestCase):
    def test_public_certificate_identity(self):
        r.verify_ca()
        raw = Path(r.CA).read_text()
        self.assertEqual(raw.count('-----BEGIN CERTIFICATE-----'), 1)
        self.assertNotIn('PRIVATE KEY', raw)
        der = ssl.PEM_cert_to_DER_cert(raw)
        self.assertEqual(hashlib.sha256(der).hexdigest(),
            '807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa')
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.load_verify_locations(cafile=r.CA)
        self.assertEqual(context.cert_store_stats()['x509_ca'], 1)

    def test_missing_or_changed_ca_fails_before_process(self):
        with tempfile.TemporaryDirectory() as directory:
            ca = Path(directory)/'ca.crt'
            with patch.object(r, 'CA', str(ca)), patch.object(r.subprocess, 'run') as process:
                with self.assertRaisesRegex(RuntimeError, '^TRUST_STORE_MISSING_NO_TLS_DOWNGRADE$'):
                    r.connection_env('synthetic', True)
                ca.write_bytes(b'changed')
                with self.assertRaisesRegex(RuntimeError, '^TRUST_STORE_HASH_MISMATCH_NO_TLS_DOWNGRADE$'):
                    r.connection_env('synthetic', True)
                process.assert_not_called()

    def test_tls_and_target_cannot_be_overridden(self):
        with patch.dict(os.environ, {'PGSSLMODE':'disable','PGSSLROOTCERT':'untrusted',
                                    'PGHOST':'wrong','PGSERVICE':'wrong'}, clear=True):
            for readonly in (True, False):
                env = r.connection_env('synthetic', readonly)
                self.assertEqual(env['PGSSLMODE'], 'verify-full')
                self.assertEqual(env['PGSSLROOTCERT'], r.CA)
                self.assertTrue(Path(r.CA).is_absolute())
                self.assertEqual(env['PGHOST'], 'aws-0-eu-west-1.pooler.supabase.com')
                self.assertEqual(env['PGUSER'], 'postgres.szjiwamevblkpjmmeonf')
                self.assertNotIn('PGSERVICE', env)
                self.assertNotIn('PGHOSTADDR', env)

if __name__ == '__main__': unittest.main()
