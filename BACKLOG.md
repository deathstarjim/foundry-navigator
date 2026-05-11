# Foundry Navigator - Backlog

Items are grouped by theme. Priorities are relative to Michael's needs as a blind player.
All features should be `scope: 'client'` (per-player opt-in) unless noted.

---

## Grid Coordinate System
*Prerequisite for most canvas announcements - implement first.*

- [ ] **Grid label overlay** - PIXI canvas layer that draws letter (A, B, C...) column headers along the top of the scene and number (1, 2, 3...) row headers down the left side, in world-space so they pan/zoom with the map. Semi-transparent so they do not obscure the map for sighted players. Toggleable per-client.
- [x] **Coordinate helper function** - shared utility `getGridLabel(token)` -> `"C3"` used by all announcement features below.
- [ ] **Persistent HUD readout** - small always-visible HTML overlay in a screen corner showing the controlled token's current grid position and HP (for example `Thorin - C3 - HP 22/30`). Useful for sighted players helping Michael navigate.

---

## Screen Reader Announcements
*Builds on the ARIA live region system already in `screenreader.js`.*

- [x] **Token move** - announce name plus new grid coordinate when any owned token moves (for example "Thorin moves to C3").
- [x] **Token enter/leave scene** - announce when a token is added to or removed from the canvas (for example "Goblin King has entered the scene.").
- [x] **HP / damage changes** - announce damage or healing on owned and optionally targeted tokens (for example "Thorin takes 8 damage. 22 of 30 HP remaining.").
- [x] **Status effects / conditions** - announce when a condition is applied to or removed from an owned token (for example "Prone applied to Thorin." / "Frightened 1 removed.").
- [x] **Dice roll results** - announce the result and total of any roll in chat (for example "Attack roll: 17."). Includes an `Alt+R` fallback to re-read the latest roll result from chat on demand.
- [x] **Combat tunnel step narration** - expand the existing dialog narration so target selection, attack confirmation, damage application, and recovery/focus transitions are consistently announced from start to finish.

---

## Keyboard and No-Mouse Navigation
*Reducing the need for click-and-drag is the highest-value area for Michael.*

- [x] **"Where am I" hotkey** - configurable keybind (default: `W`) that re-reads the controlled token's position, HP, and any active conditions via the assertive live region. Works on demand without any interaction.
- [x] **Initial token selection / open sheet flow** - provide a keyboard-first way on initial world load to find owned tokens, select or control one, and open its character sheet without needing a mouse or pre-existing canvas focus.
- [ ] **Tab through nearby tokens** - `Tab` / `Shift+Tab` cycles through tokens on the canvas; `Enter` selects or controls, `Shift+Enter` targets. Still useful outside sheet-driven combat flows for scene exploration, selecting allies, and interacting with placed tokens.
- [ ] **Nearby token scan** - keybind announces tokens within a configurable radius of the controlled token, including distance, grid coordinate, and disposition filter (friendly, neutral, secret, hostile, or all). Useful for situational awareness even when combat targeting is handled from the sheet.
- [ ] **Arrow key token movement** - move a controlled token one grid square at a time using arrow keys. Foundry has partial support; ensure it works and triggers our announcements.
- [ ] **Keyboard ruler / distance check** - announce walking distance from the controlled token to the currently focused token (for example "Goblin Scout is 15 feet away, at B5.").

---

## Audio Cues
*Supplementary to the screen reader for faster spatial feedback.*

- [ ] **Positional move sound** - short tick or click when your token moves, distinct from other tokens.
- [ ] **Damage taken sound** - brief sound cue when HP drops.
- [ ] **Turn start chime** - distinctive sound when it becomes the player's turn, separate from or in addition to the combat announcement.

---

## UI / Sheet Improvements

- [ ] **Actor sheet keyboard navigation audit** - verify all interactive elements on supported D&D 5e character sheets are reachable and operable by keyboard alone, including tab order and `Enter` / `Space` activation.
- [ ] **Character sheet edit-mode access** - provide a keyboard-friendly way to enter and exit actor-sheet edit mode on default and Tidy 5e sheets so players can level up or change sheet data without hunting for the wrench icon.
- [ ] **5e level-up workflow** - make the D&D 5e leveling process keyboard-friendly end to end: enter sheet edit mode, reach the Character or Details tab, activate `Level Up`, and complete the level-up dialogs without requiring the mouse.
- [ ] **Spell/action quick-cast hotkey** - numbered hotkeys (`1`-`9`) to trigger frequently used actions from the hotbar without opening the character sheet.
- [ ] **Compendium browser keyboard navigation** - verify `Tab`, arrow keys, and `Enter` work correctly in D&D 5e compendium browsers.
- [ ] **Tooltip / description readout** - pressing a key while focused on an item, spell, or feat reads the full description text via the polite live region.
- [x] **Tidy 5e combined Sheet tab support** - extend the keyboard and combat-tunnel targeting flow so Tidy 5e's merged `Sheet` tab works the same as the dedicated `Inventory` and `Spellbook` tabs, including item-image activation, row targeting, and combat prompts.
- [ ] **Generic item-row activation adapters** - continue the row-centric refactor so non-5e and future sheet implementations can register row and primary-action hints without depending on tab-specific DOM assumptions.

---

## Infrastructure / Quality of Life

- [ ] **System-agnostic HP hook** - the HP announcement currently needs system-specific attribute paths. Investigate a generic approach that works across additional systems if support expands beyond D&D 5e.
- [ ] **Setting profile / preset** - a single "Enable all screen reader features" toggle that turns on all announcement settings at once, for easier onboarding.
- [x] **Settings shortcut** - dedicated hotkey opens Configure Settings to the Foundry Navigator module and moves focus into the first setting control so settings can be changed without hunting through the full settings UI.
- [ ] **Sidebar pin / default-open option** - add a client setting to keep the right sidebar expanded by default, with a pin-style option so it stays open until the player explicitly closes it.
- [ ] **Keyboard shortcut reference sheet** - in-game pop-up (hotkey: `?` or `F1`) listing all keybindings added by this module.
