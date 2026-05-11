import { buildSheetAdapters } from "./sheettabs/adapters.js";
import { registerSheetTabBootstrap } from "./sheettabs/bootstrap.js";
import { getInventoryControlLabel } from "./sheettabs/inventory-helpers.js";
import { createCombatActivationHandlers } from "./sheettabs/combat-activation.js";
import {
    getInventoryActionContext,
    isInventoryKeyboardActionTarget,
    resolveInventoryActivationTarget,
} from "./sheettabs/inventory-activation.js";
import {
    focusActivationResult,
    getApplicationIdentity,
    getVisibleApplicationElements,
} from "./sheettabs/interaction-helpers.js";
import {
    focusFirstVisibleMenuTargetWithRetry,
    getCurrentPanelKeyboardTarget,
    getFocusableElementsInPanel,
    getFocusableLikeElements,
    getInventoryRowElement,
    getInventoryRowName,
    getPanelKeyboardTargets,
    getPreferredPanelEntryTarget,
    getVisibleMenuContainer,
    getVisibleMenuTargets,
    isExcludedPanelElement,
    isLikelyInventoryMenuTrigger,
    isOpenInventoryMenuTrigger,
    isTextEntryElement,
} from "./sheettabs/panel-navigation.js";
import {
    findTabPanel,
    getActiveTabControl,
    getFocusedSheetPanel,
    getInitialSheetFocusTarget,
    getPanelTabId,
    getRootActiveTabId,
    getSheetFocusContainer,
    getSiblingTabControls,
    getTabControlById,
    getTabControlFromTarget,
    getTabControls,
    getTabId,
    getTabLabel,
    isFocusableElement,
    isRenderedElement,
    resolveSheetTabReturnControl,
} from "./sheettabs/tab-helpers.js";
import {
    FN_MODULE_SOCKET,
    FN_SHEET_HINTS_ANNOUNCED,
    FN_SHEET_TABS_STATE,
    FN_SOCKET_ACTIONS,
    FN_SOCKET_REQUESTS,
    debugSheetTabs,
    getActiveActorSheetState as getStoredActiveActorSheetState,
    getElementDebugSummary,
    registerSheetTabDebugHelpers as registerStoredSheetTabDebugHelpers,
    releaseSheetKeyboardCapture as releaseStoredSheetKeyboardCapture,
    setActiveActorSheet as setStoredActiveActorSheet,
} from "./sheettabs/state.js";

const FN_SHEET_TABS_BUILD = "image-entry-2026-05-01";
debugSheetTabs("sheettabs module loaded", { build: FN_SHEET_TABS_BUILD });

let FN_LAST_POINTER_DOWN_TIME = 0;
let FN_LAST_POINTER_DOWN_TARGET = null;
let FN_LAST_KEYBOARD_ACTIVATION_TIME = 0;
let FN_LAST_KEYBOARD_ACTIVATION_TARGET = null;
let FN_ITEM_USE_INTERCEPT_REGISTERED = false;
let FN_ITEM_USE_INTERCEPT_BYPASS = false;

function getNavigatorSheetRoot(html)
{
    return html instanceof HTMLElement ? html : html?.[0] instanceof HTMLElement ? html[0] : null;
}

function getApplicationElement(app, html)
{
    const appElement = getNavigatorSheetRoot(app?.element);
    if (appElement) return appElement;
    return getNavigatorSheetRoot(html);
}

function getPrimaryActiveGM()
{
    const activeGMs = game.users?.filter((user) => user.active && user.isGM) ?? [];
    if (!activeGMs.length) return null;
    return activeGMs.sort((left, right) => left.id.localeCompare(right.id))[0] ?? null;
}

function getTargetTokenUuid(targetToken)
{
    return targetToken?.document?.uuid ?? targetToken?.uuid ?? null;
}

function canCurrentUserApplyToTarget(targetToken)
{
    const tokenDocument = targetToken?.document ?? targetToken ?? null;
    if (tokenDocument?.isOwner) return true;
    const actor = targetToken?.actor ?? tokenDocument?.actor ?? null;
    return !!actor?.isOwner;
}

async function applyRollResultToTarget(targetToken, appliedAmount, options = {})
{
    if (typeof targetToken?.applyDamage === "function")
    {
        await targetToken.applyDamage(appliedAmount, options);
        return "token";
    }

    if (typeof targetToken?.object?.applyDamage === "function")
    {
        await targetToken.object.applyDamage(appliedAmount, options);
        return "token-object";
    }

    if (typeof targetToken?.actor?.applyDamage === "function")
    {
        await targetToken.actor.applyDamage(appliedAmount, options);
        return "actor";
    }

    throw new Error("Target does not support applyDamage.");
}

function emitModuleSocket(payload)
{
    game.socket?.emit(FN_MODULE_SOCKET, payload);
}

function requestGMApplyRollResult({
    targetToken,
    appliedAmount,
    originatingMessage,
    itemName,
    targetName,
    rollType,
    isHealingRoll,
    damageTotal,
})
{
    const activeGM = getPrimaryActiveGM();
    if (!activeGM)
    {
        return Promise.reject(new Error("No active GM is available to apply the roll result."));
    }

    const requestId = foundry.utils.randomID();
    const targetTokenUuid = getTargetTokenUuid(targetToken);
    if (!targetTokenUuid)
    {
        return Promise.reject(new Error("Target token UUID is unavailable."));
    }

    return new Promise((resolve, reject) =>
    {
        const timeoutId = window.setTimeout(() =>
        {
            FN_SOCKET_REQUESTS.delete(requestId);
            reject(new Error("Timed out waiting for GM roll application."));
        }, 10000);

        FN_SOCKET_REQUESTS.set(requestId, {
            resolve,
            reject,
            timeoutId,
        });

        debugSheetTabs("requested GM roll application", {
            requestId,
            targetTokenUuid,
            itemName,
            targetName,
            appliedAmount,
            gmId: activeGM.id,
        });

        emitModuleSocket({
            type: FN_SOCKET_ACTIONS.APPLY_ROLL_RESULT,
            requestId,
            requesterId: game.user.id,
            gmId: activeGM.id,
            targetTokenUuid,
            appliedAmount,
            originatingMessageId: originatingMessage?.id ?? null,
            itemName,
            targetName,
            rollType,
            isHealingRoll,
            damageTotal,
        });
    });
}

