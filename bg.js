async function asyncScript(tabId, code) {
	return new Promise((ff, rj) => {
		try {
			chrome.tabs.executeScript(
				tabId,
				{ code },
				r => { ff(r[0]); }
			);
		}
		catch (e) { rj(e); }
	});
}

async function getSettings(key) {
	return new Promise((ff, rj) => {
		try {
			chrome.storage.sync.get([key], r => ff(r[key]));
		}
		catch (e) {
			rj(e);
		}
	});
}

// Browser action (when icon clicked on bar and no popup in manifest)
// chrome.browserAction.onClicked.addListener(async (tab) => {
// });

async function onTabLoadUrl(tab) {
	let url_parser = document.createElement('a');
	url_parser.href = tab.url;

	// check domain
	let domain_regexp = await getSettings('domain_regexp');
	if (!domain_regexp || !url_parser.hostname.match(new RegExp(domain_regexp))) {
		return false;
	}
	
	// check seller
	let seller_selector = await getSettings('seller_selector');
	let seller_match = await getSettings('seller_match');
	let seller_detect_code = `(function(){
		var n = document.querySelector('${seller_selector}');
		if (!n) return "";
		return n.innerText.match(new RegExp('${seller_match}'));
	})();`;
	let seller_result = await asyncScript(tab.tabId, seller_detect_code);
	console.log('seller', seller_result);
	if (!seller_result) return false;

	return true;
}

async function changeIcon(is_active) {
	if (is_active) {
		chrome.browserAction.setIcon({ path: 'active128.png' });
	}
	else {
		chrome.browserAction.setIcon({ path: 'inactive128.png' });
	}
}

chrome.tabs.onActivated.addListener(function (info) {
	chrome.tabs.get(info.tabId, function (tab) {
		// console.log('tab ', tab);
		onTabLoadUrl(tab).then(changeIcon);
	});
});
chrome.tabs.onUpdated.addListener(function (info, change, tab) {
	console.log('tab changed', info, change, tab.url);
	if (!change || !change.status || change.status != "complete" || !tab.url) {
		return;
	}
	if (!tab.active) return;
	onTabLoadUrl(tab).then(changeIcon);
});