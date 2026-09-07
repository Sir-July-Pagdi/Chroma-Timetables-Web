# Chroma Timetables — Web

A browser version of Chroma Timetables: React + TypeScript, no backend server. Each
device keeps its own local timetables (IndexedDB); Export/Import (a downloadable JSON
file) is how you move a timetable between devices, since there's no shared server.

## Running it

This was written without network access, so it has never actually been installed or
built yet — the same "I write it, you build it" workflow we used for the Android app's
Codespace builds.

```bash
npm install
npm run dev       # local dev server
npm run build     # production build -> dist/
```

## What's a faithful port vs. a fresh implementation

- **CSV format**: identical to the Android app — teachers.csv, subjects.csv, rooms.csv,
  sections.csv, sessions.csv, availability.csv, same columns, same validation rules
  (dayOfWeek 1=Monday..7=Sunday, availability.csv stores only *blocked* exceptions, room
  `type` is free-form). Existing sample data should import unchanged.
- **`ConstraintValidator`** (`src/engine/constraintValidator.ts`) is now checked directly
  against the real Kotlin source (`ConstraintValidator.kt`), which was found and read in
  full partway through this build — every violation type, grouping key, and message
  matches it exactly, including the deliberately-non-obvious one:
  `SUBJECT_DOUBLE_BOOKED` groups by the **(sectionId, subjectId) pair**, not subjectId
  alone — two different sections legitimately studying the same subject at the same time
  is normal, not a conflict; the real anomaly is one section double-booked into the same
  subject twice. Also matched: a session whose duration doesn't fit the day skips every
  other check entirely (not just the duration one), and room-capacity checking is fully
  independent of that duration-fit check.
- **DSATUR coloring, room assignment, scoped repair, and the optimizer** are still a
  clean-room reimplementation — I didn't have `DsaturColoring.kt`/`RoomAssigner.kt`/
  `RepairEngine.kt`'s actual internals in this conversation, only the public contract
  (violation types, CSV schema, and the behavior we'd confirmed: Optimize validates first
  and only touches conflict participants, Repair freezes everything outside the chosen
  scope). Structurally equivalent, not algorithmically identical — treat the first
  several timetables you generate as a real test of the coloring quality, not an
  assumed-correct result.
- **The guided Repair workflow** (multi-select "Adjust by," per-field-only swaps, identity
  overrides for Class/Subject/Teacher swaps, the persistence-invariant check) mirrors
  every fix made on the Android app through v1.0.9–v1.0.11.
- **Delete**: both whole-lineage delete and single-version delete are implemented.
  Deleting a version only removes that version's own assignment/conflict rows — nothing
  else references a version by id, so this is genuinely self-contained. Deleting the root
  always deletes the whole lineage (every other version's `rootRunId` points at it, so it
  can't be removed alone without orphaning them).

## Known v1 gaps, called out honestly

- No automated tests yet (the Android app has real Kotlin unit tests for the engine and
  the persistence invariant; this port doesn't have a JS/TS equivalent test runner set up).
- Never installed/built/run — this was written entirely without network access (no way to
  `npm install`), so treat the first `npm install && npm run dev` as a real debugging pass,
  the same way every Android Codespace session in this project's history started with a
  build that needed at least one round of fixes.
