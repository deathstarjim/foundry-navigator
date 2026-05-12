# Foundry Navigator

Foundry Navigator adds keyboard-first and screen-reader-friendly improvements to Foundry VTT, with the current implementation focused on **D&D 5e on Foundry VTT v13**.

## Current Scope

The most complete and actively developed support is for:

- Foundry VTT v13
- D&D 5e system
- Tidy 5e Sheets and the default D&D 5e actor sheets

## What It Does

### Character Sheet Keyboard Navigation

Foundry Navigator adds keyboard support to D&D 5e character sheets, including:

- returning focus to the active sheet tab with `Alt+T`
- moving between tab controls with `Tab` / `Shift+Tab`
- activating tabs with `Enter`
- moving into the active panel and cycling through interactive controls
- leaving sheet focus cleanly with `Escape` or `Ctrl+Shift+Tab`
- spoken guidance when keyboard focus first enters a supported character sheet

Supported sheet implementations currently include:

- default D&D 5e actor sheets
- Tidy 5e Sheets, including the modern layout

### Inventory, Spell, and Action Flows

The module improves keyboard access to common row actions on supported D&D 5e sheets:

- inventory row actions
- spell row actions
- attack and use/roll buttons
- item context menus on Tidy 5e sheets
- roll configuration dialogs

It also restores focus back to the originating row after many attack and consumable flows complete, which makes repeated keyboard use much less frustrating.

### Keyboard-First Target Selection and Combat Follow-Up

For D&D 5e attack and consumable flows, the module adds accessible target selection and follow-up handling:

- keyboard target selection instead of relying on mouse-only targeting
- distance-aware target ordering
- self-first consumable targeting when appropriate
- hit/miss follow-up dialogs
- direct damage and healing application flows
- GM-mediated damage/healing application for players acting on unowned enemy tokens

This is meant to reduce or remove the need to chase chat cards and hover-only controls during combat.

### Screen Reader Announcements

The module includes screen reader live-region announcements for several Foundry events and gameplay states, including:

- chat messages
- roll results
- combat turn changes
- UI notifications
- token movement
- tokens entering or leaving the current scene
- HP / damage changes on owned actors
- status effects and condition changes on owned actors

There is also an `Alt+Shift+R` shortcut to re-read the most recent roll result.

### Helpful Keyboard Shortcuts

Current shortcuts include:

- `Alt+T`: return focus to the active sheet tab
- `Alt+Shift+R`: read the latest roll result
- `Alt+Shift+C`: open your current character sheet
- `Alt+Shift+A`: open Foundry Navigator settings
- `Alt+Shift+K`: open Configure Controls
- `W`: announce the controlled token's current position, HP, and conditions
- `Enter` / `Shift+Enter`: keyboard token interactions on the canvas

Many of these can be changed through Foundry's normal controls configuration.

## Installation

Install using the `module.json` manifest from the latest GitHub release.

If you are testing development builds manually, make sure the manifest and download URLs match real public release artifacts and that the release zip contains `module.json` at the root.

## Limitations

- Current navigation and screen-reader support is strongest on D&D 5e.
- Tidy 5e and default D&D 5e sheets are actively supported; other sheet systems are not guaranteed.
- This is still an ongoing effort; there are almost certainly workflows that need refinement.

## Acknowledgments

This project was inspired in part by earlier Foundry accessibility work from Cora (silvative), including the Accessibility Enhancements module. Foundry Navigator is maintained as its own D&D 5e-focused module.

## Bugs and Enhancements

Bug reports, keyboard workflow feedback, screen-reader feedback, and enhancement requests should be submitted through GitHub issues.

When reporting a bug, please include:

- Foundry version
- game system and version
- whether you are using the default sheet or Tidy 5e
- any relevant supporting modules
- exact reproduction steps

When suggesting an enhancement, please describe the table workflow problem you are trying to solve and what the expected keyboard or screen-reader workflow should be.

## Contributing

Code contributions are very welcome.

I do not personally use a screen reader, so direct feedback from players who do is especially valuable. Real testing feedback is often more useful than theoretical accessibility guesses.
