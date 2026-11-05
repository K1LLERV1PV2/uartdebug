# Product target

UARTDebug is developed exclusively for desktop and laptop PCs, using a desktop browser, mouse or trackpad, and keyboard.

Do not add phone/tablet layouts, mobile-specific state or controls, touch-only interactions, or mobile installation metadata. Keep ordinary PC browser window resizing and shared mouse/keyboard controls working. Use the existing shared UI components and panel behavior instead of adding duplicate variants.

# UI intent and critical review

- Treat sketches and wireframes as explanations of placement and relationships unless the user explicitly requests an exact visual reproduction. Separate the intended changes from shortcuts used to draw the example.
- Preserve the established shapes, styling and behavior of shared components. A schematic drawing does not authorize replacing finished components with its simplified lines or inventing requirements from incidental details.
- UI elements with the same purpose must share their appearance and behavior across the whole site, including AVR, Chat, UART and dialogs. Put their normal, hover, focus, selected, disabled, error and scrolling rules in the shared component. Page-specific rules may arrange content or express a different function, but must not restyle an equivalent component.
- When a consistency defect is found, inspect every use of that component and correct the shared implementation and its consumers together. Do not fix only the reported instance or add another parallel variant.
- Before implementation, check the proposed change against the user's intent, the existing interface and all affected states. Look for conflicting behavior, wasted space, unclear ownership, blocked controls and unnecessary new entities.
- After implementation, inspect the actual rendered result again from the user's perspective, including expanded, compact and transitional states at ordinary PC window sizes. Review both visual coherence and interaction logic; passing automated checks is not a substitute.
- Challenge the first interpretation and the first rendered result. Correct identified contradictions and repeat the review until they are resolved. When uncertain, identify the assumption instead of presenting it as a user requirement or claiming visual agreement without evidence.

# Independent assessment during implementation

- For every implementation or refactoring task in this project, start an additional, independent assessor agent before implementation and keep it involved throughout the work. Give it the user's actual request, relevant constraints, existing implementation and concrete evidence; do not give it a conclusion to endorse.
- The assessor reviews the proposed solution before coding, checks intermediate results while implementation continues, and reviews the final result before handoff. It must report concrete problems immediately. For interface changes this includes actual screenshots, wasted space, mismatched panel and content sizes, unclear ownership, inconsistent shared behavior, awkward interaction and regressions in expanded, compact, error and transitional states.
- The assessor is a critic, not another implementer. It should challenge the implementation and earlier assumptions; absence of overlap, successful tests or agreement with the primary agent does not establish visual quality.
- The primary agent must address reported problems, provide fresh evidence and request another assessment after a material correction. Before handoff, both agents must actively look for the criticism an ordinary user would immediately make of the delivered result and resolve it while the task is still in progress. Do not declare completion while a material problem remains unresolved, or leave an obvious defect as a suggested follow-up. Record any intentional tradeoff explicitly instead of silently dismissing a finding.
- If independent agents are unavailable, state that limitation; do not claim that an independent assessment took place.

# Publication

- Publish completed requested changes to uartdebug.com after the required checks and independent assessment, unless the user explicitly requests a local preview only. Publication is included in normal project work and does not require another confirmation.
- Use the normal CI and deployment safeguards. After deployment, verify the published revision, service readiness and the affected user flows on the live site before handing off the result.
