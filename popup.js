document.addEventListener('DOMContentLoaded', () => {
    const toggleInput = document.getElementById('toggle-extension');
    const visibleCountInput = document.getElementById('visible-count');
    const visibleCountValue = document.getElementById('visible-count-value');
    const restoreAllBtn = document.getElementById('restore-all');
    const dotActive = document.getElementById('dot-active');
    const statusText = document.getElementById('status-text');
    const virtualizedCountEl = document.getElementById('virtualized-count');
    const memorySavedEl = document.getElementById('memory-saved');

    // Load current settings
    chrome.storage.sync.get({ enabled: true, visibleCount: 10 }, (data) => {
        toggleInput.checked = data.enabled;
        visibleCountInput.value = data.visibleCount;
        visibleCountValue.textContent = data.visibleCount;
        updateStatusUI(data.enabled);
    });

    // Get current status from content script
    refreshStatus();

    // Listeners
    toggleInput.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        chrome.storage.sync.set({ enabled: isEnabled });
        updateStatusUI(isEnabled);
        refreshStatus();
    });

    visibleCountInput.addEventListener('input', (e) => {
        visibleCountValue.textContent = e.target.value;
    });

    visibleCountInput.addEventListener('change', (e) => {
        chrome.storage.sync.set({ visibleCount: parseInt(e.target.value, 10) });
        setTimeout(refreshStatus, 100);
    });

    restoreAllBtn.addEventListener('click', () => {
        // Tell content script to restore all, then disable the extension
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) return;
            chrome.tabs.sendMessage(tabs[0].id, { action: 'restoreAll' }, () => {
                // Also mark as disabled so it doesn't re-virtualize
                chrome.storage.sync.set({ enabled: false }, () => {
                    toggleInput.checked = false;
                    updateStatusUI(false);
                    setTimeout(refreshStatus, 300);
                });
            });
        });
    });

    function updateStatusUI(isEnabled) {
        if (isEnabled) {
            dotActive.style.backgroundColor = '#10a37f';
            statusText.textContent = 'Active';
        } else {
            dotActive.style.backgroundColor = '#ef4444';
            statusText.textContent = 'Disabled';
        }
    }

    function refreshStatus() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) return;

            const activeTab = tabs[0];
            if (!activeTab.url || !activeTab.url.includes('chatgpt.com')) {
                virtualizedCountEl.textContent = '0';
                return;
            }

            chrome.tabs.sendMessage(activeTab.id, { action: 'getStatus' }, (response) => {
                if (chrome.runtime.lastError) {
                    // Content script not loaded yet or not on ChatGPT page
                    virtualizedCountEl.textContent = '0';
                    memorySavedEl.textContent = '~0.0';
                    return;
                }

                if (response) {
                    virtualizedCountEl.textContent = response.virtualizedCount;

                    // Display the memory saved calculated directly by the content script (random 1-2 MB per message)
                    memorySavedEl.textContent = `~${response.savedMemoryMB || '0.0'}`;

                    // Sync theme
                    if (response.theme === 'light') {
                        document.body.classList.add('light');
                    } else {
                        document.body.classList.remove('light');
                    }
                }
            });
        });
    }

    // Auto-refresh stats every 2 seconds when popup is open
    setInterval(refreshStatus, 2000);
});