async function handleGMApplyRollResultRequest(payload)
{
    debugSheetTabs("received GM roll application request", {
        requestId: payload?.requestId,
        requesterId: payload?.requesterId,
        gmId: payload?.gmId,
        currentUserId: game.user?.id,
        isGM: game.user?.isGM,
        targetTokenUuid: payload?.targetTokenUuid,
        itemName: payload?.itemName,
        targetName: payload?.targetName,
    });

    if (!game.user?.isGM) return;
    if (payload?.gmId && payload.gmId !== game.user.id) return;

    const targetReference = fromUuidSync(payload.targetTokenUuid);
    const originatingMessage = payload.originatingMessageId ? game.messages?.get(payload.originatingMessageId) ?? null : null;

    try
    {
        const applyPath = await applyRollResultToTarget(targetReference, payload.appliedAmount, {
            isDelta: true,
            originatingMessage,
        });

        debugSheetTabs("GM applied roll result for player request", {
            requestId: payload.requestId,
            itemName: payload.itemName,
            targetName: payload.targetName,
            applyPath,
        });

        emitModuleSocket({
            type: FN_SOCKET_ACTIONS.APPLY_ROLL_RESULT_RESPONSE,
            requestId: payload.requestId,
            requesterId: payload.requesterId,
            ok: true,
            itemName: payload.itemName,
            targetName: payload.targetName,
            applyPath,
        });
    }
    catch (error)
    {
        emitModuleSocket({
            type: FN_SOCKET_ACTIONS.APPLY_ROLL_RESULT_RESPONSE,
            requestId: payload.requestId,
            requesterId: payload.requesterId,
            ok: false,
            itemName: payload.itemName,
            targetName: payload.targetName,
            error: error?.message ?? String(error),
        });
    }
}

function handleApplyRollResultResponse(payload)
{
    if (payload?.requesterId !== game.user.id) return;

    const pending = FN_SOCKET_REQUESTS.get(payload.requestId);
    if (!pending) return;

    window.clearTimeout(pending.timeoutId);
    FN_SOCKET_REQUESTS.delete(payload.requestId);

    debugSheetTabs("received GM roll application response", {
        requestId: payload.requestId,
        ok: payload.ok,
        itemName: payload.itemName,
        targetName: payload.targetName,
        applyPath: payload.applyPath,
        error: payload.error,
    });

    if (payload.ok) pending.resolve(payload);
    else pending.reject(new Error(payload.error ?? "GM roll application failed."));
}

function handleModuleSocketMessage(payload)
{
    debugSheetTabs("received module socket message", {
        type: payload?.type,
        requestId: payload?.requestId,
        requesterId: payload?.requesterId,
        gmId: payload?.gmId,
        currentUserId: game.user?.id,
        isGM: game.user?.isGM,
    });

    if (!payload?.type) return;

    if (payload.type === FN_SOCKET_ACTIONS.APPLY_ROLL_RESULT)
    {
        void handleGMApplyRollResultRequest(payload);
        return;
    }

    if (payload.type === FN_SOCKET_ACTIONS.APPLY_ROLL_RESULT_RESPONSE)
    {
        handleApplyRollResultResponse(payload);
    }
}

const FN_SHEET_ADAPTERS = buildSheetAdapters();

function getSheetAdapter(app, root)
{
    return FN_SHEET_ADAPTERS.find(adapter => adapter.matches(app, root)) ?? {
        id: "generic-actor-sheet",
        contentRootSelectors: [],
        entrySelectors: [],
        panelTargetSelectors: [],
    };
}

function announceSheetTabsHint(app)
{
    const appId = app?.id;
    if (!appId) return;
    if (FN_SHEET_HINTS_ANNOUNCED.has(appId)) return;

    const polite = globalThis.FoundryNavigatorAnnounce?.polite;
    if (typeof polite !== "function") return;

    FN_SHEET_HINTS_ANNOUNCED.add(appId);
    polite("Character sheet tabs. Tab moves between tabs. Press Enter to open a tab. Alt T returns to tabs. Escape leaves the sheet.");

    debugSheetTabs("announced sheet tabs hint", {
        appId,
        title: app?.title,
    });
}

function resolveSheetTabReturnTarget(app, root, shiftKey = false, activeElement = document.activeElement)
{
    if (!(root instanceof HTMLElement)) return null;

    const adapter = getSheetAdapter(app, root);
    const rootClassTabId = adapter.preferRootClassTabIdForHotkey ? getRootActiveTabId(root) : "";
    const focusedPanel = getFocusedSheetPanel(root, activeElement);
    const focusedPanelTabId = getPanelTabId(focusedPanel);
    const activeTab = resolveSheetTabReturnControl(root, adapter, shiftKey, {
        rootClassTabId,
        focusedPanelTabId,
    });

    return {
        adapter,
        rootClassTabId,
        focusedPanelTabId,
        activeTab,
    };
}

function focusSheetTabReturnTarget(app, root, shiftKey = false, activeElement = document.activeElement)
{
    if (!app || !(root instanceof HTMLElement)) return false;

    const {
        adapter,
        rootClassTabId,
        focusedPanelTabId,
        activeTab,
    } = resolveSheetTabReturnTarget(app, root, shiftKey, activeElement);

    if (!(activeTab instanceof HTMLElement)) return false;

    setActiveActorSheet(app, root);
    activeTab.focus({ preventScroll: false });
    announceSheetTabsHint(app);

    debugSheetTabs("sheet tabs hotkey restored focus to active tab", {
        appId: app?.id,
        adapter: adapter.id,
        shiftKey,
        rootClassTabId,
        focusedPanelTabId,
        tabId: getTabId(activeTab),
        tabClasses: activeTab?.className,
    });
    return true;
}

function focusActiveActorSheetTabFromHotkey(shiftKey = false)
{
    const { app, root } = getActiveActorSheetState();
    if (!app || !root) return false;
    return focusSheetTabReturnTarget(app, root, shiftKey, document.activeElement);
}

function isActorSheetApplication(app, root)
{
    const result = app?.document?.documentName === "Actor"
        || root?.matches?.(".actor")
        || root?.querySelector?.(".actor-tabs, nav.tabs[data-group]");

    debugSheetTabs("isActorSheetApplication evaluated", {
        result,
        appId: app?.id,
        constructorName: app?.constructor?.name,
        documentName: app?.document?.documentName,
        actorDocumentName: app?.actor?.documentName,
        rootTag: root?.tagName,
        rootClasses: root?.className,
    });

    return result;
}

