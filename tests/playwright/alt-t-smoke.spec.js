const { test, expect } = require("@playwright/test");

const TEST_USER_NAME = "Tester The Brave";
const TEST_ACTOR_NAME = "Tester The Brave";

test.beforeEach(async ({ page }) =>
{
    page.on("console", message =>
    {
        // Keep this simple and visible in the terminal for local smoke-test debugging.
        console.log(`[browser:${message.type()}] ${message.text()}`);
    });

    page.on("pageerror", error =>
    {
        console.log(`[pageerror] ${error?.message ?? error}`);
    });
});

async function waitForGameReady(page)
{
    await page.waitForURL("**/game", { timeout: 15000 });
    await page.waitForFunction(() => Boolean(game.ready), null, { timeout: 15000 });
}

async function joinAsTester(page)
{
    for (let attempt = 0; attempt < 3; attempt++)
    {
        await page.goto("/join");
        if (page.url().includes("/game"))
        {
            await waitForGameReady(page);
            return;
        }

        const joinForm = page.locator("#join-game-form");
        const criticalFailure = page.getByRole("heading", { name: /Critical Failure/i });
        const pageState = await Promise.race([
            joinForm.waitFor({ state: "visible", timeout: 15000 }).then(() => "join"),
            criticalFailure.waitFor({ state: "visible", timeout: 15000 }).then(() => "critical"),
        ]).catch(() => "unknown");

        if (pageState === "critical")
        {
            await page.waitForTimeout(1000);
            continue;
        }

        await expect(joinForm).toBeVisible({ timeout: 15000 });

        const userSelect = joinForm.locator('select[name="userid"]');
        await expect(userSelect).toBeVisible();

        const userId = await userSelect.evaluate((select, { userName, actorName }) =>
        {
            const normalize = value => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
            const normalizedUserName = normalize(userName);
            const normalizedActorName = normalize(actorName);
            const options = Array.from(select.options);
            const option = options.find(candidate => normalize(candidate.textContent) === normalizedUserName)
                ?? options.find(candidate => normalize(candidate.textContent).includes(normalizedUserName))
                ?? options.find(candidate => normalize(candidate.textContent).includes(normalizedActorName));

            return option?.value ?? null;
        }, { userName: TEST_USER_NAME, actorName: TEST_ACTOR_NAME });

        expect(userId).toBeTruthy();
        await userSelect.selectOption(userId);

        const joinButton = joinForm.locator('button[name="join"]');
        await expect(joinButton).toBeVisible();
        await joinButton.click();
        await waitForGameReady(page);
        return;
    }

    throw new Error("Foundry join page did not become available. Is the world active?");
}

async function logUserCharacterDiagnostics(page, actorName = "Tester the Brave")
{
    const diagnostics = await page.evaluate((name) =>
    {
        const user = game.user;
        const assignedCharacter = user?.character ?? null;
        const namedActor = game.actors?.find(candidate => candidate?.type === "character" && candidate?.name === name) ?? null;
        const namedActorOwnership = namedActor && user ? namedActor.testUserPermission(user, "OWNER") : false;

        return {
            userName: user?.name ?? null,
            assignedCharacterName: assignedCharacter?.name ?? null,
            assignedCharacterId: assignedCharacter?.id ?? null,
            namedActorName: namedActor?.name ?? null,
            namedActorId: namedActor?.id ?? null,
            namedActorOwnership
        };
    }, actorName);

    if (!diagnostics.assignedCharacterId || !diagnostics.namedActorOwnership)
    {
        console.log("[playwright] user/actor diagnostics", diagnostics);
    }

    return diagnostics;
}

async function getOwnedCharacterActors(page)
{
    return page.evaluate(() =>
    {
        const user = game.user;
        return (game.actors?.contents ?? [])
            .filter(actor => actor?.type === "character" && user && actor.testUserPermission(user, "OWNER"))
            .map(actor => ({
                id: actor.id,
                name: actor.name,
                uuid: actor.uuid
            }));
    });
}

