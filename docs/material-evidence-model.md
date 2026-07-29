# Material evidence model

## Storage

`material_evidence` stores material identity claims and their sources.

`material_property_evidence` stores one property claim per material, property key, and position. Multiple rows for the same material/property represent independent sources or test conditions. A property claim contains:

- value (`value_numeric` or `value_text`) and `unit`
- `test_standard` and `test_condition`
- `value_type`
- manufacturer, brand, commercial grade, and material family context
- source type, title, URL, and date
- verification status, confidence level, and last verified date

`material_certifications` stores certification claims separately, including scope and independent evidence.

`evidence_sources` is the normalized source registry for new imports. Imported
evidence stores a `source_id`; the legacy inline source columns remain readable
for backward compatibility but are not populated with duplicate title/URL text
by the new importer.

`real_material_identities` enforces the exact normalized identity key:

`manufacturer + commercialGrade + materialFamily`

Brand and display name are never used to merge records.

`import_batches` stores `importBatchId`, timestamp, input SHA-256, file name,
imported/rejected counts, operator/source, status, and the complete report.
`import_entity_links` records which batch created or reused each material,
source, identity claim, property claim, and certification claim.

Null remains null. Unknown enum values use `unknown`. The reader does not attach a material-level source to a property unless the property claim explicitly carries that source.

## Evidence versions and conflicts

New evidence is append-only. An update never overwrites a prior property or
certification row. Each row carries an evidence version and import metadata.

Property records are grouped by material, property, test standard, test
condition, unit, and value type. Clearly different values in the same group are
both marked `conflicting` with the same conflict group ID. Neither value is
silently selected as the unique truth.

Recommendation selection first filters to an explicitly requested test standard
and condition. Without enough condition context, multiple applicable test
contexts produce `unverifiable`. A conflict under one context also produces
`unverifiable`.

## Confidence rules

- High: confirmed manufacturer and commercial grade, official manufacturer evidence, all key properties (density, tensile strength, HDT, and continuous-use temperature) have verified official claims with standard and condition, and no physical/source conflict.
- Medium: confirmed manufacturer and commercial grade, at least one reliable manufacturer, official-datasheet, academic, or distributor source, and at least two key properties have verified or partially verified property-level sources.
- Low: identity is confirmed but the source, property coverage, standard, or condition evidence is incomplete.
- Quarantined: generated data, unconfirmed material identity, an obvious physical conflict, or a serious identity/property-source conflict.

Only High and Medium records enter normal recommendation. Low records are reference-only. Quarantined records are blocked from recommendation, comparison, and AI analysis.

## Recommendation evidence statuses

- `satisfied`: a verifiable property claim meets the detected condition.
- `not_satisfied`: a verifiable property claim fails the detected condition.
- `unknown`: the required property value is missing.
- `unverifiable`: a value exists but its source, standard, condition, or verification status is insufficient.

A critical `not_satisfied` condition rejects the material. A critical `unknown` or `unverifiable` condition prevents a Verified Match.

FDA, UL 94, RoHS, and REACH requirements are satisfied only by a dedicated
certification record with a positive status, a verified High/Medium claim, and a
named HTTP(S) manufacturer or official source. A property or identity source
alone does not satisfy certification.

## Production import

Dry-run:

```powershell
npm.cmd run import:real-materials -- --file data/pilot/pilot-materials.reviewed.json --dry-run --operator "reviewer" --source "manual pilot"
```

Commit one validated file:

```powershell
npm.cmd run import:real-materials -- --file data/pilot/pilot-materials.reviewed.json --operator "reviewer" --source "manual pilot"
```

Roll back only one batch:

```powershell
npm.cmd run rollback:real-materials -- IMP-BATCH-ID --operator "reviewer"
```

Formal import is a single SQLite transaction. A severe validation or database
error rolls back the complete batch. Re-importing the same file hash returns the
existing batch without adding rows. If evidence is shared by another committed
batch, rollback transfers ownership to that batch and retains the evidence.
