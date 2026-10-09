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

## Canonical property projection (FA-003)

`property-projection-policy.js` owns `property-projection-v1` for density,
tensile strength, HDT, and continuous-use temperature. Its shared definitions
produce both JS projection and SELECT-only SQL eligibility/key expressions.
The repository executes SQL before count/order/pagination, then hydrates only
page evidence. The frontend consumes the server's `propertyProjections`.

Eligible claims require their own reliable source, high/medium confidence,
canonical units, finite valid values, and recorded standard/condition. Source
resolution joins `evidence_sources` and uses field-wise normalized-first NULL
fallback; an empty normalized field does not fall back. Partially verified
claims can appear with annotations in display/compare, but cannot supply a
query key. A key requires one typical context/value supported by verified
claims. A partially verified disagreement prevents that key. Explicit conflict
or quarantine blocks the property even when another usable claim exists.

States are `single`, `range` (observed, not guaranteed), `multiple`, `unknown`,
and `conflicting`. Duplicate observations retain provenance. Context comparison
only trims ASCII edge spaces and folds ASCII case; load spelling, internal
spaces, standards and units are not inferred equivalent. No max/min/latest
claim winner or unit conversion resolves ambiguity. HDT remains condition-bound
and never has a generic query key. Continuous-use evidence requires its exact
property key; max temperature, HDT, RTI and melting point cannot supply it.

Public density/tensile/continuous-use compatibility aliases derive from the
verified query key or are null. Stored legacy scalar columns remain unchanged;
missing imported evidence never falls back to them. Audit/learning paths and
recommendation-v3 semantics remain separate. Detail retains all original
normalized evidence and source records. Projection previews cap context groups
at 12 and values/source refs at 8 per group, include full counts, mark incomplete
previews, and link to the existing complete evidence detail.

## Scoped source qualification (FA-004B)

The approved R-A / I-A / A-A / T1-A / T2-A / S-A decisions add source
qualification for Stats points and audit diagnostics. They do not replace
canonical quality, global hydration, PUBLIC_BOUNDARY, FA-003 numeric projection,
recommendation semantics, schema or importer.

Ordinary source metadata resolves field by field, normalized first, with inline
fallback only for a normalized NULL. Empty strings do not trigger fallback,
including after trimming. A non-NULL source_id with no registry row is an
invalid relation: complete inline text cannot rescue Stats/Audit qualification.
Verification/confidence remain claim-owned; no source-level verification is
invented. Raw and resolved generated sources and claim quarantine remain
excluded from trusted qualification.

Trusted types remain manufacturer, official_datasheet, academic and distributor.
A title must be nonempty after existing text cleanup. URL qualification uses the
raw string: HTTP(S) scheme, nonempty authority starting with a character other
than /, ? or #, and no ASCII whitespace/control character (U+0000–U+0020 or
U+007F). Surrounding whitespace is not repaired; https://? is invalid. This
limited syntax check proves neither DNS, certificates, reachability nor
document authenticity.

Scoped SQL reads retrieve relevant text as BLOB bytes and decode UTF-8 without
dropping embedded NUL; invalid UTF-8 fails closed. A driver text boundary cannot
silently truncate a hostile raw URL before qualification. Stats and Audit share
one JS qualification rule set, not separate approximate SQL URL/identity rules.
SQL still uses material-ID-correlated indexed reads and source-primary-key
LEFT JOINs. For source type/title/URL/date, meaningful nonempty inline and
normalized disagreement adds source_metadata_conflict without changing
precedence or point qualification. An inline unknown type is not meaningful
conflicting metadata. Identity mismatch and invalid references remain separate
blocking conditions.

### Material-specific source support

Source reuse is valid storage behavior, not proof that a document supports
every referencing grade. The baseline is the current active
real_material_identities triple plus identity evidence belonging to that
material. A qualified identity anchor needs valid source metadata and a
verified or partially verified claim status. A canonical Medium result with
only an unverified identity anchor can therefore coexist with zero scoped
Stats points; canonical quality is not changed to hide this distinction.

Qualification compares raw claim manufacturer/grade/family with active
identity, and independently checks any non-NULL registry context. Registry
context is not coalesced over the claim and then treated as proof of a match.
Explicit disagreement produces source_identity_context_mismatch; absent
support or ambiguous equivalence produces unresolved_source_identity_context.
A valid second identity anchor does not erase an invalid or conflicting
identity binding. Each property needs its own applicable source relationship;
another material's identity source cannot supply it.

Identical nonempty raw strings, including identical Unicode spellings, are
unambiguously equal. For differing ASCII strings, comparison implements the
existing Python identity_key subset: ASCII case folding and collapse of
Python-recognized ASCII whitespace. Differing strings containing non-ASCII
characters are held for review because full NFKC/casefold equivalence has not
been implemented or proved here. SQLite LOWER, fuzzy names and brand matching
are not substitutes. Valid Unicode variants may therefore be conservatively
rejected pending review.

NULL registry context does not mean universal document coverage: material-owned
identity proof and claim support are still required. A document whose recorded
context names another grade is held even if a real multi-grade document might
exist. This is unresolved support, not proof that the official document is
false. Persisting reviewed multi-grade coverage requires a separate authorized
data/model task.

### Points, isolation and compatibility

Each eligible property evidence ID contributes once within existing public and
canonical material membership, subject to its own value, unit, applicable
source, verified/partially verified status and High/Medium confidence. Source
IDs, URLs, property keys and ownership references are not counting units.
Distinct IDs for duplicate rows continue to count as records; distinct
conditions can contribute separately. No semantic deduplication is introduced.

Admin uses canonical quality after bounded page hydration and adds the
read-only [audit state](catalog-layer-model.md#admin-quality-and-derived-audit-state).
Certification quarantine remains an audit signal with existing certification/AI
rules; it does not become a blanket property-point veto. Stats unit/confidence
requirements are not added to canonical quality. Partially verified numeric
evidence still cannot supply a FA-003 filter/sort key.

T2-A preserves artifact v1, generation/digest checks and its awaiting partition,
including the documented canonical-quarantine discrepancy. Changing this
partition requires a separate versioned contract.

**GLOBAL SOURCE RELATION CONSISTENCY: NOT FULLY RESOLVED UNDER S-A**

Global canonical orphan/URL behavior and shared-source identity hydration
remain unresolved, as do applicability corrections for FA-003 and
recommendation. Scoped negative qualification and audit warnings do not claim
those consumers were repaired. This contract grants no production release,
database import, schema change or later S-B implementation authority.