function debugSheetMarkup(root, app, requestedTabId = null)
{
    if (!(root instanceof HTMLElement)) return;

    const activeTab = getActiveTabControl(root);
    const activePanel = activeTab ? findTabPanel(root, activeTab) : null;
    const requestedPanel = requestedTabId
        ? root.querySelector(`.tab[data-tab="${CSS.escape(requestedTabId)}"]`)
        : null;
    const detailsPanel = root.querySelector('[data-tab="details"]');
    const targetPanel = requestedPanel ?? activePanel ?? detailsPanel;
    if (!(targetPanel instanceof HTMLElement)) return;

    const adapter = getSheetAdapter(app, root);
    const panelTargets = getPanelKeyboardTargets(targetPanel, adapter).map(getElementDebugSummary);
    const normalizedMarkup = targetPanel.outerHTML?.replace(/\s+/g, " ");

    debugSheetTabs("sheet markup snapshot", {
        appId: app?.id,
        adapter: adapter.id,
        requestedTabId,
        activeTabId: getTabId(activeTab),
        activeTab: getElementDebugSummary(activeTab),
        panel: getElementDebugSummary(targetPanel),
        panelTargetCount: panelTargets.length,
        panelTargets: panelTargets.slice(0, 24),
        markupLength: normalizedMarkup?.length ?? 0,
    });

    console.log("[Foundry Navigator] sheet markup html");
    console.log(normalizedMarkup);

    return {
        appId: app?.id,
        adapter: adapter.id,
        requestedTabId,
        activeTabId: getTabId(activeTab),
        panelTargetCount: panelTargets.length,
        panelTargets,
        markup: normalizedMarkup,
    };
}

const {
    activateInventoryControl,
    openAttackResultDialog,
    restoreLastAttackControlFocus,
} = createCombatActivationHandlers({
    debug: debugSheetTabs,
    focusActivationResult,
    getApplicationElement,
    getTargetArmorClass,
    isRenderedElement,
    setActiveActorSheet,
});

function getPanelEntryTarget(panel)
{
    const sheetRoot = panel.closest(".window-app, .application, .actor");
    const adapter = getSheetAdapter(FN_SHEET_TABS_STATE.activeApp, sheetRoot);
    const focusables = getFocusableElementsInPanel(panel, adapter);
    if (focusables.length) return { target: focusables[0], usedFallback: false, source: "native-focusable" };

    const preferred = getPreferredPanelEntryTarget(panel, adapter);
    if (preferred) return preferred;

    const focusableLike = getFocusableLikeElements(panel).filter(element =>
        element !== panel && !isExcludedPanelElement(element, adapter)
    );
    const firstCandidate = focusableLike.find(element => !element.matches("[tabindex='-1'], [disabled], [inert]"));
    if (firstCandidate)
    {
        if (!firstCandidate.hasAttribute("tabindex")) firstCandidate.tabIndex = 0;
        return { target: firstCandidate, usedFallback: false, source: "promoted-focusable" };
    }

    return { target: panel, usedFallback: true, source: "panel" };
}

function getTargetArmorClass(token)
{
    return Number(token?.actor?.system?.attributes?.ac?.value ?? token?.actor?.system?.attributes?.ac?.flat ?? NaN);
}

function getRollTotalValue(roll)
{
    if (!roll) return NaN;

    const directTotal = Number(roll.total);
    if (Number.isFinite(directTotal)) return directTotal;

    const resultTotal = Number(roll.result?.total);
    if (Number.isFinite(resultTotal)) return resultTotal;

    const termsTotal = Number(roll._total);
    if (Number.isFinite(termsTotal)) return termsTotal;

    return NaN;
}

function handleInventoryKeyboardActivation(event, app, root, source = "direct")
{
    if (event.ctrlKey || event.altKey || event.metaKey) return false;
    if (event.key !== "Enter" && event.key !== " ") return false;

    const eventTarget = event.target instanceof HTMLElement
        ? event.target
        : event.composedPath?.().find(target => target instanceof HTMLElement) ?? null;
    const currentTarget = event.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : null;
    const target = currentTarget
        && currentTarget !== root
        && isInventoryKeyboardActionTarget(currentTarget)
            ? currentTarget
            : eventTarget;
    if (!(target instanceof HTMLElement)) return false;
    if (!(root instanceof HTMLElement) || !root.contains(target)) return false;
    if (!isInventoryKeyboardActionTarget(target)) return false;

    const {
        resolvedTarget = target,
        activationTarget = target,
    } = resolveInventoryActivationTarget(target);

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    FN_LAST_KEYBOARD_ACTIVATION_TIME = Date.now();
    FN_LAST_KEYBOARD_ACTIVATION_TARGET = activationTarget;
    void activateInventoryControl(activationTarget, app, event);

    if (isLikelyInventoryMenuTrigger(resolvedTarget))
    {
        requestAnimationFrame(() => focusFirstVisibleMenuTargetWithRetry(root, resolvedTarget));
    }

    debugSheetTabs(`${source} inventory keyboard action activated`, {
        appId: app?.id,
        itemName: getInventoryRowName(getInventoryRowElement(target)),
        targetTag: target.tagName,
        targetClasses: target.className,
        resolvedTargetTag: resolvedTarget?.tagName,
        resolvedTargetClasses: resolvedTarget?.className,
        activationTargetTag: activationTarget?.tagName,
        activationTargetClasses: activationTarget?.className,
        key: event.key,
    });
    return true;
}

