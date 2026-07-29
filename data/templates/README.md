# Real material core templates

These templates are intentionally empty. They contain no manufacturer, commercial grade, certification, test standard, or source claim.

## Files

- `real-material-core-template.json`: nested import shape for materials, multiple property measurements, multiple test conditions, identity sources, official TDS links, and certifications.
- `real-material-core-template.csv`: header-only flat import shape. Use one row per `material`, `property`, or `certification` record.
- `../../outputs/019fad27-72f8-7cb0-bfca-e5e24c1519dc/real-material-core-template.xlsx`: manual-entry workbook with separate Materials, Properties, Certifications, and Allowed Values sheets.

## Manual entry workflow

1. Create one stable `materialId` for one confirmed manufacturer/commercial-grade pair.
2. Enter the manufacturer and commercial grade exactly as shown by the primary evidence. Do not invent a value for a missing brand.
3. Add the official TDS URL only when it is an actual manufacturer document.
4. Enter every property/test-condition combination as a separate property measurement. Each measurement must carry its own test standard, condition, value type, source, verification status, and confidence.
5. Add certification claims separately. A marketing statement is not a verified certification without a source and scope.
6. Use `null` for missing JSON text or numeric fields. Use `unknown` only in enum fields that explicitly support it. Never use `0`, an empty string, or a made-up standard as a placeholder.
7. Run:

   ```powershell
   npm.cmd run validate:real-material-import -- data/templates/your-filled-materials.json
   ```

8. Correct every validation error before database ingestion. Warnings identify evidence gaps that prevent High confidence and may prevent a Verified Match.

9. Run the production importer in read-only dry-run mode:

   ```powershell
   npm.cmd run import:real-materials -- --file data/templates/your-filled-materials.json --dry-run --operator "reviewer" --source "manual review"
   ```

10. When dry-run reports zero rejected records, execute the same command without
    `--dry-run`. Save the returned `importBatchId`.

11. A scoped rollback is available when a reviewed batch must be withdrawn:

    ```powershell
    npm.cmd run rollback:real-materials -- IMP-BATCH-ID --operator "reviewer"
    ```

The pre-import validator and production importer are separate gates. Import is
transactional, exact-identity based, append-only for evidence, and idempotent by
input file SHA-256.
