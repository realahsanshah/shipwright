# Backlog

Source: docs/PRD.md, docs/TRD.md
Status: approved by Ahsan Shah on 2026-10-11

## B-1: Opt-out keyword handling
- Type: feature
- Depends on: none
- State: todo
- Issue: #12
- Ticket: gh-12
- PR: none
- Acceptance criteria:
  - An inbound STOP, STOPALL, UNSUBSCRIBE, CANCEL, END or QUIT adds the sender to the opt-out list within one request
  - A send to an opted-out number is refused with reason "opted-out"
- Open questions:
  - None.

## B-2: HELP keyword reply
- Type: feature
- Depends on: B-1
- State: todo
- Issue: none
- Ticket: none
- PR: none
- Acceptance criteria:
  - An inbound HELP returns the configured brand help message
- Open questions:
  - None.
