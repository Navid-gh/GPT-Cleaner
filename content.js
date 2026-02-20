// ─── Settings & State ────────────────────────────────────────────────────────

let settings = {
    enabled: true,
    visibleCount: 10,
};

// Oldest messages are at index 0, newest at the end.
// virtualizedMessages[0] is the very first message of the chat.
let virtualizedMessages = [];

let intersectionObserver = null;
let mutationObserver = null;
let sentinel = null;
let isRestoring = false;

// ─── Bootstrap ───────────────────────────────────────────────────────────────

function init() {
    chrome.storage.sync.get({ enabled: true, visibleCount: 10 }, (result) => {
        settings.enabled = result.enabled;
        settings.visibleCount = result.visibleCount;
        if (settings.enabled) startVirtualization();
    });

    // Listen for popup-driven setting changes
    chrome.storage.onChanged.addListener((changes, ns) => {
        if (ns !== 'sync') return;

        if (changes.enabled !== undefined) {
            settings.enabled = changes.enabled.newValue;
            if (settings.enabled) {
                startVirtualization();
            } else {
                restoreAll();
            }
        }

        if (changes.visibleCount !== undefined) {
            settings.visibleCount = changes.visibleCount.newValue;
            if (settings.enabled) {
                // Re-run full virtualization with new count
                reapplyVirtualization();
            }
        }
    });

    setupNavigationObserver();
}

// ─── Core Virtualization ──────────────────────────────────────────────────────

function startVirtualization() {
    waitForContainer((container) => {
        ensureSentinel(container);
        virtualizeExcess();
        ensureMutationObserver(container);
    });
}

/**
 * Polls until the article container is available in the DOM.
 */
function waitForContainer(callback, attempts = 0) {
    const container = getContainer();
    if (container) {
        callback(container);
    } else if (attempts < 20) {
        setTimeout(() => waitForContainer(callback, attempts + 1), 500);
    }
}

function getArticles() {
    // Only articles that are currently in the DOM (not virtualized)
    return Array.from(document.querySelectorAll('article[data-testid^="conversation-turn-"]'));
}

function getContainer() {
    const first = document.querySelector('article[data-testid^="conversation-turn-"]');
    return first ? first.parentElement : null;
}

/**
 * Remove excess articles from the DOM and prepend them into virtualizedMessages.
 * virtualizedMessages is kept in conversation order: index 0 = first message ever.
 */
function virtualizeExcess() {
    if (!settings.enabled || isRestoring) return;

    const articles = getArticles();
    const excess = articles.length - settings.visibleCount;
    if (excess <= 0) return;

    const container = getContainer();
    const toVirtualize = articles.slice(0, excess); // oldest N articles

    // Prepend to virtualizedMessages so oldest messages stay at index 0
    virtualizedMessages = [...toVirtualize, ...virtualizedMessages];

    toVirtualize.forEach((article) => container.removeChild(article));

    updateSentinelVisibility();
}

/**
 * Called when visibleCount slider changes. Restore or remove to match new count.
 */
function reapplyVirtualization() {
    const articles = getArticles();
    const totalVisible = articles.length;
    const desired = settings.visibleCount;

    if (totalVisible > desired) {
        // Need to virtualize more
        virtualizeExcess();
    } else if (totalVisible < desired && virtualizedMessages.length > 0) {
        // Need to restore some — pull from the newest end of virtualized store
        const deficit = desired - totalVisible;
        restoreMessagesSync(Math.min(deficit, virtualizedMessages.length));
    }
}

// ─── Restore Logic ────────────────────────────────────────────────────────────

/**
 * Async restore (used by IntersectionObserver on scroll).
 * Shows spinner briefly, then inserts the next batch.
 */
function restoreMessages(count) {
    if (virtualizedMessages.length === 0 || isRestoring) return;
    isRestoring = true;

    if (sentinel) sentinel.classList.add('loading');

    // Disconnect MutationObserver during restore to prevent it from
    // re-virtualizing the articles we're about to insert.
    if (mutationObserver) mutationObserver.disconnect();

    setTimeout(() => {
        _doRestore(count);
        if (sentinel) sentinel.classList.remove('loading');

        // Re-enable MutationObserver AFTER a short delay so the
        // browser has finished processing the DOM mutations.
        setTimeout(() => {
            isRestoring = false;
            const container = getContainer();
            if (container && mutationObserver) {
                mutationObserver.observe(container, { childList: true, subtree: false });
            }
        }, 100);
    }, 250);
}

/**
 * Synchronous restore (used by reapplyVirtualization and restoreAll).
 * No spinner, no delay.
 */
function restoreMessagesSync(count) {
    if (virtualizedMessages.length === 0) return;
    _doRestore(count);
}

