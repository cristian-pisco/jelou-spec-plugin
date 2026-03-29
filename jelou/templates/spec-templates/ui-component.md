# Template: UI Component

## Description
New UI component with states, interactions, accessibility, and responsive behavior.

## Pre-filled Sections

### Problem Statement
<!-- FILL: What user interaction does this component enable? -->

### Functional Requirements
- FR-1: Component behavior — what it does when the user interacts with it
- FR-2: Props/inputs — data the component receives from its parent
- FR-3: State management — internal states and transitions
- FR-4: Events/outputs — callbacks or events emitted to the parent
- FR-5: Loading state — what the user sees while data is being fetched
- FR-6: Empty state — what the user sees when there is no data
- FR-7: Error state — what the user sees when something goes wrong

### Non-Functional Requirements
- NFR-1: Accessibility — keyboard navigation, screen reader support, ARIA labels
- NFR-2: Responsive behavior — how the component adapts to mobile, tablet, desktop
- NFR-3: Performance — render time budget, virtualization for large lists
- NFR-4: Browser support — minimum browser versions

### Constraints
- Must follow existing design system tokens (colors, spacing, typography)
- Must work with existing state management approach
- Must not introduce new CSS framework or utility library

### Out of Scope
<!-- FILL: What this component intentionally does NOT handle -->

### Success Criteria
- SC-1: All interaction states (loading, empty, error, success) implemented and tested
- SC-2: Keyboard navigation works for all interactive elements
- SC-3: Component renders correctly on mobile (375px) through desktop (1440px)
- SC-4: No accessibility violations reported by automated audit

## Interview Hints
- What are all the visual states? Draw the state machine: idle -> loading -> success/error/empty
- What happens on click, hover, focus, blur for each interactive element?
- Does this replace an existing component or is it entirely new?
- What data does it need? Where does that data come from (prop, API call, store)?
- Are there animations or transitions between states?
- What's the touch target size on mobile? (minimum 44x44px per WCAG)
- Does it need to work inside a form? If so, how does validation display?
