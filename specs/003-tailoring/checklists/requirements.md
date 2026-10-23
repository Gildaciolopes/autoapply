# Specification Quality Checklist: Resume Tailoring with Evidence Validation

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-15
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Defaults chosen instead of clarification markers: bullets verbatim (only selection/order change);
  summary ≤ 4 sentences; letter ≤ 250 words; output language = base resume language; auto-tailoring
  off by default (N = 5 when on); one retry on validation failure; screening-question traps deferred
  to F4 (eval designed to be extended).
- `make eval` from the input is the "repeatable evaluation" (FR-014); command names stay in plan.
