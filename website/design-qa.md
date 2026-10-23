# Design QA — Квеста

final result: passed

## Evidence and normalization
Source: C:/Users/Алексей/.codex/generated_images/01a0a3bb-5113-7a53-b75e-6564b939fda8/exec-c1d1b164-4204-479c-bb6e-a5b35b4b315e.png
Source pixels: 1086 x 1448. Nominal design width: 1440 CSS px.
Implementation: http://127.0.0.1:4183/.
Desktop screenshot: qa/desktop-final.png, 1440 x 2050 pixels; 1440 x 1920 CSS viewport, deviceScaleFactor 1, full page. Mobile: qa/mobile-final.png, 390 x 844 CSS viewport, full page.
State: initial page, empty title, no open dialog/audience.
Full comparison: qa/comparison-final.png. Both images scaled uniformly to 1080 px width and top-aligned; added footer extends implementation. No height stretching.
Focused comparison: qa/type-comparison.png; matched hero text regions, approximately 1.32 source and 0.99 implementation scale.
Browser: isolated Playwright/Chrome; user explicitly authorized fallback after native browser tools failed.

## Comparison history and fixes
1. qa/comparison-before.png: P2 small/light headings and supporting text; undersized phone. Increased typography and weights, adjusted phone size/angle in src/refinements.css.
2. P2 demo retained answer after closing; clicking dialog padding dismissed it. Content now unmounts on close, backdrop hit test uses dialog bounds. Escape and focus return tested.
3. Introduced missing JSX brace detected in verification; corrected and reran in fresh browser session. Final console clean.
4. P2 third-step wrapping displaced its panel. Shortened copy to three lines. Re-captured qa/desktop-final.png and rebuilt qa/comparison-final.png; alignment verified.
5. Final combined full and focused visual review: no actionable P0/P1/P2 remaining.

## Required fidelity surfaces
- Typography: Manrope/Caveat loaded; Cyrillic hierarchy, four-line hero, buttons and body checked. Real fonts approximate generated letterforms.
- Layout: split hero, photo/phone overlap, aligned three steps, audience row and AI band retained. No horizontal overflow at 320/390/768/1024/1440. Mobile stacks content.
- Colors: saturated blue, ink, cream and pale-blue AI section preserved. Soon badge darkened for legibility. Visible focus styles retained.
- Images: original brand; generated library photograph and transparent phone consistent with reference. Expected differences in faces/crop/device artwork. No broken assets. Icons are Tabler files, not custom drawings.
- Copy: selected headings retained; future AI clearly labeled. Fake active quest replaced by honest demo action; third-step copy shortened without changing meaning. Small footer is an intentional extension.

## Functional validation
Evidence: qa/verification.json; scripts/verify-landing.mjs.
At 390 and 1440: wrong/correct answers, reopen reset, Escape, focus return, padding click, close button, every audience toggle, title count, disclosure, AI selection/submission passed.
Anchors passed. Outbound clicks resolve to configured /access/code and /quests/new; intercepted locally, real production authentication not tested.
Final run: no page exceptions, console errors or broken images.
Prototype and main npm run build passed. Root npm run lint exit 0 with existing React memoization warnings in QuestPlay.jsx.
State screenshots: qa/demo-success-390.png, qa/demo-success-1440.png, qa/ai-form-390.png, qa/ai-form-1440.png.

## P3 polish and limits
Colored decorative flourishes/background waves simplified or omitted; no code-drawn replacements. Main imagery, hierarchy and palette preserved.
Google Fonts still external. Real mobile hardware, Safari and screen readers not tested; widths emulated in Chrome. Production authentication and registration not tested.
AI form explicitly demonstrates interaction without sending personal data or subscribing to notifications. No deployment. Main app source unchanged.

## Update — 2026-09-16
User-requested changes: three-task demo, renamed events audience, clearer step 2.
- Component src/QuestDemo.jsx: choice, text answer (case/space normalization), code, progress, final result, restart. All data are public demo fixtures, not private quest content.
- Step 2 now explicitly refers to the service editor; static task ingredients and working example CTA replace misleading disclosure controls. Its taller panel is an intentional requested content change.
- Audience label updated everywhere to «Мероприятия и праздники».
- Updated desktop screenshot 1440 x 2099, mobile 390 x 3130; comparison-final.png regenerated and visually inspected with source. Hero and other sections preserved; changed section and final demo state inspected on desktop/mobile. No P0/P1/P2 issues found. Earlier focused hero comparison remains valid: hero unchanged.
- verify-landing.mjs passed at five widths; at 390/1440 tested wrong and correct answers in each of all three tasks, normalization, next transitions, final result, restart, close/reopen, focus, new step-2 CTA, audience and AI form. Console clean. Root lint exit 0 with prior QuestPlay warnings; both builds passed.
- Hosting remains local-only. Suggested architecture: independent landing at qvesta.ru and app at app.qvesta.ru. Neither domain routing nor hosting provider has been configured by this task.
