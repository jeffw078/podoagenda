# Contacts and Recurring Appointments Implementation Plan

> **For agentic workers:** Execute the independent contact importer and recurrence model in parallel; integrate UI and verify the whole change before publishing. Steps use checkbox syntax.

**Goal:** Register the supplied contacts as clinical clients and support editable/cancellable recurring appointments.

**Architecture:** Keep existing client and appointment arrays. Add a pure recurrence model that stages whole series atomically, plus optional metadata on linked occurrences. Import contacts with a scoped, revision-checked CLI.

**Tech Stack:** Existing JavaScript ESM, Node.js, browser application, Neon PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-11-03-recurring-appointments-design.md`

## Global Constraints

- Private VCF and backups never enter the public repository or frontend.
- Preserve existing clinical histories, personal-account isolation and financial data.
- No automatic revenue when reserving appointments.
- Maximum 366 occurrences per series and 25,000 appointments per account.

## Review Focus

- Month ends and daylight-saving changes retain civil dates and local appointment times.
- A later conflict rejects the entire batch without a partial reservation.
- Changing or cancelling future appointments preserves paid/completed/cancelled exceptions.
- Reimporting the contacts creates no duplicates and preserves existing client details.
- New controls work through the declarative action dispatcher and on mobile.

## Task 1: Contact import

Files: `lib/contact-import.js`, `scripts/import-contacts.mjs`, `scripts/check-contact-import.mjs`, `.gitignore`.

- [ ] Write synthetic failing tests for UTF-8, folded/grouped fields, escaped names, invalid records, duplicate telephone normalization, idempotency and preserved documents.
- [ ] Implement `parseVCardContacts(text)` and `prepareContactImport(data,text,makeId)`; run targeted checks.
- [ ] Implement preview/apply CLI scoped to the clinical account, with backup, optimistic revision and full readback equality.
- [ ] Preview the private file, then apply the requested import and verify aggregate counts only.

## Task 2: Pure recurrence model

Files: `src/shared/appointment-recurrence.js`, `scripts/check-appointment-recurrence.mjs`.

- [ ] Write failing tests for weekly/monthly/custom dates, month ends, exact dates, overflow and bounds.
- [ ] Implement `recurrenceDates(start,rule)`, `prepareAppointmentSave(data,input,makeId)` and `prepareAppointmentCancellation(data,input)` returning fresh arrays.
- [ ] Test future-series edits, single exceptions, completed/paid history and atomic collision handling against lunch/work/personal blocks.

## Task 3: User interface and validation

Files: `src/client/app.js`, `scripts/build-app.mjs`, `api/index.js`, UI/browser tests.

- [ ] Add tests for recurrence questions, interval controls, client labels with phones, occurrence/future scope and edit/cancel action registration.
- [ ] Integrate the pure model into appointment save and cancellation, leaving ordinary appointments compatible.
- [ ] Label recurring appointments and offer scope selection in the existing edit/detail flow.
- [ ] Validate optional recurrence metadata on server saves while preserving legacy appointments.
- [ ] Verify mobile layout and browser create/edit/cancel flows with synthetic clients.

## Task 4: Delivery

- [ ] Run full local checks and browser checks; obtain independent review and resolve findings.
- [ ] Apply only reviewed source files to the actual project, preserving the private contacts directory.
- [ ] Commit and push under the established session authorization; verify deployed assets and successful deployment.
- [ ] Report imported counts and the location of recurrence controls.
