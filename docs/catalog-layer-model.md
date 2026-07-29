# Polymer family and commercial-grade catalog layers

## Layer 1: Polymer Family

The educational family catalog is defined in `polymer-families.js`. A family
record has:

- `familyId`
- `canonicalName`
- `chineseName`
- `abbreviations`
- `polymerType`
- `description`
- `typicalProperties`
- `advantages`
- `limitations`
- `commonApplications`
- `processingMethods`
- `modificationMethods`
- `learningSources`
- `verificationStatus`

Every family record also has `entityType: polymer_family` and
`recommendationEligible: false`. Family typical-property fields are structurally
available, but their numeric range, unit, and source remain `null` until a
reviewed learning source is entered. The UI explicitly says that a typical
family range cannot replace a commercial-grade TDS.

The initial learning set contains the seven requested families: ABS, PC, PA66,
POM, PP, PEEK, and TPU. These are family identities, not commercial grades.

## Layer 2: Commercial Grade

Commercial grades remain in the evidence-backed SQLite model:

- exact identity: manufacturer + commercial grade + material family;
- material-level identity evidence;
- property-level evidence with independent test context and source;
- certification evidence;
- verification status and confidence level.

Only `real_material_identities` establishes a production commercial-grade
identity. The importer never fuzzy-matches the material name, brand, family
page, or a legacy row. A new reviewed identity therefore cannot merge with an
old generated record that happens to use similar text.

## Compatibility fields

The existing `materials` table keeps every legacy row and adds:

| Field | Allowed meaning |
| --- | --- |
| `record_type` | `legacy` or `commercial_grade` |
| `record_origin` | `legacy`, `generated`, or `imported` |
| `scope_status` | `in_scope` or `out_of_scope` |
| `catalog_visibility` | `public`, `review`, or `admin_only` |

The migration is lossless. Existing records are `legacy` and `admin_only`.
Records with generated lineage are also marked `generated`; metals, ceramics,
and glasses are marked `out_of_scope`. A real importer-created shell is
`commercial_grade`, `imported`, `in_scope`, and `review`.

## Visibility and recommendation boundaries

Public family search and commercial-grade search are separate:

1. Polymer Families
2. Verified Commercial Grades
3. Potential Commercial Grades with Missing Evidence

Reference, legacy, generated, out-of-scope, and quarantined records are absent
from the public material API. They are available only through an explicit audit
mode/API and never populate the recommendation service's material array.

Trusted statistics count:

- polymer families;
- High/Medium verified commercial grades;
- property evidence points that have a value, unit, trusted source title and
  URL, a verified/partially verified status, and High/Medium confidence;
- non-quarantined imported commercial grades awaiting review.

Audit statistics separately count legacy material rows, legacy property rows,
generated rows, quarantined evidence rows, quarantined material rows, and
out-of-scope rows.
