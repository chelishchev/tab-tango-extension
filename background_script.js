// Global variables
let tabStore = {};
let currentWindowId = null;
let isPreviousTabHighlighted = false;

// Initialize the current window ID
async function initCurrentWindowId()
{
	try
	{
		const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
		const currentWindow = windows.find(window => window.focused);
		if (currentWindow)
		{
			currentWindowId = currentWindow.id;
			console.debug('Initialized currentWindowId:', currentWindowId);
		}
		else if (windows.length > 0)
		{
			currentWindowId = windows[0].id;
			console.debug('No focused window found, using first window:', currentWindowId);
		}
	}
	catch (error)
	{
		console.error('Failed to initialize currentWindowId:', error);
	}
}

// Helper function to fetch the tab store from local storage if necessary
async function ensureTabStoreLoaded()
{
	try
	{
		if (Object.keys(tabStore).length === 0)
		{  // Check if tabStore is empty
			return new Promise(resolve => {
				chrome.storage.local.get({ tabStore: {} }, (result) => {
					tabStore = result.tabStore;
					console.debug('Loaded tab store from storage:', tabStore);
					resolve();
				});
			});
		}
	}
	catch (error)
	{
		console.error('Error loading tab store:', error);
		// Reset to empty if there's an error
		tabStore = {};
	}
}

// Setup a periodic tab store verification to prevent stale data
function setupPeriodicVerification()
{
	// Verify tab store integrity every 30 seconds
	setInterval(async () => {
		try
		{
			console.debug('Running periodic verification');

			// Make sure we have a valid current window
			if (!currentWindowId)
			{
				await initCurrentWindowId();
			}

			// Verify all windows in tab store still exist
			const windows = await chrome.windows.getAll();
			const windowIds = windows.map(w => w.id);

			// Clean up windows that no longer exist
			for (const storedWindowId in tabStore)
			{
				if (!windowIds.includes(Number(storedWindowId)))
				{
					console.debug('Removing stale window from tab store:', storedWindowId);
					delete tabStore[storedWindowId];
				}
			}

			// Verify all tabs in the current window still exist
			if (currentWindowId && tabStore[currentWindowId])
			{
				const tabs = await chrome.tabs.query({ windowId: currentWindowId });
				const tabIds = tabs.map(t => t.id);

				// Check if any stored tabs don't exist anymore
				const hasStaleData = tabStore[currentWindowId].some(id => !tabIds.includes(id));

				// If we found stale data, refresh the entire window's tabs
				if (hasStaleData)
				{
					console.debug('Found stale tab data, refreshing window:', currentWindowId);
					await refreshTabsForWindow(currentWindowId);
				}
			}

			await updateTabStore();
		}
		catch (error)
		{
			console.error('Error in periodic verification:', error);
		}
	}, 30000); // Run every 30 seconds
}

// Initialize verification on startup
setupPeriodicVerification();

// Helper function to update the tab store in local storage
async function updateTabStore()
{
	await chrome.storage.local.set({ tabStore });
	console.debug('Updated tab store in storage:', tabStore);
}

// Installation setup
chrome.runtime.onInstalled.addListener(async () => {
	console.debug('Extension installed');
	chrome.runtime.openOptionsPage();

	// Initialize the current window ID
	await initCurrentWindowId();

	// Initialize tab store with all open tabs
	try
	{
		const windows = await chrome.windows.getAll({ populate: true });
		windows.forEach(window => {
			if (!tabStore[window.id])
			{
				tabStore[window.id] = [];
			}

			// Add all tabs for this window, ensuring active tab is last
			const nonActiveTabs = window.tabs.filter(tab => !tab.active).map(tab => tab.id);
			const activeTabs = window.tabs.filter(tab => tab.active).map(tab => tab.id);
			tabStore[window.id] = [...nonActiveTabs, ...activeTabs];
		});
		await updateTabStore();
		console.debug('Initial tab store set on installation:', tabStore);
	}
	catch (error)
	{
		console.error('Failed to initialize tab store:', error);
	}
});

// Event listener for window creation
chrome.windows.onCreated.addListener(async (window) => {
	await ensureTabStoreLoaded();
	tabStore[window.id] = [];
	await updateTabStore();
	console.debug('Window created with ID:', window.id);
});

// Clean up when a window is removed
chrome.windows.onRemoved.addListener(async (windowId) => {
	await ensureTabStoreLoaded();
	delete tabStore[windowId];
	await updateTabStore();
	console.debug('Window removed with ID:', windowId);
});