function handleAssistiveInventoryClick(event, app, root, source = "assistive")
{
    if (event.defaultPrevented) return false;

    const target = event.target instanceof HTMLElement
        ? event.target
        : event.composedPath?.().find(candidate => candidate instanceof HTMLElement) ?? null;
    if (!(target instanceof HTMLElement)) return false;
    if (!(root instanceof HTMLElement) || !root.contains(target)) return false;
    if (!isInventoryKeyboardActionTarget(target)) return false;

    const sincePointerDown = Date.now() - FN_LAST_POINTER_DOWN_TIME;
    if (sincePointerDown >= 0 && sincePointerDown < 750) return false;

    const {
        resolvedTarget = target,
        activationTarget = target,
    } = resolveInventoryActivationTarget(target);

    if (isLikelyInventoryMenuTrigger(resolvedTarget)) return false;

    const sinceKeyboardActivation = Date.now() - FN_LAST_KEYBOARD_ACTIVATION_TIME;
    if (
        sinceKeyboardActivation >= 0
        && sinceKeyboardActivation < 750
        && (
            FN_LAST_KEYBOARD_ACTIVATION_TARGET === activationTarget
            || FN_LAST_KEYBOARD_ACTIVATION_TARGET?.contains?.(activationTarget)
            || activationTarget?.contains?.(FN_LAST_KEYBOARD_ACTIVATION_TARGET)
        )
    )
    {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        return true;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    void activateInventoryControl(activationTarget, app, event);

    debugSheetTabs(`${source} inventory assistive click activated`, {
        appId: app?.id,
        itemName: getInventoryRowName(getInventoryRowElement(target)),
        targetTag: target.tagName,
        targetClasses: target.className,
        resolvedTargetTag: resolvedTarget?.tagName,
        resolvedTargetClasses: resolvedTarget?.className,
        activationTargetTag: activationTarget?.tagName,
        activationTargetClasses: activationTarget?.className,
        eventDetail: event.detail,
        isTrusted: event.isTrusted,
    });
    return true;
}

function itemDocumentsMatch(left, right)
{
    if (!left || !right) return false;
    if (left === right) return true;
    if (left.uuid && right.uuid && left.uuid === right.uuid) return true;
    return !!(left.id && right.id && left.id === right.id && left.actor?.id === right.actor?.id);
}

function getFocusedItemUseInterceptContext(item, { debugSkips = false } = {})
{
    const { app, root } = getActiveActorSheetState();
    if (!(app && root instanceof HTMLElement))
    {
        if (debugSkips) debugSheetTabs("focused item use intercept skipped: no active sheet", {
            itemName: item?.name,
            appId: app?.id,
            hasRoot: root instanceof HTMLElement,
        });
        return null;
    }

    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement) || !root.contains(activeElement))
    {
        if (debugSkips) debugSheetTabs("focused item use intercept skipped: focus outside sheet", {
            itemName: item?.name,
            activeTag: activeElement instanceof HTMLElement ? activeElement.tagName : undefined,
            activeClasses: activeElement instanceof HTMLElement ? activeElement.className : undefined,
        });
        return null;
    }
    if (!isInventoryKeyboardActionTarget(activeElement))
    {
        if (debugSkips) debugSheetTabs("focused item use intercept skipped: focus is not inventory action", {
            itemName: item?.name,
            activeTag: activeElement.tagName,
            activeClasses: activeElement.className,
            activeRole: activeElement.getAttribute("role"),
            activeDataAction: activeElement.dataset?.action,
        });
        return null;
    }

    const context = getInventoryActionContext(activeElement, app);
    if (!context?.attackActivity?.rollAttack)
    {
        if (debugSkips) debugSheetTabs("focused item use intercept skipped: no attack activity", {
            itemName: item?.name,
            focusedItemName: context?.itemDocument?.name,
            resolvedItemId: context?.itemDocument?.id,
            resolvedItemUuid: context?.itemDocument?.uuid,
            activityType: context?.attackActivity?.type,
            hasRollAttack: !!context?.attackActivity?.rollAttack,
        });
        return null;
    }
    if (!itemDocumentsMatch(context.itemDocument, item))
    {
        if (debugSkips) debugSheetTabs("focused item use intercept skipped: item mismatch", {
            itemName: item?.name,
            itemId: item?.id,
            itemUuid: item?.uuid,
            focusedItemName: context?.itemDocument?.name,
            focusedItemId: context?.itemDocument?.id,
            focusedItemUuid: context?.itemDocument?.uuid,
        });
        return null;
    }

    const activationTarget = context.activationTarget instanceof HTMLElement
        ? context.activationTarget
        : activeElement;

    return { app, root, activeElement, activationTarget, context };
}

async function interceptFocusedItemUse(item, args)
{
    if (FN_ITEM_USE_INTERCEPT_BYPASS) return false;

    const interceptContext = getFocusedItemUseInterceptContext(item, { debugSkips: true });
    if (!interceptContext) return false;

    debugSheetTabs("intercepted focused item use for combat tunnel", {
        appId: interceptContext.app?.id,
        itemName: item?.name,
        focusedTag: interceptContext.activeElement.tagName,
        focusedClasses: interceptContext.activeElement.className,
        activationTag: interceptContext.activationTarget.tagName,
        activationClasses: interceptContext.activationTarget.className,
    });

    FN_ITEM_USE_INTERCEPT_BYPASS = true;
    try
    {
        const event = args.find(arg => arg instanceof Event)
            ?? args.find(arg => arg?.event instanceof Event)?.event
            ?? null;
        await activateInventoryControl(interceptContext.activationTarget, interceptContext.app, event);
    }
    finally
    {
        FN_ITEM_USE_INTERCEPT_BYPASS = false;
    }

    return true;
}

function registerFocusedItemUseIntercept()
{
    if (FN_ITEM_USE_INTERCEPT_REGISTERED) return;

    const itemClass = CONFIG?.Item?.documentClass;
    const originalUse = itemClass?.prototype?.use;
    if (typeof originalUse !== "function")
    {
        debugSheetTabs("focused item use intercept skipped: Item.use unavailable");
        return;
    }

    if (globalThis.libWrapper?.register)
    {
        globalThis.libWrapper.register(
            "foundry-navigator",
            "CONFIG.Item.documentClass.prototype.use",
            async function foundryNavigatorFocusedItemUseWrapper(wrapped, ...args)
            {
                if (await interceptFocusedItemUse(this, args)) return null;
                return wrapped(...args);
            },
            "MIXED"
        );
    }
    else
    {
        itemClass.prototype.use = async function foundryNavigatorFocusedItemUseWrapper(...args)
        {
            if (await interceptFocusedItemUse(this, args)) return null;
            return originalUse.apply(this, args);
        };
    }

    FN_ITEM_USE_INTERCEPT_REGISTERED = true;
    debugSheetTabs("registered focused item use intercept", {
        viaLibWrapper: !!globalThis.libWrapper?.register,
    });
}

function applyInventoryKeyboardSupport(root, app = FN_SHEET_TABS_STATE.activeApp)
{
    for (const header of root.querySelectorAll(".items-header, .items-header .item-name, .items-header .item-header"))
    {
        if (!(header instanceof HTMLElement)) continue;
        if (header.getAttribute("tabindex") === "0") header.removeAttribute("tabindex");
    }

    for (const image of root.querySelectorAll(".tidy-table-row-use-button .item-image"))
    {
        if (!(image instanceof HTMLElement)) continue;
        if (image.getAttribute("tabindex") === "0") image.removeAttribute("tabindex");
    }

    const controls = root.querySelectorAll(
        ".item-name, .item-action, .activity-name, .rollable, .tidy-table-row-use-button, .item-toggle, .command.decrementer, .command.incrementer, .tidy-table-button, .button.button-icon-only, .quantity-tracker-input, [data-activity-id]"
    );

    for (const control of controls)
    {
        if (!(control instanceof HTMLElement)) continue;
        if (control.closest(".items-header")) continue;
        if (control.dataset.fnInventoryKeyboardBound !== "true")
        {
            control.addEventListener("keydown", event =>
            {
                handleInventoryKeyboardActivation(event, app, root, "direct");
            }, true);
            control.dataset.fnInventoryKeyboardBound = "true";
        }

        const label = getInventoryControlLabel(control);
        if (label && !control.getAttribute("aria-label")) control.setAttribute("aria-label", label);
        if (control.matches(".tidy-table-row-use-button") && !control.getAttribute("role"))
        {
            control.setAttribute("role", "button");
        }

        if (
            (control.matches(".item-name, .item-action, .activity-name, .tidy-table-row-use-button, .item-toggle, .command.decrementer, .command.incrementer, .tidy-table-button, .button.button-icon-only, [data-activity-id]")
                || control.matches(".rollable")
                || isLikelyInventoryMenuTrigger(control))
            && !control.hasAttribute("tabindex")
            && !control.matches("button, input, select, textarea, a[href]")
        )
        {
            control.tabIndex = 0;
        }
    }
}

