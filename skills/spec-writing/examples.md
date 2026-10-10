# Spec examples

All data here is invented. The ticket is the example ticket from the design doc.

## Worked spec: HC-142

Input `ticket.json` (abridged): title "Export appointments to CSV", type `feature`, constraints `["No new dependencies"]`, three criteria (Export button for admins; columns date, patient, doctor, status; export respects filters), `open_questions: []`.

```markdown
# HC-142: Export appointments to CSV

Status: draft

## Summary

Admins get an Export button on the appointments page. It downloads the currently filtered appointments as a CSV file. No new dependencies are added.

## Acceptance criteria

- AC-1: Given an admin on the appointments page, when the page loads, then an Export button is visible. Non-admin roles do not see it.
- AC-2: Given an admin clicks Export, when the download finishes, then the CSV has the header `date,patient,doctor,status` and one row per appointment.
- AC-3: Given filters are applied (date range, doctor, status), when the admin clicks Export, then the CSV contains exactly the rows shown by those filters, not the whole table.
- AC-4: Given an admin exports a filter that matches 50,000 rows, when the export runs, then the file is delivered without a request timeout and the server streams rows instead of loading them all into memory.
- AC-5 (extra, reason: CSV injection is a security issue the ticket does not mention): Given a cell value starting with `=`, `+`, `-` or `@`, when it is written to the CSV, then it is prefixed with a single quote so spreadsheets do not run it as a formula.

## Affected areas

- `web/src/pages/Appointments.tsx`: add the Export button, role-gated.
- `api/routes/appointments.py`: new `GET /appointments/export` taking the same query params as the list endpoint.
- `api/services/csv_export.py`: new module using the standard library `csv` writer.

## Data changes and migrations

None.

## Edge cases

- Empty result set (AC-2): file has only the header row, status 200, no error.
- Cells starting with `=`, `+`, `-`, `@` (AC-5): escaped as described.
- Names containing commas, quotes or newlines (AC-2): quoted per RFC 4180.
- Filter matching 50k rows (AC-4): streamed response, memory stays flat.
- Non-admin role (AC-1): button hidden and the endpoint returns 403.
- Filters changed while the download runs (AC-3): the export uses the filters sent with the request.
- Appointment times (AC-2): written in UTC ISO 8601, so locale and time zone do not change the file.

## Test plan

| AC   | Test                                                                  | Type        |
| ---- | --------------------------------------------------------------------- | ----------- |
| AC-1 | `Appointments.test.tsx` shows Export for admin, hides it for staff    | unit        |
| AC-2 | `test_export_header_and_rows` and `test_export_empty_has_header_only` | integration |
| AC-3 | `test_export_respects_filters`                                        | integration |
| AC-4 | `test_export_50k_rows_streams` asserts peak memory and status 200     | integration |
| AC-5 | `test_export_escapes_formula_prefixes` (four prefixes)                | unit        |
| AC-1 | `test_export_forbidden_for_non_admin` (403)                           | integration |

## Risks

- Streaming through the reverse proxy may buffer. Check the proxy config in staging. Rollback: revert the commit; no data changes to undo.

## Open questions

None.
```

## Bounced ticket

Input: title "Improve the export", description "make the export better", no criteria. The spec cannot be written honestly, so it stays a draft with the questions asked and nothing invented:

```markdown
# EX-7: Improve the export

Status: draft

## Summary

The ticket asks for a better export but does not say what is wrong with the current one.

## Acceptance criteria

Blocked on the open questions below.

## Affected areas

Export code path (to be confirmed once the questions are answered).

## Data changes and migrations

Unknown until answered.

## Edge cases

Unknown until answered.

## Test plan

Blocked: no acceptance criteria yet.

## Risks

Building the wrong thing.

## Open questions

1. Which problem should the change fix: speed, missing columns, file format, or something else?
2. What does "better" look like in a number or an example, e.g. "completes in under 10 s for 10k rows"?
3. Who uses the export, and does it change for any role?
```

The gate fails: open questions remain. The run stops until the ticket author answers.
