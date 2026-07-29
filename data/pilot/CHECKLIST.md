# Pilot material review checklist

Complete this checklist separately for every grade.

## Identity

- [ ] Manufacturer is copied exactly from an official or otherwise reliable
  identity source.
- [ ] Commercial grade is copied exactly; it was not composed from a family,
  filler, color, or marketing-style suffix.
- [ ] Material family is one of ABS, PC, PA66, POM, or PP for this pilot.
- [ ] Manufacturer + commercial grade + material family is unique in the file.
- [ ] Brand is `null` when the source does not state a brand.
- [ ] Identity source title and direct HTTP(S) URL open the intended document.

## Property evidence

- [ ] Density has a value, valid unit, source, test standard, and condition when
  the document provides them.
- [ ] Tensile strength has its own evidence record.
- [ ] HDT or another heat-related property has its own evidence record.
- [ ] Every different test method or condition is a separate measurement.
- [ ] `typical`, `minimum`, and `maximum` are copied as stated; `estimated` is
  not used for the real pilot.
- [ ] Missing standards or conditions remain `null`; they are not inferred.
- [ ] Values are checked against the broad family plausibility gate.

## Certifications

- [ ] FDA, UL, RoHS, or REACH is entered only as a certification record with a
  dedicated source.
- [ ] Certification status and scope are copied from that evidence.
- [ ] Marketing text alone is not treated as certification evidence.
- [ ] `certifications` remains empty if no independent evidence exists.

## Review and import

- [ ] No field contains `PLACEHOLDER`, an empty string, a made-up URL, or a
  made-up standard.
- [ ] Pre-import validation reports zero errors.
- [ ] Production importer dry-run reports zero rejected records.
- [ ] A second reviewer checked identity, values, units, conditions, and links.
- [ ] Operator/source metadata is supplied for the committed import.
- [ ] The returned `importBatchId` is saved with the review notes.
