# Reviewed public Supabase CA

`prod-ca-2021.crt` was supplied by the owner on 2026-10-21 in response to a request for the production Dashboard CA, then read from the owner-designated local file. It was not independently downloaded from Dashboard by this agent. No private key is included; exactly one PEM certificate and whitespace only.

- Subject and issuer: C=US, ST=Delware, L=New Castle, O=Supabase Inc, CN=Supabase Root 2021 CA (spelling as encoded).
- Basic constraints: CA=true. Self-signature verified with Node X509Certificate.verify(publicKey).
- Validity: 2021-04-28 10:56:53 UTC through 2031-04-26 10:56:53 UTC.
- Certificate DER SHA256: `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`.
- Exact file SHA256: `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7` (1367 bytes).

Official guidance: https://supabase.com/docs/guides/platform/ssl-enforcement documents downloading prod-ca-2021.crt from Database Settings and using it with sslmode=verify-full. That guidance does not independently attest this file's fingerprint or the live target's certificate chain.

The runner uses only this pinned CA file, resolved relative to its own reviewed artifact. It does not install a system-wide CA, inherit a trust override, downgrade TLS, or change the fixed pooler hostname. The workflow checks the file hash before the credential-consuming step; the runner checks it before creating a connection environment. CA rotation requires a reviewed update and artifact pin.

Run 39578563305 reported TLS_CERTIFICATE_VERIFY_FAILED. A missing Supabase trust root is a hypothesis, not a proven root cause. No live inspect, TLS handshake or database query was performed to validate this fix. A successful future protected inspect is still required. The CA is a shared root identity, not proof of project identity by itself; verify-full hostname verification remains essential.
