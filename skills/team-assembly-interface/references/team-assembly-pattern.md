# Team Assembly Pattern

## Use this reference for

- workspace sharing modals
- invite and role dialogs
- collaboration settings popups

## Modal shell

- Keep modal width restrained; current pattern is around `820px` max.
- Keep shell padding lean.
- Use a small title row and a compact footer.
- Keep the footer close button as a small pill aligned right.

## Hero card

- Heading: `Shared workspace controls`
- Helper line: one small line only
- Right meta: workspace/script code plus member count
- Input row: workspace name field plus `Save Name`
- Avoid empty vertical space above or below the helper line

## Lower card pair

Two cards sit side by side:

1. `Sharing`
2. `Members & Roles`

Keep them:

- equal in height
- equal in padding
- equal in corner radius
- aligned on the same baseline

## Sharing card

First row:

- workspace link input
- `Copy`

Second row:

- invite email
- role dropdown
- `Invite by Email`

Desktop rule:

- keep all three invite controls on one line
- do not let the invite button drop under unless the viewport is actually narrow

## Members & Roles card

- Use a short one-line helper sentence
- Use compact role pills/selects
- Use compact member rows
- Keep `Remove` destructive actions short

## Control rhythm

- Inline controls target about `32px` height
- Use full pill radii for inputs and buttons
- Keep button text short
- Keep helper copy visually secondary

## CSS hooks in current implementation

- `.modal-content-workspace`
- `.workspace-popup`
- `.workspace-popup-card`
- `.workspace-popup-hero`
- `.workspace-title-row`
- `.workspace-share-row`
- `.workspace-share-row-compact`
- `.workspace-invite-inline-row`
- `.workspace-popup-section-sharing`
- `.workspace-popup-section-roles`
- `.workspace-member-list`

## Validation checklist

- Modal title does not feel oversized
- Hero helper text is one line
- Link and copy stay on one line
- Invite email, role, and button stay on one line
- Sharing and roles cards match height
- Footer area is not bulky
- Browser is serving the intended workspace folder