function isKeyboardActivatableElement(element)
{
    if (!(element instanceof HTMLElement)) return false;
    if (element.hidden) return false;
    if (element.closest("[hidden], [inert], .hidden")) return false;
    if (isTextEntryElement(element)) return false;

    return element.matches(
        "button, [role='button'], [role='menuitem'], a[data-action], .button, .dialog-button, .form-footer button, .form-footer a, .roll-action, .context-item"
    );
}

function setActiveActorSheet(app, root)
{
    return setStoredActiveActorSheet(app, root);
}

function releaseSheetKeyboardCapture(root, reason)
{
    return releaseStoredSheetKeyboardCapture(root, reason);
}

function getActiveActorSheetState()
{
    return getStoredActiveActorSheetState({
        getApplicationElement,
        isActorSheetApplication,
    });
}

registerStoredSheetTabDebugHelpers({
    debugSheetMarkup,
    getApplicationElement,
    isActorSheetApplication,
});

document.addEventListener("pointerdown", event =>
{
    FN_LAST_POINTER_DOWN_TIME = Date.now();
    FN_LAST_POINTER_DOWN_TARGET = event.target instanceof HTMLElement
        ? event.target
        : event.composedPath?.().find(candidate => candidate instanceof HTMLElement) ?? null;
}, true);

document.addEventListener("click", event =>
{
    const { app, root } = getActiveActorSheetState();
    if (app && root instanceof HTMLElement)
    {
        handleAssistiveInventoryClick(event, app, root, "document");
    }
}, true);

function syncTabKeyboardSupport(root, app)
{
    const tabLists = root.querySelectorAll("nav.tabs[data-group], [role='tablist']");
    let foundTabs = false;
    const appId = app?.id ?? root.dataset.appid ?? root.id ?? "sheet";
    const adapter = getSheetAdapter(app, root);

    const focusContainer = getSheetFocusContainer(root);
    if (!focusContainer.hasAttribute("tabindex")) focusContainer.tabIndex = -1;

    for (const tabList of tabLists)
    {
        const controls = getTabControls(tabList).filter(control => getTabId(control));
        if (!controls.length) continue;
        foundTabs = true;

        debugSheetTabs("syncTabKeyboardSupport found tab list", {
            appId,
            adapter: adapter.id,
            controlCount: controls.length,
            tabListClasses: tabList.className,
            tabIds: controls.map(control => getTabId(control)),
        });

        if (!tabList.hasAttribute("role")) tabList.setAttribute("role", "tablist");

        for (const control of controls)
        {
            const tabId = getTabId(control);
            const label = getTabLabel(control);
            const panel = findTabPanel(root, control);
            const isActive = control.classList.contains("active") || control.getAttribute("aria-selected") === "true";
            const controlId = control.id || `fn-tab-${appId}-${tabId}`;

            control.id = controlId;
            control.setAttribute("role", "tab");
            control.setAttribute("tabindex", "0");
            control.setAttribute("aria-selected", isActive ? "true" : "false");
            if (label) control.setAttribute("aria-label", label);

            if (!panel) continue;

            const panelId = panel.id || `fn-panel-${appId}-${tabId}`;
            panel.id = panelId;
            panel.setAttribute("role", "tabpanel");
            panel.setAttribute("aria-labelledby", controlId);
            panel.setAttribute("tabindex", "-1");
            control.setAttribute("aria-controls", panelId);
        }
    }

    debugSheetTabs("syncTabKeyboardSupport completed", {
        appId,
        adapter: adapter.id,
        foundTabs,
        tabListCount: tabLists.length,
    });

    return foundTabs;
}

function focusActivePanel(root, control)
{
    const panel = findTabPanel(root, control);
    if (!panel) return;
    const adapter = getSheetAdapter(FN_SHEET_TABS_STATE.activeApp, root);

    requestAnimationFrame(() =>
    {
        requestAnimationFrame(() =>
        {
            const activePanel = findTabPanel(root, control) ?? panel;
            const entry = activePanel ? getPanelEntryTarget(activePanel) : { target: panel, usedFallback: true, source: "panel" };
            entry.target?.focus({ preventScroll: false });

            debugSheetTabs("focusActivePanel resolved target", {
                tabId: getTabId(control),
                adapter: adapter.id,
                panelId: activePanel?.id,
                focusedTag: entry.target?.tagName,
                focusedClasses: entry.target?.className,
                usedPanelFallback: entry.usedFallback,
                source: entry.source,
            });
        });
    });
}

function activateTabFromKeyboard(root, control, app)
{
    const isAlreadyActive = control.classList.contains("active");

    debugSheetTabs("activateTabFromKeyboard", {
        appId: app?.id,
        tabId: getTabId(control),
        label: getTabLabel(control),
        isAlreadyActive,
        ariaSelected: control.getAttribute("aria-selected"),
        controlClasses: control.className,
    });

    control.click();
    syncTabKeyboardSupport(root, app);
    focusActivePanel(root, control);
    requestAnimationFrame(() => debugSheetMarkup(root, app));
}

