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

## Evidence-derived catalog values (FA-003)

Public list/detail responses add `propertyProjections` for four properties. See
[the evidence model](material-evidence-model.md#canonical-property-projection-fa-003)
for eligibility, ambiguity, provenance and compatibility rules. Cards and compare
use this server representation; they do not choose raw claims independently.

`minTensileMpa` and `minTempC` use verified projection keys in SQL before page
selection. Only PASS enters an active threshold result; FAIL and UNKNOWN do not.
An omitted threshold does not exclude a material because that property is
missing. Density sorts ascending; strength and continuous-use temperature sort
descending. Missing/conflicting/ambiguous keys sort last, then lowercase name
and material ID keep pagination deterministic. Correlated aggregates preserve
one material per row; count and self-excluding facets use the same predicates.

Existing performance-facet heuristics, public boundary and runtime quality
remain unchanged. In particular, the heat-resistant facet's legacy temperature
heuristic is independent of the explicit continuous-use threshold. This change
does not fix the separately tracked normalized-source stats/admin discrepancy
(FA-004) or all legacy thermal consumers (FA-005). It does not write scalar
columns, migrate schema, change importer behavior, or change recommendation rules.

## Scoped Stats and Admin parity (FA-004B)

FA-004B implements the approved R-A / I-A / A-A / T1-A / T2-A / S-A
decisions. This section qualifies the earlier catalog descriptions with the
current implementation boundary; it does not reopen FA-003 or authorize data
release. See [the source qualification contract](material-evidence-model.md#scoped-source-qualification-fa-004b).

Stats retains the existing PUBLIC_BOUNDARY and canonical High/Medium material
membership. Within that membership, each qualifying property evidence ID
contributes at most one point. Qualification requires its own valid source
relation and material identity support, a trusted source type/title/raw HTTP(S)
URL, value, nonempty unit, verified or partially verified claim status, and
High/Medium claim confidence. Generated, quarantined and conflicting evidence
does not qualify. These point requirements do not become new canonical quality
thresholds or FA-003 numeric eligibility rules.

Multiple properties or test conditions supported by one source can each count.
Repeated import ownership links cannot multiply a point; the query does not
join those links. Distinct IDs still count separately when the records
otherwise duplicate each other. This is record counting, not evidence of
independent experiments or semantic deduplication. A canonical Medium material
can have zero points, for example without an eligible verified/partially
verified identity evidence anchor.

### Admin quality and derived audit state

Admin search, count, ordering and pagination remain SQL operations. Only the
selected page is hydrated and evaluated by the existing assessMaterialQuality()
authority. Source representation alone must not turn the same canonical Medium
material into Admin Low. The previous SQL grade is retained only where needed
to preserve operational quarantine, not as displayed data_quality authority.

Authenticated audit list/detail responses add a read-only derived audit_state:

| Field | Values |
| --- | --- |
| access | audit_only or catalog_boundary_eligible |
| hold | quarantined, review_required or none |
| reasons | Unique, deterministically ordered business reason codes |

Access reports the existing public boundary; it does not grant publication.
Hold preserves old operational isolation and canonical quarantine, and reports
source/evidence review needs separately from quality. Canonical Low with a
quarantined hold, or canonical Medium with an admin-only quarantined hold, are
valid combinations. Codes include admin_only, claim_quarantined,
source_identity_context_mismatch and insufficient_quality_evidence.
Certification quarantine contributes an audit hold without independently
invalidating all property points. Ordinary source_metadata_conflict is a
review diagnostic, not a veto on an otherwise qualified point.

A none hold does not establish production approval, completed human review or
factory readiness. No client write, database state column or release override
is introduced. Existing Bearer authentication remains required; public material
responses, recommendation candidates and AI contracts do not receive
audit_state. Its audit-only serializer admits only access, hold and reasons.
Existing raw audit summary definitions remain unchanged and are not a
histogram of derived holds.

The original FA-004B adaptive batching failed on a single material with 2,506
property claims. FA-004B-R1 replaces only the Admin retrieval path with the
provisional capacity contract below. Public hydration and the independent Stats
builder retain their existing behavior; this is not a global high-fanout fix.

### Admin capacity contract (FA-004B-R1, provisional)

One read transaction starts before count and covers the original SQL-selected
page, scalar admission, every evidence stream, canonical quality and scoped
audit evaluation. Count, search, page membership and order are unchanged. Base
row byte admission runs before the large text fields are decoded into JS.
Admission counts the actual canonical and scoped projections separately,
including repeated evidence across those streams.

All nine Admin streams use explicit `LIMIT 1000`: tags, uses, legacy sources,
identity evidence, property evidence, certifications, active identity, scoped
identity evidence and scoped property evidence. Hydration processes one material
at a time. It completes every stream before evaluation; it never treats an
admitted prefix as a complete material. Tags/uses seek by schema position, ID
streams by primary key, and properties by the original SQLite
`(property_key, position)` order. Property continuation resolves the previous
actual ID back to its raw SQLite tuple in the same snapshot. Normalized JS text
(including NUL/BOM changes) is not cursor authority. Missing or invalid cursors
are failures, not end-of-stream. Complete evidence and the original canonical
evaluator remain the quality authority. The existing quarantine serializer is
unchanged; capacity is not a new reason to truncate a non-quarantined response.

| Budget | Provisional limit |
| --- | --- |
| Each SQL evidence chunk | 1,000 rows |
| Raw projected row / decoded row proxy | 32 KiB / 64 KiB |
| Accumulated streams per material | 12,000 rows / 3 MiB raw |
| Complete encoded material object | 4 MiB |
| Accumulated streams per page | 16,000 rows / 4 MiB raw, including base rows |
| Complete encoded page object | 8 MiB |
| Uncompressed UTF-8 response JSON | 4 MiB |
| In-flight accounted representation estimate | 32 MiB |
| SQL attempts / delivered rows / logical work | 4,096 / 20,000 / 40,000 |
| Active Admin tickets / application waiting queue | 1 / 0 |
| Cooperative request preparation time | 4,000 ms |
| Fixed Admin statement cache | At most 64 entries |

KiB is 1,024 bytes; MiB is 1,048,576 bytes. Equality is allowed. Encoded object
sizes and the decoded-row/in-flight proxies are accounting limits, not measured
V8 heap bounds. Exact JSON byte counting precedes full response string/Buffer
allocation. Final DTO, UTF-8 and optional gzip representations are accounted
conservatively before allocation. SQL attempts include transaction and failed
preparation calls; delivered rows include metadata and failed-chunk work.
Logical work includes admission input rows and delivered rows. No claim is made
that this metric bounds SQLite VM instructions or CPU time.

Only typed Admin capacity failures produce HTTP 503 with
`{"error":"Admin request exceeds capacity","code":"admin_capacity_exceeded"}`
and `Cache-Control: no-store`. They contain no partial items or internal budget
detail. Ordinary SQL/evaluator/serialization errors retain their error category.
Authentication and rate limiting precede ticket acquisition. Public, AI and other
API paths do not acquire this ticket.

The ticket spans preparation through response `finish`/`close`, with idempotent
release on errors, aborts and timeouts. Iterators and transaction ownership are
cleaned before request reuse. Request preparation has a cooperative 4,000 ms
budget checked at synchronous boundaries. This does not interrupt a running
SQLite statement, evaluator, JSON operation or gzip operation, and is not a
hard end-to-end HTTP deadline.

A separately approved Admin write idle limit is 4,000 ms of continuous lack of
observable transport write completion. Its clock starts only in the response
write phase and resets on a successful positive-byte write callback, not merely
on enqueue. After headers, expiry destroys the connection; it cannot send K1
JSON. Node write completion means progress into the local transport/OS buffers,
not acknowledgement or consumption by the remote client. Regression evidence
must distinguish controlled callback stalls from actual Linux/Render socket
backpressure. The four-second value is provisional; real Render backpressure,
resource baseline and mixed-load acceptance remain pending.

Target calibration uses isolated Linux at 0.5 CPU and 512,000,000 bytes instance
memory. The whole instance allowance is not a per-request budget. Runtime,
SQLite, existing workload and serialization need headroom. Linux fixture results
must identify source, runtime, actual cgroup limits and measurements separately
from production acceptance. This contract does not change canonical quality,
FA-003 verified-only filter/sort semantics, recommendation behavior, the Stats
artifact format, the 1,000-row guard, schema or real material data.

### Revised normal48 performance acceptance (FA-004B-R1)

Decision `FA-004B-R1-NORMAL48-120-2026-10-09`, approved on 2026-10-09,
changes only the normal48 preparation p50 target from 100 ms to 120 ms.
Its p95 limit remains 500 ms. All other performance limits are unchanged:

| Admin performance scenario | Preparation p50 limit | Preparation p95 limit |
| --- | --- | --- |
| normal48 | 120 ms | 500 ms |
| normal200 | 750 ms | 1,000 ms |
| single2506/Admin48 | 750 ms | 1,000 ms |
| single2506/Admin200 | 1,000 ms | 1,500 ms |
| double2506/Admin200 | 1,500 ms | 2,000 ms |
| outside-budget K1 | 250 ms | 750 ms |

The original preparation window is unchanged: Admin ticket acquisition through
count/admission, complete evidence hydration, canonical evaluation, DTO and body
preparation, before response writing. It excludes public-network transmission
and proxy queuing. Nearest-rank p50/p95 are judged independently for each
process's 100 formal measurements; its one cold request and five warmups remain
recorded but do not enter those percentiles. Source/fixture identity and the
isolated Linux target are unchanged; process samples are not pooled and observer
cost is not subtracted to manufacture a passing value.

FA-004B-R1-FAG records engineering acceptance PASS under this revised contract,
using the original formal Observer ON runs as primary evidence and CR1's
interleaved runs as corroboration. The three original formal normal48 failures
and seven CR1 failures remain FAIL under the old 100 ms contract. This is a
prospective acceptance decision, not a retrospective correction of historical
verdicts or raw samples, and does not make Observer LOW the sole valid protocol.

All capacity budgets and safety semantics above remain unchanged, including the
1,000-row SQL guard, complete canonical evidence and output, source qualification,
Admin authentication, typed K1 and the separate 4,000 ms preparation and write
idle clocks. Linux resource acceptance lines remain RSS 384 MiB, phase heap
192 MiB and observed RSS increase 288 MiB; accounted proxies are not hard heap
bounds, and preparation remains cooperative.

This is isolated engineering performance acceptance only. Actual Render cgroup
limits, Node/SQLite runtime, baseline RSS, mixed public/Admin/AI load and sustained
socket backpressure remain pending independent verification. It does not grant
production performance acceptance, real-material publication or release approval,
and does not close FA-004B or SEC-02.

### Artifact v1 and unresolved scope

T2-A retains artifact format v1, its four aggregates,
verifiedCommercialGrades + materialsAwaitingVerification = publicMaterialTotal,
generation verification, dataset/policy digest checks and atomic sidecar
publication. Scoped policy changes require the existing builder to produce a
matching artifact for the same isolated dataset; digests/counts are not edited
manually.

The earlier description of awaiting records as non-quarantined is an intended
semantic distinction, not a property proven by the current v1 partition. Some
canonical quarantined materials can pass the unchanged PUBLIC_BOUNDARY and
remain in awaiting. T2-A preserves this known discrepancy for a separate
versioned counting contract; it does not permanently approve quarantined
records as awaiting review or remove the validation equation.

**GLOBAL SOURCE RELATION CONSISTENCY: NOT FULLY RESOLVED UNDER S-A**

Canonical orphan fallback, permissive global URL acceptance, shared-source
identity hydration, FA-003 source applicability and recommendation source
qualification remain outside this implementation. Stats/Admin parity does not
establish global policy closure or authorize a production import. FA-005 is
unchanged; FA-003 production performance acceptance remains pending.