// Update the current window ID when window focus changes
chrome.windows.onFocusChanged.addListener(async (windowId) => {
	try
	{
		const WINDOW_ID_NONE = -1;
		console.debug('Focus changed to window ID:', windowId);

		if (windowId === WINDOW_ID_NONE)
		{
			// Chrome is not focused, but don't lose track of our current window
			console.debug('Window focus lost (Chrome not focused)');
			return;
		}

		if (windowId > 0)
		{
			currentWindowId = windowId;

			// When switching to a window, make sure its tab info is up-to-date
			await refreshTabsForWindow(windowId);
		}
	}
	catch (error)
	{
		console.error('Error handling window focus change:', error);
	}
});

// Update tabStore when a tab is activated
chrome.tabs.onActivated.addListener(async (activeInfo) => {
	try
	{
		console.debug('Tab activated:', activeInfo);
		currentWindowId = activeInfo.windowId;
		isPreviousTabHighlighted = false;

		// Make sure the window exists in our tab store
		if (!tabStore[activeInfo.windowId])
		{
			console.debug('Creating new window entry in tab store:', activeInfo.windowId);
			tabStore[activeInfo.windowId] = [];
		}

		// Double-check that we have the right tabs for this window
		const tabs = await chrome.tabs.query({ windowId: activeInfo.windowId });
		if (tabs.length > 0 && (tabStore[activeInfo.windowId].length === 0 ||
			!tabs.some(tab => tabStore[activeInfo.windowId].includes(tab.id))))
		{
			console.debug('Tab store may be out of sync, refreshing window:', activeInfo.windowId);
			await refreshTabsForWindow(activeInfo.windowId);
		}

		await setCurrentTab(activeInfo.tabId, activeInfo.windowId);
	}
	catch (error)
	{
		console.error('Error handling tab activation:', error);
	}
});

// Update tabStore when a tab is removed
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
	try
	{
		await ensureTabStoreLoaded();

		// Remove the tab from ALL windows, not just the current one
		for (const windowId in tabStore)
		{
			if (tabStore[windowId])
			{
				tabStore[windowId] = tabStore[windowId].filter(id => id !== tabId);
			}
		}

		await updateTabStore();
		console.debug('Tab removed with ID:', tabId, 'Window closing:', removeInfo.isWindowClosing);
	}
	catch (error)
	{
		console.error('Error handling tab removal:', error);
	}
});

// Track tabs moving between windows
chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
	try
	{
		await ensureTabStoreLoaded();

		// First remove the tab from its previous window (if found)
		for (const windowId in tabStore)
		{
			if (tabStore[windowId])
			{
				tabStore[windowId] = tabStore[windowId].filter(id => id !== tabId);
			}
		}

		// Add the tab to its new window
		if (!tabStore[attachInfo.newWindowId])
		{
			tabStore[attachInfo.newWindowId] = [];
		}

		tabStore[attachInfo.newWindowId].push(tabId);
		await updateTabStore();
		console.debug('Tab attached to window:', tabId, 'Window ID:', attachInfo.newWindowId);
	}
	catch (error)
	{
		console.error('Error handling tab attachment:', error);
	}
});

// Function to refresh tab store for a specific window
async function refreshTabsForWindow(windowId)
{
	try
	{
		if (!windowId)
		{
			console.debug('No window ID provided for refresh');
			return;
		}

		console.debug('Refreshing tab store for window:', windowId);

		// Get all tabs for the window
		const tabs = await chrome.tabs.query({ windowId });

		// Update the tab store
		tabStore[windowId] = [];

		// Add all tabs, ensuring active tab is last
		const nonActiveTabs = tabs.filter(tab => !tab.active).map(tab => tab.id);
		const activeTabs = tabs.filter(tab => tab.active).map(tab => tab.id);
		tabStore[windowId] = [...nonActiveTabs, ...activeTabs];

		await updateTabStore();
		console.debug('Tab store refreshed for window:', windowId, tabStore[windowId]);
	}
	catch (error)
	{
		console.error('Error refreshing tab store for window:', windowId, error);
	}
}

// Command listeners for tab operations
// Command listeners for tab operations
chrome.commands.onCommand.addListener(async (command) => {
	if (command === 'toggle-tab')
	{
		await toggleTab();
	}
	else if (command === 'duplicate-tab')
	{
		await duplicateCurrentTab();
	}
	else if (command === 'highlight-previous-tab')
	{
		await highlightPreviousTab();
	}
});

