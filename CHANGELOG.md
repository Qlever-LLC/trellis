# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Changed `trellis auth login` to require a positional Trellis URL, renamed the
  persisted admin-session URL field to `trellis_url`, and updated the related
  design and guide examples.
- Made service and activated-device runtime NATS lifecycle logging explicit so
  disconnects, reconnect attempts, reconnect success, stale connections, and
  connection errors produce distinct operator-facing messages.
- Moved contract-manifest job queue declarations to canonical top-level `jobs`
  in both the JavaScript and Rust contract layers, and aligned bootstrap and
  contract-get views with that shape.

### Fixed

- Granted KV-backed services JetStream info access so operation handlers can
  open their durable operation store without `$JS.API.INFO` permission errors.
- Fixed jobs worker permission grants for cancellation subscriptions, made
  server shutdown idempotent while NATS draining is already in progress, and
  corrected demo workspace generated-SDK resolution during contract prepare.
- Fixed `TrellisClient.connect(...)` and `TrellisDevice.connect(...)` so
  contract-driven RPC request typing is inferred from the passed contract rather
  than widening typed responses like `Auth.Me` to `unknown`.
- Fixed activated-device state flows by preserving top-level contract `state`
  metadata, refreshing device reconnect permissions from the presented digest,
  and encoding state KV keys safely so the JavaScript state demo runs end-to-end.

## [0.8.0] - 2026-04-19

### Added

- Made TypeScript jobs and named stores first-class client surfaces.
- Split the JavaScript demo into more focused inspection surfaces.

### Changed

- Switched public async APIs to `AsyncResult` and hardened operation startup and
  transfer flows.
- Simplified runtime auth wiring by removing binding tokens and advertising
  native client NATS endpoints.

### Fixed

- Aligned detached agent login and revocation behavior.
- Stabilized console profile loading across reconnects, supported optional
  portal app contracts, and trimmed login portal files from the runtime image.

[Unreleased]: https://github.com/Qlever-LLC/trellis/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/Qlever-LLC/trellis/compare/v0.7.0...v0.8.0
