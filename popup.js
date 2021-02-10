const INJ_NODE_ID = 'xDiscountInjection';

function pr(f) {
	return new Promise((ff, rj) => {
		try { ff(f()); }
		catch (e) { rj(e); }
	});
}

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
	const params = await getSettingsArr([key]);
	return params[key];
}

async function getSettingsArr(keys) {
	return new Promise((ff, rj) => {
		try {
			chrome.storage.sync.get(keys, r => ff(r));
		}
		catch (e) {
			rj(e);
		}
	});
}

async function callDiscountApi(id) {
	let api_url = await getSettings('api_url');
	return fetch(`${api_url}${id}`)
		.then(r => r.json());
}

function setStage(stage, state, err_msg) {
	if (!state || stage == 'result' && state) {
		document.querySelector('.fade').style.display = 'none';
	}
	if (stage) {
		document.getElementById(stage).className = state ? 'confirm' : 'err';
	}
	else {
		// initialization
		document.querySelector('.fade').style.display = '';
		document.getElementById('err').innerHTML = '';
		document.getElementById('err').style.display='';
	}
	if (err_msg) {
		document.getElementById('err').innerHTML = err_msg;
		document.getElementById('err').style.display='block';
	}
}

const checkSettings = async () => {
	const keys = [
		'api_url',
		'code_selector',
		'seller_selector',
		'seller_match',
		'price_selector',
	];

	const params = await getSettingsArr(keys);
	if (Object.keys(params).length != keys.length) {
		throw 'Установлены не все поля конфигурации';
	}

	keys.map(k => {
		if (!params[k]) {// not filled up
			throw `Поле "${k}" конфига не может быть пустым`;
		}
	});

	return true;
}

const searchProductId = (tab) => async () => {
	let code_selector = await getSettings('code_selector');
	let id_part = await asyncScript(tab.id, `(function(){
		var n = document.querySelector('${code_selector}');
		return n ? n.innerText : "";
	})();`);
	let id_searcher = id_part.match(/\d+/);
	if (!id_searcher || !id_searcher[0]) {
		throw 'Не удалось найти код продукта на странице';
	};
	return id_searcher[0];
}

const isDiscountNotPlaced = (tab) => async () => {
	let inj_detector_code = `(function(){
		return document.querySelectorAll('#${INJ_NODE_ID}').length;
	})();`;
	let inj_result = await asyncScript(tab.id, inj_detector_code);
	if (inj_result) {
		throw 'Новая цена уже отображена';
	};
	return true;
}

const isCorrectSeller = (tab) => async () => {
	let seller_selector = await getSettings('seller_selector');
	let seller_match = await getSettings('seller_match');
	let seller_detect_code = `(function(){
		var n = document.querySelector('${seller_selector}');
		if (!n) return "";
		return n.innerText.match(new RegExp('${seller_match}'));
	})();`;
	let seller_result = await asyncScript(tab.id, seller_detect_code);
	console.log('seller', seller_result);
	if (!seller_result) {
		throw `Продавец не соответствует условиям выбора`;
	};
	return true;
}

async function replacePrice(tab) {
	console.log('tab', tab);
	if (!tab || !tab.url) return; // ignore system windows

	let product_id = 0;
	let r = false;// chain of promises doesn't work inside Extension :(
	r = await pr(searchProductId(tab))
		.then(p => {
			console.log('product_id', p);
			product_id = p;
			setStage('product', true);
			return true;
		})
		.catch(err => {
			console.log(tab, err);
			setStage('product', false, err);
		});
	if (!r) return;

	r = await pr(isDiscountNotPlaced(tab))
		.catch(err => {
			console.log('placed', tab, err);
			setStage('seller', true);
			setStage('api', true);
			setStage('result', true);
		});
	if (!r) return;

	r = await pr(isCorrectSeller(tab))
		.then(() => {
			setStage('seller', true);
			return true;
		})
		.catch(err => {
			console.log('seller', tab, err);
			setStage('seller', false, err);
		})
		;
	if (!r) return;

	// get product price from API
	const price_info = await callDiscountApi(product_id)
		.then(p => {
			console.log('price', p);
			setStage('api', true);
			return p;
		})
		.catch(err => {
			console.log('api', err);
			setStage('api', false, "API сервер недоступен");
		})
		;
	if (!price_info) return;


	// add extra styles
	chrome.tabs.insertCSS(tab.id, { file: 'xDiscountInject.css' });

	// change price
	if (price_info && price_info.minPrice) {
		let price_selector = await getSettings('price_selector');
		let content = `<span id="${INJ_NODE_ID}"><span class="xInjPreInfo"></span>${price_info.minPrice}<span class="xInjPostInfo"></span></span>`;
		let change_price_code = `(function(){ 
			var el = document.querySelector('${price_selector}');
			var p = el.innerHTML.replaceAll('&nbsp;','').replace(/\s+/gi,'');
			el.innerHTML = '${content} / ' + el.innerHTML;
			return parseInt(p);
		})()`;
		const orig_price = await asyncScript(tab.id, change_price_code);
		const discount = orig_price - price_info.minPrice;
		const perc = Math.ceil(discount * 100 / orig_price);

		let add_info_code = `(function(){ 
			document.querySelector('.xInjPreInfo').innerHTML = '- ${discount}&nbsp;₴';
			document.querySelector('.xInjPostInfo').innerHTML = '- ${perc}&nbsp;%';
		})()`;
		await asyncScript(tab.id, add_info_code);

		setStage('result', true);
	}
	else {
		setStage('result', false, 'Нет другой цены');
	}
}

// init on page load
document.addEventListener('DOMContentLoaded', async () => {
	setStage(null, true);
	const is_config_ok = await checkSettings()
		.then(r => {
			setStage('settings', true);
			return r;
		})
		.catch(err => {
			console.log('config', err);
			setStage('settings', false, err);
		})
		;
	console.log('config ok?', is_config_ok);
	if (!is_config_ok) return;

	chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
		tabs.map(replacePrice);
	});
});