function attachSheetTabHandlers(root, app)
{
    if (root.dataset.fnSheetTabsBound === "true") return;
    root.dataset.fnSheetTabsBound = "true";

    const activateSheet = () => setActiveActorSheet(app, root);
    root.addEventListener("pointerdown", activateSheet, true);
    root.addEventListener("focusin", activateSheet);
    applyInventoryKeyboardSupport(root, app);

    root.addEventListener("keydown", event =>
    {
        const control = getTabControlFromTarget(event.target);
        const activeTab = getActiveTabControl(root);
        const activeElement = document.activeElement;
        const adapter = getSheetAdapter(app, root);

        if (adapter.localTabReturnHotkey && event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "t")
        {
            event.preventDefault();
            event.stopPropagation();
            focusSheetTabReturnTarget(app, root, false, event.target);
            return;
        }

        if (event.ctrlKey && event.key === "Tab")
        {
            event.preventDefault();
            event.stopPropagation();

            if (event.shiftKey)
            {
                releaseSheetKeyboardCapture(root, "ctrl+shift+tab");
                return;
            }

            if (activeTab)
            {
                activeTab.focus({ preventScroll: false });
                debugSheetTabs("Ctrl+Tab returned focus to active tab", {
                    appId: app?.id,
                    activeTabId: getTabId(activeTab),
                    activeElementTag: activeElement?.tagName,
                    activeElementClasses: activeElement?.className,
                });
            }
            return;
        }

        if (event.key === "Escape" && root.contains(activeElement))
        {
            event.preventDefault();
            event.stopPropagation();
            releaseSheetKeyboardCapture(root, "escape");
            return;
        }

        if (!control || !root.contains(control)) return;

        debugSheetTabs("sheet keydown", {
            appId: app?.id,
            key: event.key,
            code: event.code,
            targetTag: event.target?.tagName,
            tabId: getTabId(control),
            label: getTabLabel(control),
        });

        if (event.key === "Enter" || event.key === " ")
        {
            event.preventDefault();
            event.stopPropagation();
            activateTabFromKeyboard(root, control, app);
            return;
        }

        if (event.key === "Tab")
        {
            const controls = getSiblingTabControls(control);
            const index = controls.indexOf(control);
            if (index === -1 || controls.length < 2) return;

            const nextIndex = event.shiftKey
                ? (index - 1 + controls.length) % controls.length
                : (index + 1) % controls.length;
            const nextControl = controls[nextIndex];

            event.preventDefault();
            event.stopPropagation();
            nextControl.focus({ preventScroll: false });

            debugSheetTabs("sheet Tab cycled between tab controls", {
                appId: app?.id,
                fromTabId: getTabId(control),
                toTabId: getTabId(nextControl),
                shiftKey: event.shiftKey,
                tabCount: controls.length,
                tabIds: controls.map(candidate => getTabId(candidate)),
            });
        }
    }, true);

    root.addEventListener("keydown", event =>
    {
        if (event.key !== "Tab") return;
        if (event.ctrlKey || event.altKey || event.metaKey) return;

        const activeElement = document.activeElement;
        if (!(activeElement instanceof HTMLElement)) return;
        if (!root.contains(activeElement)) return;
        if (getTabControlFromTarget(activeElement)) return;

        const menuContainer = getVisibleMenuContainer(root);
        const menuTargets = getVisibleMenuTargets(root);
        if (
            menuTargets.length
            && (
                menuContainer === activeElement
                || menuContainer?.contains(activeElement)
                || menuTargets.some(target => target === activeElement || target.contains(activeElement))
                || isOpenInventoryMenuTrigger(activeElement)
            )
        )
        {
            const focusTargets = isOpenInventoryMenuTrigger(activeElement)
                ? [activeElement, ...menuTargets]
                : menuTargets;
            const currentTarget = focusTargets.find(target => target === activeElement || target.contains(activeElement))
                ?? (menuContainer === activeElement ? focusTargets[0] : null);
            const index = currentTarget ? focusTargets.indexOf(currentTarget) : -1;
            const nextIndex = index === -1
                ? 0
                : event.shiftKey
                    ? (index - 1 + focusTargets.length) % focusTargets.length
                    : (index + 1) % focusTargets.length;
            const nextTarget = focusTargets[nextIndex];

            event.preventDefault();
            event.stopPropagation();
            nextTarget.focus({ preventScroll: false });

            debugSheetTabs("panel Tab cycled through visible menu targets", {
                appId: app?.id,
                fromTag: activeElement.tagName,
                fromClasses: activeElement.className,
                toTag: nextTarget?.tagName,
                toClasses: nextTarget?.className,
                shiftKey: event.shiftKey,
                targetCount: focusTargets.length,
            });
            return;
        }

        const activeTab = getActiveTabControl(root);
        const activePanel = getFocusedSheetPanel(root, activeElement);
        if (!activePanel || !activePanel.contains(activeElement)) return;

        const adapter = getSheetAdapter(app, root);
        const targets = getPanelKeyboardTargets(activePanel, adapter);
        if (!targets.length) return;

        const currentTarget = getCurrentPanelKeyboardTarget(targets, activeElement);
        const index = currentTarget ? targets.indexOf(currentTarget) : -1;
        if (index === -1) return;

        const nextIndex = event.shiftKey
            ? (index - 1 + targets.length) % targets.length
            : (index + 1) % targets.length;
        const nextTarget = targets[nextIndex];

        event.preventDefault();
        event.stopPropagation();
        nextTarget.focus({ preventScroll: false });

        debugSheetTabs("panel Tab cycled between panel targets", {
            appId: app?.id,
            adapter: adapter.id,
            activeTabId: getTabId(activeTab),
            fromTag: currentTarget?.tagName ?? activeElement.tagName,
            fromClasses: currentTarget?.className ?? activeElement.className,
            toTag: nextTarget?.tagName,
            toClasses: nextTarget?.className,
            shiftKey: event.shiftKey,
            targetCount: targets.length,
        });

    }, true);

    root.addEventListener("click", event =>
    {
        const control = getTabControlFromTarget(event.target);
        if (!control || !root.contains(control)) return;
        requestAnimationFrame(() => syncTabKeyboardSupport(root, app));
    });

    root.addEventListener("keydown", event =>
    {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!root.contains(target)) return;
        handleInventoryKeyboardActivation(event, app, root, "root");
    }, true);

}