/**
 * Core restore implementation.
 * Pulls the NEWEST messages from the virtualizedMessages store
 * and inserts them right after the sentinel (i.e., at the top of visible chat).
 *
 * virtualizedMessages layout:
 *   [msg0, msg1, msg2, ..., msgN]   ← index 0 is oldest
 *
 * We want to restore the NEWEST of the stored messages first (highest indexes),
 * because those are the ones immediately older than what's already visible.
 *
 * Example: 5 virtualized [A, B, C, D, E], visible: [F, G, ...]
 * Restore 2 → pull D, E → display order: ...sentinel, D, E, F, G...
 */
function _doRestore(count) {
    const container = getContainer();
    if (!container) return;

    const batch = virtualizedMessages.splice(-count); // removes from END (newest stored)
    // batch is now [D, E] (oldest→newest). We insert them in order after the sentinel.

    const scrollContainer = findScrollContainer();
    const prevScrollHeight = scrollContainer ? scrollContainer.scrollHeight : 0;
    const prevScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

    // Insert each article right before the first visible article (just after sentinel)
    // We insert from last to first so the order is preserved.
    batch.reverse(); // [E, D] → insert E first so D ends up before E
    batch.forEach((article) => {
        article.classList.add('gpt-cleaner-restored');
        // Insert immediately after sentinel
        if (sentinel && sentinel.nextSibling) {
            container.insertBefore(article, sentinel.nextSibling);
        } else {
            container.appendChild(article);
        }
    });

    // Preserve scroll position so the user doesn't jump up
    if (scrollContainer) {
        const newScrollHeight = scrollContainer.scrollHeight;
        scrollContainer.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
    }

    updateSentinelVisibility();
}

/**
 * Restore everything synchronously, then tear down the extension.
 * Idempotent — safe to call multiple times in the same tick.
 */
function restoreAll() {
    if (virtualizedMessages.length > 0) {
        // Restore all stored messages – synchronous, no spinner
        restoreMessagesSync(virtualizedMessages.length);
    }
    stopVirtualization();
}

// ─── Sentinel & IntersectionObserver ─────────────────────────────────────────

function ensureSentinel(container) {
    if (sentinel) return;

    sentinel = document.createElement('div');
    sentinel.className = 'gpt-cleaner-sentinel';

    const loader = document.createElement('div');
    loader.className = 'gpt-cleaner-loader';
    loader.textContent = 'Loading earlier messages…';
    sentinel.appendChild(loader);

    container.insertBefore(sentinel, container.firstChild);

    intersectionObserver = new IntersectionObserver(
        (entries) => {
            if (entries[0].isIntersecting && !isRestoring && virtualizedMessages.length > 0) {
                restoreMessages(10);
            }
        },
        { rootMargin: '300px' }, // trigger a bit before reaching the very top
    );

    intersectionObserver.observe(sentinel);
}

function updateSentinelVisibility() {
    if (!sentinel) return;
    sentinel.style.display = virtualizedMessages.length > 0 ? 'block' : 'none';
}

// ─── MutationObserver (handles new messages while chatting) ───────────────────

function ensureMutationObserver(container) {
    if (mutationObserver) return;

    mutationObserver = new MutationObserver((mutations) => {
        if (isRestoring) return;

        const hasNewArticle = mutations.some((m) =>
            Array.from(m.addedNodes).some(
                (n) => n.nodeType === Node.ELEMENT_NODE && (n.tagName === 'ARTICLE' || n.querySelector?.('article')),
            ),
        );

        if (hasNewArticle) {
            requestAnimationFrame(virtualizeExcess);
        }
    });

    mutationObserver.observe(container, { childList: true, subtree: false });
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

function stopVirtualization() {
    intersectionObserver?.disconnect();
    mutationObserver?.disconnect();
    sentinel?.remove();

    sentinel = null;
    intersectionObserver = null;
    mutationObserver = null;
}

// ─── Scroll Container Detection ───────────────────────────────────────────────

function findScrollContainer() {
    let el = getContainer();
    while (el && el !== document.body) {
        const style = getComputedStyle(el);
        const overflow = style.overflowY;
        if (el.scrollHeight > el.clientHeight && (overflow === 'auto' || overflow === 'scroll')) {
            return el;
        }
        el = el.parentElement;
    }
    return document.documentElement;
}

// ─── SPA Navigation ───────────────────────────────────────────────────────────

function setupNavigationObserver() {
    let lastUrl = location.href;

    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            // Full reset for new conversation
            virtualizedMessages = [];
            stopVirtualization();
            if (settings.enabled) {
                setTimeout(startVirtualization, 1200);
            }
        }
    }).observe(document, { subtree: true, childList: true });
}

// ─── Startup ──────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ─── Popup Messaging ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'getStatus') {
        sendResponse({
            virtualizedCount: virtualizedMessages.length,
            totalCount: getArticles().length + virtualizedMessages.length,
        });
        return true;
    }

    if (request.action === 'restoreAll') {
        restoreAll();
        sendResponse({ ok: true });
        return true;
    }
});
