# Real-material pilot

This directory is for manual entry of the first 10 to 15 reviewed commercial
grades. It contains no real manufacturer, grade, property, certification,
standard, or source claim yet.

## Pilot allocation

Use the 12 neutral planning slots in `pilot-plan.json` across:

- ABS
- PC
- PA66
- POM
- PP

Slot IDs are workflow identifiers, not commercial grades. Selection and
transcription are manual. Do not generate grade names, infer missing values, or
scrape data in bulk.

## Files

- `pilot-plan.json` tracks the family allocation and one of these states:
  `planned`, `entered`, `validation_failed`, `awaiting_review`, `Medium`,
  `High`, or `imported`.
- `pilot-materials.PLACEHOLDER.json` demonstrates the nested structure. It is
  explicitly marked as non-importable and the production importer will reject
  it.
- `CHECKLIST.md` is the per-grade evidence review checklist.
- Create the first reviewed file as `pilot-materials.reviewed.json`; do not
  replace PLACEHOLDER tokens with guesses.

## Safe workflow

1. Confirm the exact manufacturer, commercial grade, and family from an
   identity source.
2. Save each source title and direct HTTP(S) URL.
3. Transcribe each property as a separate measurement with its own unit, test
   standard, test condition, value type, source, and verification decision.
4. Enter certification evidence only when a dedicated official record exists.
5. Run the existing validation gate:

   ```powershell
   npm.cmd run validate:real-material-import -- data/pilot/pilot-materials.reviewed.json
   ```

6. Review the current workflow counts:

   ```powershell
   npm.cmd run pilot:status
   ```

7. Run the production importer without writing:

   ```powershell
   npm.cmd run import:real-materials -- --file data/pilot/pilot-materials.reviewed.json --dry-run --operator "reviewer name" --source "manual pilot"
   ```

8. Have a second person review the dry-run report and cited documents.
9. Import only after the dry-run has zero rejected records:

   ```powershell
   npm.cmd run import:real-materials -- --file data/pilot/pilot-materials.reviewed.json --operator "reviewer name" --source "manual pilot"
   ```

Keep the returned `importBatchId`. It is required for a scoped rollback. Update
the relevant planning slot only after each workflow transition is confirmed.
