# Design QA — sidebar footer overlap

- Source visual truth: `/var/folders/1n/9pxbg4795vz0wrv5sp7dm_lc0000gp/T/codex-clipboard-783c935d-8885-47e9-b0b2-d25ac973f425.jpg`
- Implementation screenshots: `/private/tmp/mtr-sidebar-after-top.png`, `/private/tmp/mtr-sidebar-final.png`
- Combined comparison: `/private/tmp/mtr-sidebar-comparison-final.png`
- Viewport and CSS size: 1280 × 698 px
- Source pixels: 1280 × 698; implementation pixels: 1280 × 698
- Device scale / normalization: 1× CSS viewport; source and implementation compared at equal pixel dimensions
- State: authenticated demo user with project-manager and system-administrator permissions, `/analytics`; navigation captured at both scroll boundaries

## Full-view comparison evidence

The source shows the long desktop navigation extending underneath the absolutely positioned current-user card. In the revised implementation, the sidebar is a fixed-height flex column: the header is fixed, the navigation owns the remaining 485 px and scrolls internally, and the 149 px current-user card occupies a separate bottom row. Browser geometry reports `nav.bottom === footer.top === 549` and `overlap === 0`.

## Focused region evidence

The bottom-left region required focused review because the defect affects dense navigation text. At the top scroll boundary the user card starts below the visible `Роли` item without overlap. At the bottom scroll boundary `Словари`, `Логи агента`, and `Аудит` remain fully visible above the same card. The card copy and divider stay readable in both states.

## Required fidelity surfaces

- Fonts and typography: unchanged; existing font family, weights, sizes, line heights, wrapping, and truncation are preserved.
- Spacing and layout rhythm: corrected. Navigation and user card now have exclusive vertical regions; header, page grid, padding, radii, and content alignment are unchanged.
- Colors and visual tokens: preserved except for the navigation group labels, which move from `slate-400` to `slate-500` so their 10 px text reaches accessible contrast on white.
- Image quality and assets: no image or icon assets are involved in the sidebar fix.
- Copy and content: unchanged; all navigation labels, roles, and current-user text are preserved.

## Comparison history

1. Initial finding — **P1**: the absolute current-user card covered the last navigation entries at a 698 px viewport, making links hard or impossible to read and activate.
2. Fix: converted the desktop sidebar to a bounded flex column, made navigation `min-height: 0` with vertical scrolling, and returned the user card to normal flow as a non-shrinking footer.
3. Accessibility follow-up: increased the small navigation group-label token from `slate-400` to `slate-500` after the scoped axe check identified insufficient contrast.
4. Post-fix evidence: equal-size screenshots show independent navigation scrolling; measured overlap is 0 px; all final administrative links and the complete user card are visible. The scoped axe audit reports 0 violations.

## Findings

No actionable P0, P1, or P2 visual findings remain for the reported sidebar state.

## Follow-up polish

No P3 follow-up is required for this scoped correction.

final result: passed
