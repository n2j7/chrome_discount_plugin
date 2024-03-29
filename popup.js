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

async function setSettings(key, val) {
	chrome.storage.sync.set({[key]:val}, (r) => {
		console.log('Options saved', key, val, r);
	});
}

async function callDiscountApi(id) {
	let api_url = await getSettings('api_url');
	let antibot = await getSettings('antibot');
	let price_path = await getSettings('price_path');

	api_url = api_url.replace('{C}', id);
	api_url = api_url.replace('{X}', antibot);

	console.log('Fetch', api_url);
	return fetch(api_url)
		.then(r => r.json())
		.then(j => {
			if (j.errors && j.errors.length) {
				throw j.errors[0];
			}
			// get price inside json request
			let parts = price_path.split('.');
			console.log('price_path parts', parts);
			let price = j;
			parts.map(p => {
				// is this part is array index
				let array_matcher = p.match(/\[(\d+)\]/);

				if (price && array_matcher) {
					let idx = parseInt(array_matcher[1], 10);
					price = price[idx];
				}
				else if (price && price[p]) {
					price = price[p]; // go inside structure
				}
				else {
					price = false;
				}
			});

			return price;// false or float
		});
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
		document.getElementById('err').style.display = '';
	}
	if (err_msg) {
		document.getElementById('err').innerHTML = err_msg;
		document.getElementById('err').style.display = 'block';
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

const showAntibotCodeForm = (tab, product_id) => async () => {
	let antibot_url = await getSettings('antibot_img_url');

	let antibot_el = document.getElementById("antibot");
	antibot_el.innerHTML = [
		'<div>Антибот</div>',
		'<img src="', antibot_url, '" class="pic" alt="antibot"/>',
		'<div>',
			'<input type="text" id="antibot_inp" class="inp" /> ',
			'<button type="button" id="antibot_btn">OK</button>',
		'</div>',
	].join('');

	let antibot_btn = document.getElementById("antibot_btn");
	antibot_btn.addEventListener('click', async () => {
		setStage(false, false);// drop err msg
		setStage('antibot', true);
		await setSettings('antibot', document.getElementById("antibot_inp").value);
		antibot_el.innerHTML = 'Антибот';
		await pr(askPriceAndReplace(tab, product_id));
	})
}

const askPriceAndReplace = (tab, product_id) => async () => {
	// get product price from API
	const price_info = await callDiscountApi(product_id)
		.then(p => {
			console.log('price', p);
			setStage('api', true);
			return p;
		})
		.catch(err => {
			console.log('api', err);
			setSettings('antibot', null);
			setStage('api', false, err || "API сервер недоступен");
		})
		;
	// if (!price_info) return;


	// add extra styles
	chrome.tabs.insertCSS(tab.id, { file: 'xDiscountInject.css' });

	// change price
	if (price_info) {
		let price_selector = await getSettings('price_selector');
		let content = `<span id="${INJ_NODE_ID}"><span class="xInjPreInfo"></span>${price_info}<span class="xInjPostInfo"></span></span>`;
		let change_price_code = `(function(){ 
			var el = document.querySelector('${price_selector}');
			var p = el.innerHTML.replaceAll('&nbsp;','').replace(/\s+/gi,'');
			el.innerHTML = '${content} / ' + el.innerHTML;
			return parseInt(p);
		})()`;
		const orig_price = await asyncScript(tab.id, change_price_code);
		const discount = orig_price - price_info;
		const perc = Math.ceil(discount * 100 / orig_price);

		let add_info_code = `(function(){ 
			document.querySelector('.xInjPreInfo').innerHTML = '- ${discount}&nbsp;₴';
			document.querySelector('.xInjPostInfo').innerHTML = '- ${perc}&nbsp;%';
		})()`;
		await asyncScript(tab.id, add_info_code);

		setStage('result', true);
	}
	else if(price_info === false) {
		setStage('result', false, 'Нет другой цены');
	}
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

	// show API domain
	let virtuallink = document.createElement("a");
	virtuallink.href = await getSettings('api_url');
	let dom_el = document.getElementById("api");
	dom_el.innerHTML = `${dom_el.innerHTML} ${virtuallink.hostname}`;
	delete virtuallink;
	delete dom_el;

	// antibot validation
	let antibot_url = await getSettings('antibot_img_url');
	let antibot_code = await getSettings('antibot');
	console.log('Antibot', antibot_url, antibot_code);
	if (antibot_url && !antibot_code) {
		r = await pr(showAntibotCodeForm(tab, product_id));
		setStage('antibot', false, "Надо пройти проверку");
		return;
	}

	await pr(askPriceAndReplace(tab, product_id));
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