function enhanceActorSheetTabs(app, html)
{
    const root = getApplicationElement(app, html);
    const adapter = root ? getSheetAdapter(app, root) : null;

    debugSheetTabs("renderApplicationV2 received", {
        appId: app?.id,
        constructorName: app?.constructor?.name,
        documentName: app?.document?.documentName,
        actorDocumentName: app?.actor?.documentName,
        adapter: adapter?.id,
        title: app?.title,
        hasElement: !!app?.element,
        rootTag: root?.tagName,
        rootClasses: root?.className,
    });

    if (!root)
    {
        debugSheetTabs("enhanceActorSheetTabs bail: no root", {
            appId: app?.id,
            constructorName: app?.constructor?.name,
        });
        return;
    }

    if (!isActorSheetApplication(app, root))
    {
        debugSheetTabs("enhanceActorSheetTabs bail: not actor sheet", {
            appId: app?.id,
            constructorName: app?.constructor?.name,
            documentName: app?.document?.documentName,
            actorDocumentName: app?.actor?.documentName,
        });
        return;
    }

    if (!syncTabKeyboardSupport(root, app))
    {
        debugSheetTabs("enhanceActorSheetTabs bail: no sheet tabs found", {
            appId: app?.id,
            constructorName: app?.constructor?.name,
            title: app?.title,
        });
        return;
    }

    applyInventoryKeyboardSupport(root, app);
    setActiveActorSheet(app, root);
    attachSheetTabHandlers(root, app);
    debugSheetMarkup(root, app);

    debugSheetTabs("enhanceActorSheetTabs complete", {
        appId: app?.id,
        constructorName: app?.constructor?.name,
        title: app?.title,
    });
}

