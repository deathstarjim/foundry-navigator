### v0.12.0

- Removed older feature modules for add-item helpers, audio cues, alternate sheet styling, and compendium image previews so the module is focused on the current D&D 5e keyboard and screen-reader workflow.
- Replaced the old no-right-click script with a dedicated canvas keyboard interaction script for `Enter` and `Shift+Enter` token actions.
- Updated README, package metadata, and license metadata to describe Foundry Navigator as its own D&D 5e-focused module.
- Added screen reader announcements for each step of the combat tunnel so target selection, attack confirmation, damage application, and recovery/focus transitions are all narrated from start to finish.
- Added HP/damage change announcements for owned actors via `announceHpChanges` setting: screen reader announces damage taken, healing received, and temporary HP changes including current HP totals.
- Added condition/status effect announcements via `announceConditions` setting: screen reader announces when active effects or statuses are applied to or removed from owned actors, with deduplication to prevent double-firing.

### v1.0.1

- Renamed and normalized the module around the `foundry-navigator` ID so Foundry settings and keybindings resolve correctly after the module rename.
- Fixed stale internal module-ID references that were preventing the module from appearing reliably under `Foundry Navigator` in Configure Settings.
- Corrected module file paths after the module rename.
- Improved screen-reader support in Configure Settings by enhancing the Foundry Navigator settings controls with stronger labels and spoken hints on focus.
- Added spoken narration for attack and damage roll dialogs so screen-reader users get immediate context and action guidance when the combat tunnel opens.
- Refactored the combat-tunnel activation path to be row-centric instead of tab-centric, improving reliability when focus lands on sub-elements like Tidy 5e item images.
- Split combat activation and inventory activation concerns into dedicated helper modules to keep `scripts/sheettabs.js` from growing into another monolithic file.
- Verified the rename cleanup and row-centric combat flow with the Playwright `alt-t-smoke` suite.

### v0.5.1

- Improved release packaging for GitHub/Forge installs by fixing the release workflow and module archive contents.
- Updated the module manifest to use release-hosted install URLs instead of development branch URLs.
- Added Playwright smoke tests covering `Alt+T` tab-return behavior on the current character sheet.
- Added Playwright smoke coverage for `Alt+T` after switching an actor between Tidy 5e and the default D&D 5e sheet.
- Added VS Code debug launch entries for the Playwright smoke tests.
- Refactored the D&D 5e sheet keyboard navigation code by splitting `scripts/sheettabs.js` into smaller modules for state/bootstrap and helper concerns.
- Improved the reliability of the sheet-switching smoke test by targeting the visible sheet controls menu.

### v0.5.0

New features:
- Added keyboard navigation support for the default D&D 5e actor sheets in Foundry v13.
- Added keyboard navigation support for Tidy 5e Sheets in Foundry v13, including the default modern sheet layout.
- Added support for tab-strip navigation with `Tab` / `Shift+Tab` and tab activation with `Enter`.
- Added keyboard entry into active tab content and keyboard cycling through interactive controls inside the active panel.
- Added shortcuts to recover or leave sheet focus: `Alt+T` returns focus to the active sheet tab, while `Escape` and `Ctrl+Shift+Tab` release sheet focus.
- Added spoken screen reader guidance when keyboard focus enters a character sheet.
- Added keyboard activation for common row actions on Tidy 5e inventory and spell rows, including use/roll buttons, item and spell action buttons, and roll configuration dialogs.
- Added keyboard support for Tidy 5e item context menus so menu items can receive focus and be activated without the mouse.
- Added keyboard-first target selection for default D&D 5e attack and consumable flows, including distance-aware target ordering and self-first consumable targeting.
- Added keyboard handling for D&D 5e attack roll, damage roll, and healing roll dialogs with `Normal`-first focus behavior.
- Added hit/miss follow-up dialogs and direct damage/healing application flows that no longer require navigating chat cards.
- Added GM-mediated damage/healing application for player-owned attack flows against unowned enemy tokens.
- Added focus restoration back to the originating inventory/weapon row after attack and consumable flows complete.
- Added automatic screen reader roll-result announcements and an `Alt+R` shortcut to re-read the latest roll result from chat.
- Added `Enter` / `Shift+Enter` canvas token actions so the current keyboard token can open its actor sheet or be targeted without the mouse.
- Added an `Alt+Shift+A` shortcut to open Configure Settings directly to Foundry Navigator and move focus into the first setting control for keyboard-only configuration.
- Added an `Alt+Shift+K` shortcut to open Configure Controls directly and move focus into the keybinding controls for keyboard-only remapping.
- Added an `Alt+C` shortcut to open the current player's character sheet without first finding a token on the canvas.