// Function to toggle to the previous tab
async function toggleTab()
{
	try
	{
		// Make sure we have the current window ID
		if (!currentWindowId)
		{
			await initCurrentWindowId();
		}

		const previousTab = await getPreviousTab();
		if (previousTab !== undefined)
		{
			// Verify the tab still exists before switching to it
			try
			{
				const tab = await chrome.tabs.get(previousTab);
				if (tab)
				{
					await chrome.tabs.update(previousTab, { active: true });
					console.debug('Successfully toggled to tab:', previousTab);
				}
			}
			catch (error)
			{
				console.error('Failed to toggle to tab (tab may not exist):', previousTab, error);
				// Tab doesn't exist, refresh the tab store for this window
				await refreshTabsForWindow(currentWindowId);
			}
		}
		else
		{
			console.debug('No previous tab found for toggling');
		}
	}
	catch (error)
	{
		console.error('Error in toggleTab:', error);
	}
}

// Function to duplicate the current active tab
async function duplicateCurrentTab()
{
	try
	{
		// Make sure we have the current window ID
		if (!currentWindowId)
		{
			await initCurrentWindowId();
		}

		const currentTab = await getCurrentTab();
		if (currentTab !== undefined)
		{
			try
			{
				// Verify the tab exists before duplicating
				const tab = await chrome.tabs.get(currentTab);
				if (tab)
				{
					await chrome.tabs.duplicate(currentTab);
					console.debug('Successfully duplicated tab:', currentTab);
				}
			}
			catch (error)
			{
				console.error('Failed to duplicate tab (tab may not exist):', currentTab, error);
				// Tab doesn't exist, refresh the tab store for this window
				await refreshTabsForWindow(currentWindowId);
			}
		}
		else
		{
			console.debug('No current tab found for duplication');
		}
	}
	catch (error)
	{
		console.error('Error in duplicateCurrentTab:', error);
	}
}

// Function to highlight the previous tab
async function highlightPreviousTab()
{
	try
	{
		// Make sure we have the current window ID
		if (!currentWindowId)
		{
			await initCurrentWindowId();
		}

		const currentTabId = await getCurrentTab();
		const previousTabId = await getPreviousTab();

		// Если подсветка уже активна, сбрасываем её
		if (isPreviousTabHighlighted)
		{
			try
			{
				// Получаем текущую вкладку
				const currentTab = await chrome.tabs.get(currentTabId);

				// Подсвечиваем только текущую вкладку
				await chrome.tabs.highlight({
					tabs: [currentTab.index],
					windowId: currentWindowId,
				});

				isPreviousTabHighlighted = false;
				console.debug('Removed highlight from previous tab');
			}
			catch (error)
			{
				console.error('Failed to reset tab highlighting:', error);
			}
			return;
		}

		// Если подсветка неактивна, подсвечиваем предыдущую вкладку
		if (previousTabId !== undefined && currentTabId !== undefined)
		{
			try
			{
				// Get tab indexes for both tabs
				const [currentTab, previousTab] = await Promise.all([
					chrome.tabs.get(currentTabId),
					chrome.tabs.get(previousTabId),
				]);

				// Highlight both tabs with current tab first to maintain focus
				await chrome.tabs.highlight({
					tabs: [currentTab.index, previousTab.index],
					windowId: currentWindowId,
				});

				isPreviousTabHighlighted = true;
				console.debug('Highlighted previous tab:', previousTabId);
			}
			catch (error)
			{
				console.error('Failed to highlight tab (tab may not exist):', error);
				// Refresh tab store if tabs can't be found
				await refreshTabsForWindow(currentWindowId);
			}
		}
		else
		{
			console.debug('No previous tab found for highlighting');
		}
	}
	catch (error)
	{
		console.error('Error in highlightPreviousTab:', error);
	}
}

// Set the current active tab in the tabStore
async function setCurrentTab(tabId, windowId)
{
	await ensureTabStoreLoaded();
	tabStore[windowId] = (tabStore[windowId] || []).filter(id => id !== tabId);
	tabStore[windowId].push(tabId);
	await updateTabStore();
	console.debug('Set current tab:', tabId, 'for window:', windowId);
}

// Fetch the current active tab from tabStore
async function getCurrentTab()
{
	await ensureTabStoreLoaded();
	return tabStore[currentWindowId] && tabStore[currentWindowId].slice(-1)[0];
}

// Fetch the previous tab from tabStore
async function getPreviousTab()
{
	await ensureTabStoreLoaded();
	const length = tabStore[currentWindowId] ? tabStore[currentWindowId].length : 0;
	return length > 1 ? tabStore[currentWindowId][length - 2] : undefined;
}
