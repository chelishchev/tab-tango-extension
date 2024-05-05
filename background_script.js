// Global variables
let tabStore = {};
let currentWindowId = null;

// Helper function to fetch the tab store from local storage if necessary
async function ensureTabStoreLoaded()
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
	const tabs = await chrome.tabs.query({});
	tabs.forEach(tab => {
		if (!tabStore[tab.windowId])
		{
			tabStore[tab.windowId] = [];
		}
		tabStore[tab.windowId].push(tab.id);
	});
	await updateTabStore();
	console.debug('Initial tab store set on installation:', tabStore);
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
chrome.windows.onFocusChanged.addListener((windowId) => {
	if (windowId > 0)
	{  // Ensure that currentWindowId is only updated for valid window IDs
		currentWindowId = windowId;
	}
	console.debug('Focus changed to window ID:', windowId);
});

// Update tabStore when a tab is activated
chrome.tabs.onActivated.addListener(async (activeInfo) => {
	currentWindowId = activeInfo.windowId;
	await setCurrentTab(activeInfo.tabId, activeInfo.windowId);
});

// Update tabStore when a tab is removed
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
	await ensureTabStoreLoaded();
	if (tabStore[currentWindowId])
	{
		tabStore[currentWindowId] = tabStore[currentWindowId].filter(id => id !== tabId);
		await updateTabStore();
	}
	console.debug('Tab removed with ID:', tabId, 'Window closing:', removeInfo.isWindowClosing);
});

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
});

// Function to toggle to the previous tab
async function toggleTab()
{
	const previousTab = await getPreviousTab();
	if (previousTab !== undefined)
	{
		chrome.tabs.update(previousTab, { active: true });
	}
}

// Function to duplicate the current active tab
async function duplicateCurrentTab()
{
	const currentTab = await getCurrentTab();
	if (currentTab !== undefined)
	{
		chrome.tabs.duplicate(currentTab);
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