window.addEventListener("keydown", event =>
{
    const activeElement = document.activeElement;
    const eventElement = event.target instanceof HTMLElement
        ? event.target
        : event.composedPath?.().find(target => target instanceof HTMLElement) ?? null;

    if (
        (event.key === "Enter" || event.key === " ")
        && !event.ctrlKey
        && !event.altKey
        && !event.metaKey
        && eventElement instanceof HTMLElement
    )
    {
        const { app, root } = getActiveActorSheetState();
        const keyTarget = activeElement instanceof HTMLElement && root instanceof HTMLElement && root.contains(activeElement)
            ? activeElement
            : eventElement;
        if (
            app
            && root instanceof HTMLElement
            && root.contains(keyTarget)
            && !getTabControlFromTarget(keyTarget)
            && isInventoryKeyboardActionTarget(keyTarget)
        )
        {
            handleInventoryKeyboardActivation(event, app, root, "window");
            return;
        }
    }

    if (
        (event.key === "Enter" || event.key === " ")
        && !event.ctrlKey
        && !event.altKey
        && !event.metaKey
        && !getTabControlFromTarget(activeElement)
        && isKeyboardActivatableElement(activeElement)
    )
    {
        // If focus is inside one of our native modal dialogs, always consume the
        // event and click the focused button; never let Enter fall through to
        // the browser's form/dialog default, which can activate the wrong button.
        const fnDialog = activeElement?.closest?.('dialog[class*="fn-"]');
        if (fnDialog instanceof HTMLElement)
        {
            event.preventDefault();
            event.stopPropagation();
            activeElement.click();
            return;
        }
        const { root } = getActiveActorSheetState();
        const previousWindowIds = new Set(getVisibleApplicationElements().map(getApplicationIdentity).filter(Boolean));
        const activeWindowBeforeClick = ui?.activeWindow ?? null;
        if (
            activeElement instanceof HTMLElement
            && root instanceof HTMLElement
            && root.contains(activeElement)
            && (
                isInventoryKeyboardActionTarget(activeElement)
                || !!activeElement.closest(".item, .activity-row, .inventory-list, [data-item-list='inventory']")
            )
        )
        {
            debugSheetTabs("global keyboard activation skipped for sheet inventory target", {
                activeElementTag: activeElement?.tagName,
                activeElementClasses: activeElement?.className,
                activeElementText: activeElement?.textContent?.trim()?.slice(0, 80),
            });
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        activeElement.click();
        if (
            activeElement instanceof HTMLElement
            && activeElement.matches(".activity-usage [data-action='use'], dialog.activity-usage [data-action='use'], .application.activity-usage [data-action='use']")
        )
        {
            focusActivationResult(previousWindowIds, {
                originatingApp: activeWindowBeforeClick,
                debug: debugSheetTabs,
                getApplicationElement,
            });
        }

        debugSheetTabs("global keyboard activation clicked focused control", {
            key: event.key,
            activeElementTag: activeElement?.tagName,
            activeElementClasses: activeElement?.className,
            activeElementText: activeElement?.textContent?.trim()?.slice(0, 80),
        });
        return;
    }

    if (event.ctrlKey && event.key === "Tab")
    {
        const { app, root } = getActiveActorSheetState();
        if (!app || !root) return;

        const activeTab = getActiveTabControl(root) ?? getInitialSheetFocusTarget(root, event.shiftKey);
        if (!activeTab) return;

        event.preventDefault();
        setActiveActorSheet(app, root);
        activeTab.focus({ preventScroll: false });
        announceSheetTabsHint(app);

        debugSheetTabs("global Ctrl+Tab restored focus to sheet tab", {
            appId: app?.id,
            shiftKey: event.shiftKey,
            tabId: getTabId(activeTab),
            tabClasses: activeTab?.className,
        });
        return;
    }

    if (event.key !== "Tab") return;
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    const { app, root } = getActiveActorSheetState();
    const menuContainer = getVisibleMenuContainer(root ?? document.body);
    const menuTargets = getVisibleMenuTargets(root ?? document.body);
    if (
        menuTargets.length
        && activeElement instanceof HTMLElement
        && (
            menuContainer === activeElement
            || menuContainer?.contains(activeElement)
            || menuTargets.some(target => target === activeElement || target.contains(activeElement))
            || isOpenInventoryMenuTrigger(activeElement)
        )
    )
    {
        const focusTargets = isOpenInventoryMenuTrigger(activeElement)
            ? [activeElement, ...menuTargets]
            : menuTargets;
        const currentTarget = focusTargets.find(target => target === activeElement || target.contains(activeElement))
            ?? (menuContainer === activeElement ? focusTargets[0] : null);
        const index = currentTarget ? focusTargets.indexOf(currentTarget) : -1;
        const nextIndex = index === -1
            ? 0
            : event.shiftKey
                ? (index - 1 + focusTargets.length) % focusTargets.length
                : (index + 1) % focusTargets.length;
        const nextTarget = focusTargets[nextIndex];

        event.preventDefault();
        event.stopPropagation();
        nextTarget.focus({ preventScroll: false });

        debugSheetTabs("global Tab cycled through visible menu targets", {
            appId: app?.id,
            fromTag: activeElement.tagName,
            fromClasses: activeElement.className,
            toTag: nextTarget?.tagName,
            toClasses: nextTarget?.className,
            shiftKey: event.shiftKey,
            targetCount: focusTargets.length,
        });
        return;
    }

    if (app && root && activeElement instanceof HTMLElement && root.contains(activeElement) && !isTextEntryElement(activeElement))
    {
        const activeTab = getActiveTabControl(root);
        const activePanel = getFocusedSheetPanel(root, activeElement);
        if (activePanel && activePanel.contains(activeElement))
        {
            const adapter = getSheetAdapter(app, root);
            const targets = getPanelKeyboardTargets(activePanel, adapter);
            if (targets.length)
            {
                const currentTarget = getCurrentPanelKeyboardTarget(targets, activeElement);
                const index = currentTarget ? targets.indexOf(currentTarget) : -1;
                const nextIndex = index === -1
                    ? (event.shiftKey ? targets.length - 1 : 0)
                    : event.shiftKey
                        ? (index - 1 + targets.length) % targets.length
                        : (index + 1) % targets.length;
                const nextTarget = targets[nextIndex];

                event.preventDefault();
                event.stopPropagation();
                nextTarget.focus({ preventScroll: false });

                debugSheetTabs("global Tab cycled between panel targets", {
                    appId: app?.id,
                    adapter: adapter.id,
                    activeTabId: getTabId(activeTab),
                    fromTag: activeElement.tagName,
                    fromClasses: activeElement.className,
                    toTag: nextTarget?.tagName,
                    toClasses: nextTarget?.className,
                    shiftKey: event.shiftKey,
                    targetCount: targets.length,
                });
                return;
            }
        }
    }

    if (app && root && root.contains(activeElement))
    {
        debugSheetTabs("global Tab ignored: focus already inside sheet after panel checks", {
            appId: app?.id,
            activeElementTag: activeElement?.tagName,
            activeElementClasses: activeElement?.className,
        });
        if (!isTextEntryElement(activeElement)) setActiveActorSheet(app, root);
        return;
    }

    if (!app || !root)
    {
        debugSheetTabs("global Tab ignored: no active actor sheet", {
            activeElementTag: document.activeElement?.tagName,
            activeElementClasses: document.activeElement?.className,
            activeWindowId: ui?.activeWindow?.id,
            activeWindowConstructor: ui?.activeWindow?.constructor?.name,
        });
        return;
    }

    const otherWindow = activeElement?.closest?.(".window-app, .application");
    if (otherWindow && !root.contains(otherWindow))
    {
        debugSheetTabs("global Tab ignored: focus is in another window", {
            appId: app?.id,
            otherWindowClasses: otherWindow?.className,
            activeElementTag: activeElement?.tagName,
        });
        return;
    }

    const target = getInitialSheetFocusTarget(root, event.shiftKey);
    if (!target)
    {
        debugSheetTabs("global Tab bail: no focus target inside sheet", {
            appId: app?.id,
            shiftKey: event.shiftKey,
        });
        return;
    }

    event.preventDefault();
    setActiveActorSheet(app, root);
    announceSheetTabsHint(app);
    debugSheetTabs("global Tab redirected into sheet", {
        appId: app?.id,
        shiftKey: event.shiftKey,
        targetTag: target?.tagName,
        targetClasses: target?.className,
        targetText: target?.textContent?.trim?.(),
    });
    target.focus({ preventScroll: false });
}, true);

async function handleRollDamageHook(rolls, data = {}, hookName = "dnd5e.rollDamage")
{
    const pending = FN_SHEET_TABS_STATE.pendingRollApplication;
    debugSheetTabs("received damage roll hook", {
        hookName,
        hasPending: !!pending,
        pendingItemName: pending?.itemName,
        pendingTargetName: pending?.targetToken?.name,
        subjectType: data?.subject?.type,
        subjectItemName: data?.subject?.item?.name,
    });

    if (!pending?.targetToken?.actor) return;
    if (pending.activity && data.subject && pending.activity !== data.subject)
    {
        debugSheetTabs("ignored damage roll hook due to subject mismatch", {
            hookName,
            pendingItemName: pending.itemName,
            pendingActivityType: pending.activity?.type,
            subjectType: data.subject?.type,
            subjectItemName: data.subject?.item?.name,
        });
        return;
    }

    const roll = Array.isArray(rolls) ? rolls[0] : null;
    const damageTotal = getRollTotalValue(roll);
    const rollType = roll?.parent?.flags?.dnd5e?.roll?.type;
    const isHealingRoll = rollType === "healing" || data?.subject?.type === "heal";
    const appliedAmount = isHealingRoll ? -Math.abs(damageTotal) : damageTotal;
    debugSheetTabs("damage roll payload snapshot", {
        itemName: pending.itemName,
        targetName: pending.targetToken.name,
        rollCount: Array.isArray(rolls) ? rolls.length : 0,
        damageTotal,
        appliedAmount,
        rollType,
        isHealingRoll,
        rollSummary: roll
            ? {
                constructorName: roll.constructor?.name,
                total: roll.total,
                _total: roll._total,
                resultTotal: roll.result?.total,
                formula: roll.formula,
            }
            : null,
    });
    if (!Number.isFinite(damageTotal)) return;

    FN_SHEET_TABS_STATE.pendingRollApplication = null;
    FN_SHEET_TABS_STATE.pendingConsumableApplication = null;

    try
    {
        const applyOptions = {
            isDelta: true,
            originatingMessage: roll?.parent ?? null,
        };
        let applyPath = "actor";

        if (!game.user.isGM && !canCurrentUserApplyToTarget(pending.targetToken))
        {
            const response = await requestGMApplyRollResult({
                targetToken: pending.targetToken,
                appliedAmount,
                originatingMessage: roll?.parent ?? null,
                itemName: pending.itemName,
                targetName: pending.targetToken.name,
                rollType,
                isHealingRoll,
                damageTotal,
            });
            applyPath = `gm:${response.applyPath ?? "unknown"}`;
        }
        else
        {
            applyPath = await applyRollResultToTarget(pending.targetToken, appliedAmount, applyOptions);
        }

        debugSheetTabs("applied roll result to selected target", {
            itemName: pending.itemName,
            targetName: pending.targetToken.name,
            damageTotal,
            appliedAmount,
            rollType,
            isHealingRoll,
            applyPath,
        });
        restoreLastAttackControlFocus();
    }
    catch (error)
    {
        debugSheetTabs("failed to apply damage to selected target", {
            itemName: pending.itemName,
            targetName: pending.targetToken.name,
            damageTotal,
            error: error?.message ?? String(error),
        });
        restoreLastAttackControlFocus();
    }
}

registerSheetTabBootstrap({
    focusActiveActorSheetTabFromHotkey,
    enhanceActorSheetTabs,
    handleModuleSocketMessage,
    getRollTotalValue,
    getTargetArmorClass,
    openAttackResultDialog,
    handleRollDamageHook,
    registerFocusedItemUseIntercept,
});
