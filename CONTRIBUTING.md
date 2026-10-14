# Contributing

ThreadShift currently focuses on Codex CLI 0.162.1 to OpenCode 2.0.22 in Smart mode. Reverse transfers, additional harnesses and broader native platform validation are future work.

Use Node 24.12.0 through the Node 24 line and Git. Run:

```sh
npm ci
npm run typecheck
npm test
npm run test:package
```

Keep changes small, describe the observable behavior, and add regression coverage when changing capture, privacy or delivery contracts. Distinguish fixture checks from live native checks. Native acceptance requires an explicitly authorized provider; ordinary tests use synthetic fixtures and need no provider credentials.

Never commit real session exports, authentication files, confidential workspace files, provider credentials or raw private test logs. Replace bug-report data with synthetic examples. See the privacy guide before sharing a handover.

Open an issue to discuss major changes. Pull requests should explain the problem, the resulting behavior and the checks performed. Do not claim support for unverified harness versions or platforms.
