# Database storage and index audit

- Database: `C:\Users\35766\Documents\New project\matfinder.db`
- File size: 102,973,440 bytes
- Free-list space: 0 bytes

## Largest objects

| Object | Bytes | Pages |
| --- | ---: | ---: |

## Exact duplicate evidence

- material_evidence: 0 duplicate groups, 0 excess rows
- material_property_evidence: 0 duplicate groups, 0 excess rows
- material_certifications: 0 duplicate groups, 0 excess rows

## Source text

- Inline source-text bytes: 1,382,561
- Repeated inline source rows: 7,310
- Normalized source rows: 0

## Potentially redundant indexes

- `idx_material_certifications_material` is covered by `idx_material_certifications_name`.
- `idx_property_evidence_material_property` is covered by `idx_property_evidence_context`.

No material or evidence row was deleted during this audit.