async function openCharacterSheet(page, actorName = "Tester the Brave")
{
    const actorId = await page.evaluate((name) =>
    {
        const actor = game.user?.character
            ?? game.actors?.find(candidate => candidate?.type === "character" && candidate?.name === name)
            ?? game.actors?.find(candidate => candidate?.type === "character" && candidate?.isOwner);
        if (!actor?.id)
        {
            return null;
        }

        actor.sheet?.render?.(true);
        return actor.id;
    }, actorName);

    expect(actorId).toBeTruthy();

    await page.waitForFunction((name) =>
    {
        const actor = game.user?.character
            ?? game.actors?.find(candidate => candidate?.type === "character" && candidate?.name === name)
            ?? game.actors?.find(candidate => candidate?.type === "character" && candidate?.isOwner);
        return Boolean(game.ready && actor?.sheet?.rendered);
    }, actorName, { timeout: 25000 });

    const sheetSelector = `.application.sheet.actor.character[id$="Actor-${actorId}"]`;
    await page.waitForFunction((selector) =>
    {
        return Array.from(document.querySelectorAll(selector)).some(element => element.offsetParent);
    }, sheetSelector, { timeout: 25000 });

    const sheet = page.locator(sheetSelector).filter({ visible: true }).last();
    await expect(sheet).toBeVisible({ timeout: 25000 });
    await expect(sheet).toHaveClass(/sheet/);
    await expect(sheet).toHaveClass(/actor/);
    await expect(sheet).toHaveClass(/character/);

    return sheet;
}

async function setCharacterSheetClass(page, actorName, sheetClass)
{
    const actorId = await page.evaluate(async ({ name, desiredSheetClass }) =>
    {
        const actor = game.user?.character
            ?? game.actors?.find(candidate => candidate?.type === "character" && candidate?.name === name)
            ?? game.actors?.find(candidate => candidate?.type === "character" && candidate?.isOwner);
        if (!actor?.id) return null;

        await actor.setFlag("core", "sheetClass", desiredSheetClass);
        actor.sheet?.close?.();
        actor.sheet?.render?.(true);
        return actor.id;
    }, { name: actorName, desiredSheetClass: sheetClass });

    expect(actorId).toBeTruthy();
    return openCharacterSheet(page, actorName);
}

async function focusShouldReturnToTab(page, sheet, tabName)
{
    const tab = sheet.getByRole("tab", { name: new RegExp(tabName, "i") });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", /true/i);
    await tab.press("Enter");
    await expect(tab).not.toBeFocused();

    await page.keyboard.press("Alt+T");
    await expect(tab).toBeFocused();
}

async function forceHighRolls(page)
{
    await page.evaluate(() =>
    {
        globalThis.__foundryNavigatorOriginalRandomUniform ??= CONFIG.Dice.randomUniform;
        CONFIG.Dice.randomUniform = () => 0.999999;
    });
}

async function lowerHostileArmorClass(page)
{
    await page.evaluate(async () =>
    {
        const actor = game.user?.character
            ?? game.actors?.find(candidate => candidate?.type === "character" && candidate?.isOwner);
        if (!actor) return;

        await actor.update({
            "system.abilities.str.value": 50,
            "system.attributes.prof": 10
        });

        const firstWeapon = actor.items?.find(item => item?.type === "weapon");
        if (firstWeapon)
        {
            await firstWeapon.update({
                "system.attack.bonus": "20"
            });
        }
    });
}

async function expectFocusInside(page, container)
{
    await expect(container).toBeVisible();
    await page.waitForFunction((element) =>
    {
        if (!(element instanceof HTMLElement)) return false;
        const activeElement = document.activeElement;
        return activeElement instanceof HTMLElement && element.contains(activeElement);
    }, await container.elementHandle(), { timeout: 25000 });
}

async function chooseNormalRoll(page)
{
    const normalButton = page.getByRole("button", { name: /Normal/i }).last();
    await expect(normalButton).toBeVisible({ timeout: 25000 });
    await normalButton.click();
}

