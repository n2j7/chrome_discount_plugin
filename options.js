const keys = [
	'api_url',
	'code_selector',
	'seller_selector',
	'seller_match',
	'price_selector',
	'domain_regexp',
];

function saveOptions () {
	let options = {};
	keys.map(k => {
		options[k] = new String(document.querySelector(`[name=${k}]`).value).trim();
	});
	chrome.storage.sync.set(options, (r) => {
		console.log('Options saved', r);
		// window.close();
	});
}

document.addEventListener('DOMContentLoaded', () => {
	chrome.storage.sync.get(keys, (result) => {
		console.log('Value currently is ', result);
		keys.map(k => {
			document.querySelector(`[name=${k}]`).value = result[k];
		});
	});

	document.querySelector('[name=save]').addEventListener('click', saveOptions);
});