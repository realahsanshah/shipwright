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

- AC-1: Given an admin on the appointments page, when the page loads, then an Export button is visible.
- AC-2: Given a non-admin user on the appointments page, when the page loads, then no Export button is visible.
- AC-3: Given a non-admin user, when they request `GET /appointments/export` directly, then the response is 403.
- AC-4: Given an admin clicks Export, when the download finishes, then the CSV has the header `date,patient,doctor,status` and one row per appointment.
- AC-5: Given filters are applied (date range, doctor, status), when the admin clicks Export, then the CSV contains exactly the rows shown by those filters, not the whole table.
- AC-6: Given an admin exports a filter that matches 50,000 rows, when the export runs, then the complete file downloads in under 60 seconds.
- AC-7: Given a cell value starting with `=`, `+`, `-` or `@`, when it is written to the CSV, then it is prefixed with a single quote so spreadsheets do not run it as a formula. This is an extra AC: CSV injection is a security issue the ticket does not mention.
- AC-8: Given an admin requests an export with an unsupported or malformed filter value (e.g. `status=banana`, `from=not-a-date`), when the request is made, then the response is 400 with a message naming the bad parameter and no file is returned. This is an extra AC: the endpoint accepts user-supplied filters, so bad input must fail safely.
- AC-9: Given the database fails partway through an export, when the error occurs, then the endpoint responds 500 and no partial CSV is delivered as a complete file. This is an extra AC: a truncated file that looks complete would silently lose appointments.
- AC-10: Given an export request fails, when the failure is returned, then the admin sees the message "Export failed. Try again." on the appointments page. This is an extra AC: without it the admin gets no feedback after a failed download.

## Affected areas

- `web/src/pages/Appointments.tsx`: add the Export button, role-gated.
- `api/routes/appointments.py`: add `GET /appointments/export` (new) taking the same query params as the list endpoint.
- `api/services/csv_export.py` (new): module using the standard library `csv` writer.

## Data changes and migrations

None.

## Edge cases

- Empty result set (AC-4): file has only the header row, status 200, no error.
- Exactly one matching appointment (AC-4): header plus one row.
- Cells starting with `=`, `+`, `-`, `@` (AC-7): escaped as described.
- Names containing commas, quotes or newlines (AC-4): quoted per RFC 4180.
- Filter matching 50k rows (AC-6): completes within 60 seconds.
- Invalid input (AC-8): unsupported or malformed filter params return 400 with a message, no file.
- Database failure mid-export (AC-9, AC-10): 500 response, no partial file presented as complete, and the admin sees the failure message. No other external service is called.
- Non-admin role (AC-2, AC-3): button hidden and the endpoint returns 403.
- Filters changed while the download runs (AC-5): the export uses the filters sent with the request.
- Appointment times (AC-4): written in UTC ISO 8601, so locale and time zone do not change the file.

## Test plan

| AC    | Test                                                                                                       | Type        |
| ----- | ---------------------------------------------------------------------------------------------------------- | ----------- |
| AC-1  | `Appointments.test.tsx` shows Export for admin                                                             | unit        |
| AC-2  | `Appointments.test.tsx` hides Export for staff                                                             | unit        |
| AC-3  | `test_export_forbidden_for_non_admin` (403)                                                                | integration |
| AC-4  | `test_export_header_and_rows` and `test_export_empty_has_header_only`                                      | integration |
| AC-5  | `test_export_respects_filters`                                                                             | integration |
| AC-6  | `test_export_50k_rows_under_60s` asserts status 200 and elapsed time                                       | integration |
| AC-7  | `test_export_escapes_formula_prefixes` (four prefixes)                                                     | unit        |
| AC-8  | `test_export_bad_filter_returns_400_and_no_file` asserts 400, message names the parameter, no CSV body     | integration |
| AC-9  | `test_export_db_error_returns_500_no_complete_file` (fault-injected query) asserts 500 and no complete CSV | integration |
| AC-10 | `Appointments.test.tsx` shows "Export failed. Try again." when the export request fails                    | unit        |

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
