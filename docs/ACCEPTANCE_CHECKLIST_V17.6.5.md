### 10-minute real-environment acceptance checklist (V17.6.5)

Two devices/browsers: **A** (has a repository sign-in with write access, via the repository access service or a token) and **B** (clean profile, no token, no sign-in).

1. **(1 min) Deploy.** Publish V17.6.5 (`dist/**` on `main`); redeploy the broker if you use it. Open the site on A and B: footer shows *Version 17.6.5*; Settings unlock with `admin` still works (no central record yet = V17.6.4).
2. **(2 min) Save.** A: Settings → Security → current `admin`, new password ≥ 10 characters → **Save (all devices)**. Expect: success text mentioning "read back". In GitHub, `sql-assistant-data/security/admin-credential.json` exists; open it: only `format, formatVersion, revision, updatedAt, updatedBy, isDefault, marker{salt,iv,ciphertext}` — no readable password.
3. **(1 min) Publication.** Actions → *Publish SQL Assistant data* ran (or run it); its last step says the record is published; `<site>/sql-assistant-data/published.json` lists the credential file. Note how long it took.
4. **(2 min) Other device.** B: reload, Settings → the **new** password unlocks, the old one (and `admin`) is rejected. A: the old password is rejected too.
5. **(1 min) Change elsewhere works at once.** A: Save a different password. B (without reloading, after the publication ran): enter the newest password → unlocks on the first try.
6. **(1 min) Wrong attempts.** On B enter 5 wrong passwords → lock-out message (60 s); the correct one is refused until it ends.
7. **(1 min) Reset.** On A: **Reset to default** → confirm → Settings lock; `admin` unlocks with the default-password warning. After the publication, B: `admin` works, the previous password fails, and an unlocked session on B ended at its next refresh. Then Save a new password on A (replaces the default record).
8. **(1 min) Reset authorization.** On a device whose GitHub account has **read-only** access, Reset (empty password) must be refused; with write access and an empty password it must work (forgotten-password path). Check a wrong password is refused.
9. **(optional) Branch protection.** If `main` forbids direct pushes, Save must report "Failed at *writing the central record*" and change nothing — decide whether the service's PAT may bypass the rule for `sql-assistant-data/security/**`; add the `CODEOWNERS` rule.
10. **Rollback drill.** Delete `sql-assistant-data/security/*` → after publication every device uses its local password again.
