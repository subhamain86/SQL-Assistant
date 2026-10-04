# V17.1 — Root cause of the original synchronization error (summary)
1. The V16.x Manual Schema Update **Delete** removed a column (or a table left empty) without checking dependencies. Foreign keys and relationships pointing at it were left behind.
2. **Push did not validate**, so the broken schema was published.
3. **Pull validated strictly**, so every device rejected the whole file with one generic message. Re-pushing published the same data again.

V17.1 added a publish gate, one shared rule set, normalise-before-validate, per-schema verdicts and explicit recovery. The cases that still let the error reappear are explained in `ROOT_CAUSE_V17.2.md`.
