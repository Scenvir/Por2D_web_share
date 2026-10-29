# Local operations and recovery

These dependency-free Node utilities are preparation tools, not an installed scheduler,
off-site backup service or deployment agent. Run from the repository (Node 18+).
They never invoke shell commands, install services, transfer data, or overwrite a live restore.
Raw logs and backups remain private. Never commit them or put them in a public share repository.

For an extracted share package, first change into its `runtime/` directory; the same
`node tools/ops_*.cjs` commands then work. The packaged stats entry is `server-stats.cjs`.
Regression tests below are repository-only and are not included in the player share package.

## Daily statistics

Feed **chronological** retained application JSON lines, including earlier connection starts
when available, into the daily writer after that day ends:

```sh
node tools/ops_daily.cjs write /private/por2d/aggregates 2026-10-28 Asia/Shanghai < /private/input.jsonl
node tools/ops_daily.cjs prune /private/por2d/aggregates 90
# Review the exact proposed paths, then explicitly apply:
node tools/ops_daily.cjs prune /private/por2d/aggregates 90 --apply
```

Only fixed numeric aggregates, date and timezone are persisted, never addresses,
connection/room identifiers or raw lines. IP cardinalities remain approximate audience
metrics, not people counts. Existing daily files are immutable: partial reruns fail rather
than overwrite. A partial log source still produces a partial summary; record coverage
privately and review input completeness before accepting the day. Retention is an explicit
operation, not an installed cron job; use one timezone consistently per directory.
Pruning uses UTC calendar date minus the selected number of days and only validates/deletes
matching aggregate files; unrelated files are untouched. Raw-log retention is a separate
host policy and is not changed by this tool.

Completed-sync buckets are <1 s, 1–<5 s, 5–<15 s and >=15 s; only valid server-emitted
`sync_complete.durationMs` contributes. Totals/max are also stored. Timeouts/retries are
separate and excluded from the completed-duration distribution (not evidence of fast success).
No public request parameter/header can remove traffic from these statistics. Events with
the trusted server log field `trafficKind: test` are excluded from traffic/session metrics
and counted separately as `excludedTestEvents` for the selected day. That field is set
only by an internal `createServer({trafficKind:'test'})` process option, not client headers,
query strings or message bodies; keep test instances loopback-only. Only ingest trusted
application logs: the offline parser cannot authenticate arbitrary input JSON. Health
probes are not successful page views.

## Health and private performance metrics

`GET /healthz` exposes only status, release version and protocol; an OK response shows
HTTP responsiveness and version identity, not successful gameplay, available capacity,
off-site backups or successful recovery. Private periodic `operations/performance` logs
report event-loop P50/P95/max delay, current rooms/connections/pending initializations,
and sync completion/failure/retry counters. Delay is scheduling latency, not network RTT;
counters are process observations and reset when the process restarts. Do not publish
raw operational logs. An optional client performance panel is a local diagnostic view;
its frame timing/latency is not a server benchmark or proof of player experience elsewhere.

Room initialization is bounded to two concurrent operations, twelve per minute globally
and six per minute per transport peer. Limits protect initialization cost, not all possible
traffic; peers sharing a NAT may share a budget. Rejections do not prove abuse. Use isolated
loopback test processes with the internal trusted test label, never a public opt-out header.

## Sanitized private backup and staged restore

Prepare a **curated data source**, not the runtime directory:

```text
curated/
  custommaps/       # Optional, regular .json map files, simple ASCII filenames
  aggregates/       # Optional, strict daily YYYY-MM-DD.json summaries
  ops-config.json  # Optional, only approved numeric settings below
```

No persistent custom-map store is inferred: select/export the actual maps explicitly.
Maps are parsed using the game's map model. Gameplay fields are retained, including
incomplete editor drafts; map names/commentary and unknown metadata are deliberately
removed. Backups assign sequential map filenames and the generic name `Restored map`.
This sacrifices descriptive metadata to avoid copying private free text. There is no claim
that this package preserves editor history, active rooms or live player sessions.

Config may contain only positive integer `port`, `idleTimeoutMs`, `readyTimeoutMs`,
`catchupTimeoutMs`, `maxCatchupLagFrames`, `ackTimeoutMs`. Port is limited to 65535;
other values to 3600000. Secrets, environment files, addresses, certificates, logs,
arbitrary config text, runtime files and broad archives are not allowlisted. Unknown
config keys fail closed. Unrelated files outside the curated subdirectories are ignored;
unexpected files inside them fail. Symlinks are rejected. The source and output directories
must be operator-controlled; do not allow another process to mutate them during the operation.

```sh
node tools/ops_backup.cjs prepare /private/curated /private/por2d-backup.json
node tools/ops_backup.cjs validate /private/por2d-backup.json
node tools/ops_backup.cjs restore /private/por2d-backup.json /private/new-restore-staging
```

The JSON bundle is limited to 32 MiB and includes a SHA-256 manifest per entry. Schema,
checksum, path and sanitization checks precede restore. Checksums detect corruption, not
malicious modification; retain the bundle in a private trusted location. Restore requires
a **nonexistent** destination and never merges/overwrites live data. On an I/O failure a
partial staging directory can remain; review/remove only that exact directory before retry.
Validate the restored maps with the editor before promotion. Backup output uses exclusive
creation and restrictive POSIX permissions (0700 directories / 0600 files); existing directory
permissions are not changed. No remote destination or transfer is configured by these tools.

## Release verification and reversible deployment

```sh
node tools/ops_verify.cjs manifest /candidate /candidate/SHA256.json
node tools/ops_verify.cjs health http://127.0.0.1:3000/healthz EXPECTED_VERSION
```

