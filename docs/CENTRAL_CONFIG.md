# Centrally maintained repository configuration — V17.7.2

## What was there before (review result)

| Item | Where it lived in V17.7.1 |
|---|---|
| Default repository location (`owner`, `repo`, `branch`, `schemaPath`) | compiled into the application: `src/v17/services/repositoryDefaults.ts` / `DEFAULT_REPOSITORY` in `repositoryConfig.ts` (`basware/sk-ap-sql-assistant`, `main`, `sql-assistant-data/schemas/registry.json`) |
| An administrator's change | **browser storage of that one device** (`sqla.repoconfig.v1756`), saved by `saveRepositoryConfig` after the Admin Password check |
| Credentials | separate, unchanged: saved token in the encrypted Secret Vault, the central access service, or the published read-only copy |

A change never left the device where it was made, so every new machine started from the compiled defaults and had to be set up by hand.

## What V17.7.2 does

**One authoritative, version-controlled source:** `sql-assistant-data/config/repository-config.json` in the application's *bootstrap* repository (the repository every new machine first looks at — `DEFAULT_REPOSITORY`). It is an ordinary file under `sql-assistant-data/`, so it has Git history, is mirrored by the existing `publish-data` workflow (a machine without any token reads it from the published copy) and needs no new workflow, secret or token path.

```json
{
  "format": "sqla-repository-config",
  "formatVersion": 1,
  "revision": 3,
  "updatedAt": "2026-10-30T10:00:00.000Z",
  "updatedByDevice": "…",
  "appVersion": "17.7.2",
  "config": { "owner": "…", "repo": "…", "branch": "…", "schemaPath": "sql-assistant-data/schemas/registry.json" }
}
```

No secret is ever in it (publishing is refused if anything credential-shaped is present, and a record that contains one is ignored on read).

### Write (administrator only)
`CentralConfigService.save()` — Admin Password (checked inside the service, not only in the UI) → field validation → optional live check (repository / branch / path reachable) → read the current record → write revision *N+1* with the file's `sha` (GitHub refuses a stale write) → **read back and compare** → only then apply locally. A refusal at any step changes nothing, locally or centrally. The repository's own permissions are not bypassed: a connection that cannot write (read-only token, no permission) gets the repository's refusal. Two administrators cannot overwrite each other: a newer revision that appears during the write is kept and the second save is refused with an explanation.

### Read (every machine)
`CentralConfigService.pull()` runs at start-up (bounded wait, page already usable), at every scheduled synchronization, with the navbar **Sync** button and with **Check for updated configuration** on the GitHub Repository card. A record with a *higher* revision than the one this device applied is validated and applied transactionally (single write + read-back + restore of the previous value). A new machine has revision 0, so it adopts the central record at once. The record is always read from the bootstrap repository, so changing the location can never make the record unreachable.

### Safety rules
* Local values never overwrite a newer central revision. A device with no repository connection at first set-up may save locally (Admin Password still required); that value is marked *pending*, published at the next synchronization, and **dropped** if a newer central revision exists by then.
* An unreadable, invalid, oversized, future-format or credential-looking central record is ignored and logged; the local configuration is untouched. A stale (older) record never replaces a newer state.
* Concurrent pulls are serialized.
* Every outcome is written to a small local log (30 entries, secrets masked) shown under *Recent configuration activity*.
* Saving the application defaults publishes the defaults (the local override is removed on every machine).

### Security
* No token or privileged credential is in the source, the central file or the log; `centralConfig.ts` never touches a credential or the network itself — it only uses the injected repository connection that every other synchronization already uses.
* Authentication is unchanged: saved token / central access service / published copy.
* Only an administrator can write; reading needs no credential beyond the existing connection.

### Operations
Nothing has to be deployed for this feature: the first administrator save creates the file. To roll back, delete the file (or save the defaults); machines keep their last applied values until an administrator saves again.

### Not verified
Real GitHub was not reachable from the build environment. The repository is emulated by the project's in-memory repository (`memoryRepository`) with the same `sha` conflict semantics; GitHub's real `409`/`422` handling is covered by the existing `githubClient` mapping, not re-tested live.
