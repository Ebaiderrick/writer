---
name: team-assembly-interface
description: Rebuild or restyle Wraita collaboration and workspace-sharing modals so they match the compact Team Assembly interface: slim modal shell, tight hero copy, inline link and copy actions, same-height sharing and roles cards, compact member pills, and minimal footer spacing. Use when a modal should feel like Wraita's current Team Assembly surface rather than a generic settings dialog.
---

# Team Assembly Interface

Use this skill when a collaboration modal, workspace access popup, invite sheet, or member-role dialog should inherit Wraita's compact Team Assembly pattern.

## Workflow

1. Inspect the target modal and compare it against the current Team Assembly reference.
2. Keep the modal shell slim before changing inner cards:
   reduce title margin
   reduce footer spacing
   keep close/cancel actions pill-sized
3. Build the body as three compact zones:
   shared workspace controls hero
   sharing card
   members and roles card
4. Keep the hero tight:
   one short heading
   one tiny helper line
   workspace code and member count on the right
   title field and save action on one line
5. Keep sharing actions compact:
   link field and copy action on one line
   email, role, and invite action on one line at desktop width
   avoid stacked controls unless the viewport forces it
6. Keep the lower cards visually paired:
   same row height
   same padding
   same border radius
   same control heights
7. Reload and verify the rendered modal, not only the source files.

## Rules

- Prefer the existing `workspace-popup` family instead of inventing a new modal structure.
- Keep explanatory text short and visually secondary.
- Use pill controls and compact heights; default target is roughly 32px for inline controls.
- Keep action buttons short: `Copy`, `Save Name`, `Invite by Email`, `Close`.
- Make the sharing and roles cards feel uniform in width, height, and spacing rhythm.
- Avoid duplicated headings such as repeating `Team Assembly` both in the modal title and inside the hero.
- If localhost appears stale, verify the served directory and asset version before assuming the CSS failed.

## Reference

Read [references/team-assembly-pattern.md](references/team-assembly-pattern.md) before implementing. It captures the reusable structure, spacing rules, and validation checks from the current Team Assembly modal.
