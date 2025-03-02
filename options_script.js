function detectOS()
{
	const platform = window.navigator.platform;
	const macosPlatforms = ['Macintosh', 'MacIntel', 'MacPPC', 'Mac68K', 'Mac'];
	const windowsPlatforms = ['Win32', 'Win64', 'Windows', 'WinCE', 'Win'];

	if (macosPlatforms.indexOf(platform) !== -1)
	{
		return 'Mac OS';
	}
	else if (windowsPlatforms.indexOf(platform) !== -1)
	{
		return 'Windows';
	}

	return 'Linux';
}

function updateShortcuts()
{
	const os = detectOS();
	const toggleSpan = document.querySelector('#toggle-shortcut .shortcut');
	const highlightSpan = document.querySelector('#highlight-shortcut .shortcut');
	const duplicateSpan = document.querySelector('#duplicate-shortcut .shortcut');

	if (os === 'Mac OS')
	{
		toggleSpan.textContent = '⌘+E';
		highlightSpan.textContent = '⌘+Shift+E';
		duplicateSpan.textContent = '⌘+D';
	}
	else
	{
		toggleSpan.textContent = 'Alt+Q';
		highlightSpan.textContent = 'Alt+Shift+Q';
		duplicateSpan.textContent = 'Alt+D';
	}
}

document.getElementById('configure-shortcuts').addEventListener('click', function() {
	chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

updateShortcuts();
