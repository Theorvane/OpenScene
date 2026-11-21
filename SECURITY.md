# Security Policy

## Reporting a Vulnerability

OpenScene does **not currently have a private vulnerability-reporting channel configured**.

Until one is available, do **not** open a public GitHub issue or pull request containing secrets, private media, personal data, exploit steps, proof-of-concept code, or other material that could enable abuse.

If you discover a potential vulnerability, limit public discussion to a non-sensitive request for a private reporting route. Do not include technical details. Maintainers will publish a private contact method or GitHub security advisory workflow when one is configured.

## Scope and Safety

OpenScene is a local video editor with desktop and mobile surfaces. Reports involving Electron isolation, preload/IPC exposure, registered agent-tool dispatch, approval gates, project/graph validation, local file handling, media runtimes, credential storage, native export, bundled dependencies or accidental network behavior are in scope.

Project edits use typed, bounded operations. Canvas parameters and source evidence must not become arbitrary filesystem paths, command arguments or model instructions. Selected external-provider requests may include authorized project context, frames or transcripts; report data escaping that boundary. Mobile anonymous usage reporting is separately bounded in `mobile/src/lib/analytics.ts`.

Do not test against systems, accounts, files, or media you do not own or have explicit permission to assess. Do not publish credentials, tokens, private file paths, user recordings, voice samples, or exploit material.

## Supported Versions

Security fixes are assessed against the latest code on `dev` and released versions on `main`. This policy does not promise a response time or a private reporting channel until one is configured.