test("Alt+T returns focus to the active tab well on the current character sheet", async ({ page }) =>
{
    await joinAsTester(page);
    await logUserCharacterDiagnostics(page, TEST_ACTOR_NAME);
    const sheet = await openCharacterSheet(page, TEST_ACTOR_NAME);

    // These tab labels are shared by the default and modern Tidy 5e sheets.
    await focusShouldReturnToTab(page, sheet, "Inventory");
    await focusShouldReturnToTab(page, sheet, "Features");
});

test("Alt+T still works after changing the actor between Tidy and default sheets", async ({ page }) =>
{
    await joinAsTester(page);

    const tidySheet = await setCharacterSheetClass(
        page,
        TEST_ACTOR_NAME,
        "dnd5e.Tidy5eCharacterSheetQuadrone"
    );
    await focusShouldReturnToTab(page, tidySheet, "Inventory");

    const defaultSheet = await setCharacterSheetClass(
        page,
        TEST_ACTOR_NAME,
        "dnd5e.CharacterActorSheet"
    );
    await focusShouldReturnToTab(page, defaultSheet, "Features");
});

test("combat tunnel keeps focus anchored through targeting and damage flow", async ({ page }) =>
{
    await joinAsTester(page);
    await forceHighRolls(page);
    await lowerHostileArmorClass(page);

    const sheet = await setCharacterSheetClass(
        page,
        TEST_ACTOR_NAME,
        "dnd5e.Tidy5eCharacterSheetQuadrone"
    );

    const inventoryTab = sheet.getByRole("tab", { name: /^Inventory$/i });
    await expect(inventoryTab).toBeVisible();
    await inventoryTab.click();
    await expect(inventoryTab).toHaveAttribute("aria-selected", /true/i);

    const firstVisibleWeaponRow = sheet.locator('[data-tidy-section-key="weapon"] .tidy-table-row-container').filter({ visible: true }).first();
    await expect(firstVisibleWeaponRow).toBeVisible({ timeout: 25000 });

    const firstWeaponUseButton = firstVisibleWeaponRow.locator('.tidy-table-row-use-button');
    await expect(firstWeaponUseButton).toBeVisible({ timeout: 25000 });
    await firstWeaponUseButton.focus();
    await expect(firstWeaponUseButton).toBeFocused();

    await page.keyboard.press("Enter");

    const targetPicker = page.locator(".fn-target-picker").filter({ visible: true }).last();
    await expectFocusInside(page, targetPicker);

    const confirmTargetButton = targetPicker.locator('button[type="submit"], .dialog-buttons button').last();
    await expect(confirmTargetButton).toBeVisible({ timeout: 25000 });
    await confirmTargetButton.click();

    const attackRollDialog = page.locator('[role="dialog"]:visible, dialog:visible').filter({ has: page.getByRole("button", { name: /Normal/i }) }).last();
    await expectFocusInside(page, attackRollDialog);
    await chooseNormalRoll(page);

    let focusReturnedAfterAttack = false;
    try
    {
        await expect(firstWeaponUseButton).toBeFocused({ timeout: 3000 });
        focusReturnedAfterAttack = true;
    }
    catch (error)
    {
        focusReturnedAfterAttack = false;
    }

    if (!focusReturnedAfterAttack)
    {
        const damageButton = page.getByRole("button", { name: /damage/i }).filter({ visible: true }).last();
        await expect(damageButton).toBeVisible({ timeout: 25000 });
        await damageButton.click();

        const damageNormalButton = page.getByRole("button", { name: /Normal/i }).filter({ visible: true }).last();
        await expect(damageNormalButton).toBeVisible({ timeout: 25000 });
        await expect(damageNormalButton).toBeFocused({ timeout: 25000 });
        await damageNormalButton.click();
    }

    await page.waitForFunction(() =>
    {
        const activeElement = document.activeElement;
        return activeElement instanceof HTMLElement
            && activeElement.classList.contains("tidy-table-row-use-button");
    }, null, { timeout: 25000 });
});












