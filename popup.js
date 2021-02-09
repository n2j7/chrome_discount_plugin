const INJ_NODE_ID = 'xDiscountInjection';

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

async function callDiscountApi(id) {
	let api_url = await getSettings('api_url');
	return await fetch(`${api_url}${id}`)
		.then(r => r.json());
}

function setStage(stage, state) {
	document.getElementById(stage).className = state ? 'confirm' : 'err';
}

async function replacePrice(tab) {
	if (!tab || !tab.url) return; // ignore system windows
	let code_selector = await getSettings('code_selector');
	let id_part = await asyncScript(tab.id, `document.querySelector('${code_selector}').innerText`);
	let id_searcher = id_part.match(/\d+/);
	if (!id_searcher) return false;
	let product_id = id_searcher[0];
	console.log('product_id', product_id);
	setStage('product', true);

	// detect that discount has already placed
	let inj_detector_code = `(function(){
		return document.querySelectorAll('#${INJ_NODE_ID}').length;
	})();`;
	let inj_result = await asyncScript(tab.id, inj_detector_code);
	console.log('injection', inj_result);
	if (inj_result) return false;


	// detect seller
	let seller_selector = await getSettings('seller_selector');
	let seller_match = await getSettings('seller_match');
	let seller_detect_code = `(function(){
		return document.querySelector('${seller_selector}').innerText.match(new RegExp('${seller_match}'));
	})();`;
	let seller_result = await asyncScript(tab.id, seller_detect_code);
	console.log('seller', seller_result);
	if (!seller_result) return false;
	setStage('seller', true);

	// get product price from API
	const price_info = await callDiscountApi(product_id);
	console.log('price', price_info);
	setStage('api', true);

	// add extra styles
	chrome.tabs.insertCSS(tab.id, { file: 'xDiscountInject.css' });

	// change price
	if (price_info && price_info.minPrice) {
		let price_selector = await getSettings('price_selector');
		let content = `<span id="${INJ_NODE_ID}">${price_info.minPrice}</span>`;
		let change_price_code = `(function(){ 
			var el = document.querySelector('${price_selector}');
			el.innerHTML = '${content} / ' + el.innerHTML;
		})()`;
		await asyncScript(tab.id, change_price_code);
	}
	setStage('result', true);
}

// init on page load
document.addEventListener('DOMContentLoaded', () => {
	let keys = [
		'api_url',
		'code_selector',
		'seller_selector',
		'seller_match',
		'price_selector',
	];
	chrome.storage.sync.get(keys, function (result) {
		console.log(result);
		if (Object.keys(result).length != keys.length) {
			setStage('settings', false);
			return false;
		}
		setStage('settings', true);

		chrome.tabs.query({ active: true }, tabs => {
			tabs.map(replacePrice);
		});
	});

});
