# Security and production deployment

## Implemented controls

- A long API key is required for transcription and translation endpoints and compared in constant time.
- The browser does not receive the API key; server-side routes attach it.
- Request size, content type, input schema, trusted host, CORS, and rate-limit checks are enforced.
- Error responses do not expose model exceptions or user text.
- Responses use `Cache-Control: no-store` and hardened browser security headers.
- The private vLLM URL is rejected when it is public unless an operator explicitly overrides the policy.
- The gateway stores no request content and application code performs no content logging.

## Production requirements

1. Terminate TLS 1.2+ at a private ingress or reverse proxy and redirect HTTP to HTTPS.
2. Set `REQUIRE_HTTPS=true` on the API when it is reachable beyond the local Docker network.
3. Use an internal network, VPN, private VPC, or Kubernetes NetworkPolicy between services.
4. For a separate inference host, use HTTPS/mTLS and set `INFERENCE_BASE_URL` to its private HTTPS address.
5. Store API keys in a secret manager or orchestrator secret, not in source control.
6. Pin and scan container images and model revisions before release.
7. Pre-download approved weights, verify hashes, and enable offline mode for air-gapped environments.
8. Disable API documentation in production and keep model/cache volumes inaccessible to other tenants.
9. Load-test concurrent speech and translation requests on the target hardware.
10. Run a human-reviewed Urdu translation quality test suite before launch.

## Model governance

The supplied models are configurable examples, not an assertion that a model is suitable for every production domain. Record the chosen model revision, license, evaluation results, known failure modes, and approval owner in the release documentation. Sensitive or high-impact use cases require additional review.
