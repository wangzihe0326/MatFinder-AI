# Real-material pilot

This directory is for manual entry of the first 10–20 reviewed commercial
grades. It contains no real manufacturer, grade, property, certification,
standard, or source claim yet.

## Pilot allocation

Select 2–4 independently verified grades from each family:

- ABS
- PC
- PA66
- POM
- PP

The total pilot must stay between 10 and 20 grades. Selection and transcription
are manual. Do not generate grade names, infer missing values, or scrape data in
bulk.

## Files

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

6. Run the production importer without writing:

   ```powershell
   npm.cmd run import:real-materials -- --file data/pilot/pilot-materials.reviewed.json --dry-run --operator "reviewer name" --source "manual pilot"
   ```

7. Have a second person review the dry-run report and cited documents.
8. Import only after the dry-run has zero rejected records:

   ```powershell
   npm.cmd run import:real-materials -- --file data/pilot/pilot-materials.reviewed.json --operator "reviewer name" --source "manual pilot"
   ```

Keep the returned `importBatchId`. It is required for a scoped rollback.