The manifest is a JSON object of relative filenames to lowercase SHA-256 hex digests.
Every listed entry is checked; this does not assert the absence of additional files. Use
a trusted manifest with all required release files, and verify the intended root (a share
package's manifest may be relative to the package root rather than its runtime subdirectory).
The health helper requires HTTP 200, `status: ok`, exact version and protocol 11; it rejects
redirects, credentials, queries and non-loopback plain HTTP. It has a 5-second timeout.
Public health does not prove multiplayer correctness or persistence recovery.

Manual release sequence, requiring the separately authorized host/deployment workflow:

1. Record current release identity, config and rollback target; preserve that release.
2. Prepare/validate the private data backup and perform a fresh staged restore drill.
3. Verify the candidate manifest and execute the relevant regression/package tests.
4. Start the candidate on an isolated port; verify health/version and authorized gameplay.
5. Promote only through the host's established reversible release switch. Expect active
   rooms to disconnect on process replacement; do not promise session continuity.
6. Verify the public route returns the expected version and check application errors.
7. If verification fails, switch back to the recorded previous release/config using the
   same host procedure; verify the previous version's health and multiplayer behavior.
   Do not restore data blindly or overwrite newer maps. Keep failed candidate evidence private.

No systemd/root commands or production mutations are performed by these utilities.
Host-specific switching, log policy, automation and any private off-machine delivery remain
separate authorized operations. Data backup is not a substitute for preserving the exact
known-good release artifact and its manifest for rollback.

### Opt-in managed release helper

`ops_release.cjs` is the exception to read-only preparation: **only `--apply`** may
switch a release and invoke the fixed `/usr/bin/systemctl restart por2d.service`.
It never invokes a shell or changes the unit definition. The operator must first configure
that unit's working directory and server path under `/home/ubuntu/por2d/current/runtime`
with the intended fixed Node executable. `current` must be a symlink to the release
directory `/home/ubuntu/por2d/releases/Por2D_web_share-<full 40-character Git SHA>`.
There are no CLI overrides for these paths, the service or commands.

```sh
# Candidate already started on an isolated loopback port by the operator:
node tools/ops_release.cjs --release FULL_40_CHARACTER_SHA --health-port 18000
# After reviewing the dry-run and the candidate's multiplayer checks:
node tools/ops_release.cjs --release FULL_40_CHARACTER_SHA --health-port 18000 --apply
node tools/ops_release.cjs --rollback           # Inspect first
node tools/ops_release.cjs --rollback --apply   # Restore recorded previous release
```

The helper validates every listed `SHA256.json` artifact, mandatory runtime files,
release identity, paths and loopback health. Git-SHA directory names and content hashes
are integrity labels, not signatures: manifests and releases must be trusted, immutable
operator inputs. It does not fetch or prove a GitHub commit's provenance. An exclusive
lock prevents concurrent helpers. Both releases are retained. Restart or post-health failure
restores the previous link and attempts its restart/health check; failures are reported.
Inspect a stale lock or interrupted transition manually; it is never automatically removed
by another run. Execution needs the existing service-management privilege; the tool does
not install sudo rules or elevate itself.
Rollback does not require the failing current process to answer health requests or its
artifacts to remain intact. It requires a valid managed current-link identity matching
the persisted state and validates the rollback target completely. If that rescue fails,
the prior link is restored and restart attempted, but prior integrity/health remain
unverified: the operator must inspect it manually. Normal deployment validates both
current and candidate artifacts before switching.

Both old and new releases must have the current manifest format, `release.json` and
`/healthz`. **Legacy releases are rejected** rather than guessed or silently trusted.
The first migration from a pre-health version must use the operator's recorded manual
rollback procedure; this helper becomes usable between managed versions afterward.
Use a distinct release version for each release so health checks distinguish the process.

### Service-scoped log collection (host setup required)

`node tools/ops_collect_daily.cjs YYYY-MM-DD` reads only `por2d.service` through
`/usr/bin/journalctl` and prints numeric aggregates; add `--write PRIVATE_DIRECTORY`
to persist an immutable completed day. `--namespace` uses `--namespace=+por2d` to merge
the default and `por2d` namespaces while still filtering only `por2d.service`.
No raw journal is copied to disk. A failed, empty or warning-bearing
journal read fails closed. Retention may already have removed early records, so review
coverage before relying on a summary; absence of warnings does not prove full coverage.

On a host supporting systemd journal namespaces, the operator can give **this unit only**
`LogNamespace=por2d` and configure retention in `journald@por2d.conf.d/` (for example,
14 days and a 128 MiB namespace budget). Do not set global journal limits or vacuum
the shared journal. Changing namespace does not migrate old records; preserve and
summarize the old unit journal before switching, then query the selected namespace.
The collector never changes namespace, retention or existing journal files.

A host timer can invoke the collector shortly after midnight Asia/Shanghai for the
previous completed day, before raw records expire. Install the timer separately with
the exact Node/runtime path, private aggregate directory and journal-read permission.
It should alert on failure and never overwrite an existing day. No scheduler is installed
by the package. Keep raw logs private and cap them only after export/coverage review.

## Verification

```sh
node tests/server_stats_test.cjs
node tests/ops_test.cjs
node tests/ops_health_test.cjs
```

Tests use disposable local directories and cover numeric aggregate privacy, daily immutability,
retention scope, duration buckets, map/config sanitization, staged restore, tamper rejection,
path traversal/symlinks, manifest checks and health schema. They do not deploy or access production.
