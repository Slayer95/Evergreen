"use strict"

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const util = require('util');
const path = require('path');
const child_process = require('child_process');

const luaparse = require('luaparse');
const {
	Doodads: DoodadsLegacy,
	Info: InfoLegacy,
	Units: UnitsLegacy,
	Strings: StringsLegacy,
} = require('wc3maptranslator');

const {
	DoodadsTranslator: DoodadsLatest,
	InfoTranslator: InfoLatest,
	UnitsTranslator: UnitsLatest,
	StringsTranslator: StringsLatest,
} = require('wcrmaptranslator');

const {
	MAP_DESC_STRINGS,
	PROTO_FILE_PATH,
} = require('./shared');

const DataExists = {
	Doodads: new Set((fs.readFileSync('./data/Doodads.txt', 'utf8') + '\n' + fs.readFileSync('./data/Destructables.txt', 'utf8')).split(/\r?\n/).map(x => x.trim()).filter(x => x)),
	Items: new Set(fs.readFileSync('./data/Items.txt', 'utf8').split(/\r?\n/).map(x => x.trim()).filter(x => x)),
	Units: new Set(fs.readFileSync('./data/Units.txt', 'utf8').split(/\r?\n/).map(x => x.trim()).filter(x => x)),
};

const replacements = {
	Doodads: {
		__proto__: null,
		// Northrend Icy Tree Wall -> Pared de árbol nevada
		'NTiw': 'WTst',

		// Tulips -> Flowers
		'ZPf0': 'ZPfw',

		// Trozos de Roca (250 HP) -> Barricada (50 HP)
		'LTrt': 'LTba',

		// Blocks Ruined -> Broken column
		'ASHB': 'ASbc',

		// Rock Spires (Cinematic) -> 4x Rock Spires Small (BRsp) ?
		//'BRrc': ,

		// Silvermoon Wall T
		//'SWt0': ,

		// Volcano
		// 'Volc': ,

		// Wall 90 Degree
		// 'WD00':
	},
	Units: {
		__proto__: null,
		'nech': 'ndog', // Chicken -> Dog
		'necr': 'npig', // Rabbit -> Pig
		'nfro': 'ncrb', // Frog -> Crab
		'nrac': 'nder', // Racoon -> Deer
	},
};

function float(num) {
	if (num !== Math.floor(num)) return `${num}`;
	return `${num}.0`;
}

function quote(content) {
	return `"${content}"`;
}

function snake_case(text) {
	return text.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

function hashStringAsColor(input, isHex) {
	if (!isHex) {
		input = crypto.createHash('md5').update(input).digest('hex');
	}
	// MIT License (c) Guangcong Luo
	let H = parseInt(input.substr(4, 4), 16) % 360; // 0 to 360
	let S = parseInt(input.substr(0, 4), 16) % 50 + 40; // 40 to 89
	let L = Math.floor(parseInt(input.substr(8, 4), 16) % 20 + 30); // 30 to 49

	const C = (100 - Math.abs(2 * L - 100)) * S / 100 / 100;
	const X = C * (1 - Math.abs((H / 60) % 2 - 1));
	const m = L / 100 - C / 2;

	let R1, G1, B1;
	switch (Math.floor(H / 60)) {
	case 1: R1 = X; G1 = C; B1 = 0; break;
	case 2: R1 = 0; G1 = C; B1 = X; break;
	case 3: R1 = 0; G1 = X; B1 = C; break;
	case 4: R1 = X; G1 = 0; B1 = C; break;
	case 5: R1 = C; G1 = 0; B1 = X; break;
	case 0: default: R1 = C; G1 = X; B1 = 0; break;
	}
	const lum = (R1 + m) * 0.2126 + (G1 + m) * 0.7152 + (B1 + m) * 0.0722; // 0.05 (dark blue) to 0.93 (yellow)

	let HLmod = (lum - 0.5) * -100; // -43 (yellow) to 45 (dark blue)
	if (HLmod > 12) {
		HLmod -= 12;
	} else if (HLmod < -10) {
		HLmod = (HLmod + 10) * 2 / 3;
	} else {
		HLmod = 0;
	}

	L += HLmod;

	let Smod = 10 - Math.abs(50 - L);
	if (HLmod > 15) Smod += (HLmod - 15) / 2;
	S -= Smod;

	return [H, S, L]; // 360º, 100%, 100%
}

function hue2rgb(p, q, t) {
	if (t < 0) t += 1;
	if (t > 1) t -= 1;
	if (t < 1 / 6) return p + (q - p) * 6 * t;
	if (t < 1 / 2) return q;
	if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
	return p;
}

function hslToRgb(h, s, l) { // input normalized to 1
	let RGB = [];
	if (s === 0) {
		RGB = [l, l, l];
	} else {
		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		for (let i = 0; i < 3; i++) {
			RGB[i] = hue2rgb(p, q, h + (1 - i) / 3);
		}
	}

	return RGB.map(num => Math.round(num * 255).toString(16).padStart(2, '0').toUpperCase());
}

function coloredString(input, isHex) {
	const hslValues = hashStringAsColor(input, isHex);
	const hexCode = 'ff' + hslToRgb(hslValues[0] / 360, hslValues[1] / 100, hslValues[2] / 100).join('');
	return `|c${hexCode}${input}|r`;
}

function coloredShortHash(input) {
	const hslValues = hashStringAsColor(input, true);
	const hexCode = 'ff' + hslToRgb(hslValues[0] / 360, hslValues[1] / 100, hslValues[2] / 100).join('');
	return `|c${hexCode}${input.slice(0, 8)}|r`;
}

function coloredHash(input) {
	return coloredString(input, true);
}

function getAltSourceFolder(folder) {
	const triedFolder = path.basename(folder);
	if (triedFolder.includes('-auto')) {
		return path.resolve(folder, '..', triedFolder.replace('-auto', ''));
	} else {
		return path.resolve(folder, '..', triedFolder.replace('-maps', '-maps-auto'));
	}
}

function exists(type, code) {
	switch (type) {
	case 'doodad': return DataExists.Doodads.has(code);
	case 'item': return DataExists.Items.has(code);
	case 'unit': return code === 'sloc' || code === 'bDNR' || DataExists.Units.has(code);
	default: throw new Error(`Unhandled data type ${type}.`);
	}
}

function tryReplaceUnit(code) {
	if (!exists('unit', code)) {
		if (code in replacements.Units) {
			//console.log(`[tryReplaceUnit] ${code}->${replacements.Units[code]}.`);
			return replacements.Units[code];
		} else {
			console.log(`[tryReplaceUnit] ${code} not found.`);
		}
	}
	return code;
}

const logged = new Set();
function logOnce(str) {
	if (logged.has(str)) return;
	logged.add(str);
	console.log(str);
}

function dooValidator(fn, arg, invalidTypes) {
	let logger = function (type, item) {
		let result = fn(type, item.type);
		if (!result) {
			const alternatives = type === 'doodad' ? Array.from(DataExists.Doodads).filter(x => x[1] === item.type[1] && x[3] === item.type[3]).join(', ') : ``;
			logOnce(`Invalid .doo entry: ${type}:${item.type}. Suggestions: ${alternatives || 'None'}.`);
			invalidTypes.add(item.type);
		}
		return result;
	};
	return logger.bind(null, arg);
}

function deepClone(value) {
	if (!value || typeof value === 'function' || typeof value === 'symbol') return value;
	if (Array.isArray(value)) return value.map(deepClone);
	if (typeof value === 'object') {
		let result = Object.create(Object.getPrototypeOf(value));
		for (let [key, val] of Object.entries(value)) {
			result[key] = deepClone(val);
		}
		return result;
	}
	return value;
}

function execSync(...args) {
	//console.log(...args);
	return child_process.execSync(...args);
}

function spawnSync(...args) {
	//console.log(...args);
	return child_process.spawnSync(...args);
}

function parseWar(handler, path) {
	let result;
	try {
		result = handler.warToJson(fs.readFileSync(path));
	} catch (err) {
		throw new Error(`Error parsing ${path}`, {cause: err});
	}
	if (result.errors.length) throw new AggregateError(result.errors);
	return result.json;
}

function writeWar(targetPath, handler, data, modFn) {
	//console.log(`[writeWar] ${targetPath}`);
	let result;
	try {
		result = handler.jsonToWar(data);
	} catch (err) {
		throw new Error(`Internal error writing ${targetPath}`, {cause: err});
	}
	if (result.errors.length) throw new AggregateError(result.errors);
	if (modFn) modFn(result.buffer);
	try {
		fs.writeFileSync(targetPath, result.buffer);
	} catch (err) {
		if (err.code === 'ENOENT') {
			fs.mkdirSync(path.dirname(targetPath), {recursive: true});
		}
		fs.writeFileSync(targetPath, result.buffer);
	}
}

function isMapFileName(fileName) {
	return fileName.endsWith('.w3x') && !fileName.endsWith('_slk.w3x');
}

function copyFileSync(from, to) {
	return fs.writeFileSync(to, fs.readFileSync(from));
}

function batchExtract(rootPath) {
	//console.log(`[batchExtract] ${rootPath}`);
	const mapFiles = fs.readdirSync(rootPath).filter(isMapFileName);
	if (!mapFiles.length) throw new Error(`No maps found in ${rootPath}`);
	for (const mapFile of mapFiles) {
		//console.log(`Extracting ${mapFile}...`);
		const outFolder = mapFile.slice(0, -4);
		try {
			fs.mkdirSync(path.resolve(rootPath, outFolder));
		} catch (err) {
			if (err.code !== 'EEXIST') throw err;
		}
		delFolders([path.resolve(rootPath, outFolder)]);
		spawnSync(`MPQEditor`, [`extract`, mapFile, `*`, outFolder, `/fp`], {cwd: rootPath});
	}
}

function batchAdapt(rootPath, mode = 'latest', rewriteFolder, allowFallback = true) {
	//console.log(`[batchAdapt-${mode}] ${rootPath}->${rewriteFolder}`);
	const mapFiles = fs.readdirSync(rootPath).filter(isMapFileName);
	if (!mapFiles.length) throw new Error(`No maps found in ${rootPath}`);
	for (const mapFile of mapFiles) {
		const outFolder = mapFile.slice(0, -4);
		const doodadsPath = path.resolve(rootPath, outFolder, 'war3map.doo');
		const unitsPath = path.resolve(rootPath, outFolder, 'war3mapUnits.doo');
		let doodads;
		try {
			/*if (mapFile === '(4)dejavu_s2_v1.5.w3x') throw new Error(`Deja Vu bad locale.`);*/
			doodads = parseWar(mode === 'legacy' ? DoodadsLegacy : DoodadsLatest, doodadsPath);
		} catch (err) {
			if (!allowFallback) throw err;
			console.error(err.stack);
			const fbPath = path.resolve(getAltSourceFolder(rootPath), outFolder, 'war3map.doo');
			console.error(`File does not meet ${mode} spec: ${doodadsPath}`);
			console.error(`Falling back to ${mode === 'latest' ? 'legacy' : 'latest'}: ${fbPath}\n`);
			/*spawnSync(`MPQEditor`, [`extract`, mapFile, `*`, outFolder, `/fp`], {cwd: path.basename(rootPath).replace('-auto', '')});*/
			doodads = parseWar(mode === 'legacy' ? DoodadsLatest : DoodadsLegacy, fbPath);
		}
		let units;
		try {
			units = parseWar(mode === 'legacy' ? UnitsLegacy : UnitsLatest, unitsPath);
		} catch (err) {
			if (!allowFallback) throw err;
			console.error(err.stack);
			const fbPath = path.resolve(getAltSourceFolder(rootPath), outFolder, 'war3mapUnits.doo');
			console.error(`File does not meet ${mode} spec: ${unitsPath}`);
			console.error(`Falling back to ${mode === 'latest' ? 'legacy' : 'latest'}: ${fbPath}\n`);
			/*spawnSync(`MPQEditor`, [`extract`, mapFile, `*`, outFolder, `/fp`], {cwd: path.basename(rootPath).replace('-auto', '')});*/
			units = parseWar(mode === 'legacy' ? UnitsLatest : UnitsLegacy, fbPath);
		}

		for (const doodad of doodads) {
			if (doodad.type in replacements.Doodads) {
				doodad.type = replacements.Doodads[doodad.type];
				doodad.skinId = doodad.type;
			}
		}
		for (const unit of units) {
			if (unit.player > 23) unit.player -= 12;
			if (unit.type in replacements.Units) {
				unit.type = replacements.Units[unit.type];
			}
		}

		const invalidDoodadTypes = new Set();
		const invalidUnitTypes = new Set();
		const validDoodads = doodads.filter(dooValidator(exists, 'doodad', invalidDoodadTypes));
		const validUnits = units.filter(dooValidator(exists, 'unit', invalidUnitTypes));
		if (validDoodads.length !== doodads.length) {
			console.log(`${doodads.length - validDoodads.length} doodads(${Array.from(invalidDoodadTypes).sort()}) deleted from ${mapFile}`);
		}
		if (validUnits.length !== units.length) {
			console.log(`${units.length - validUnits.length} units(${Array.from(invalidUnitTypes).sort()})  deleted from ${mapFile}`);
		}
		const outDoodadsPath = path.resolve(rewriteFolder, outFolder, 'war3map.doo');
		const outUnitsPath = path.resolve(rewriteFolder, outFolder, 'war3mapUnits.doo');
		writeWar(outDoodadsPath, DoodadsLegacy, validDoodads);
		writeWar(outUnitsPath, UnitsLegacy, validUnits);
	}
}

function getMapInfo(folder, allowFallback = true) {
	let mapInfo;
	try {
		mapInfo = parseWar(InfoLatest, path.resolve(folder, 'war3map.w3i'));
	} catch (err) {
		if (!allowFallback) throw err
		console.error(err.stack);
		mapInfo = parseWar(InfoLegacy, path.resolve(getAltSourceFolder(path.dirname(folder)), path.basename(folder), 'war3map.w3i'));
		console.error('Fallback OK');
	}
	return mapInfo;
}

function getMapDescStrings(folder, allowFallback = true) {
	let mapInfo;
	let strings;
	try {
		mapInfo = parseWar(InfoLatest, path.resolve(folder, 'war3map.w3i'));
	} catch (err) {
		if (!allowFallback) throw err;
		mapInfo = parseWar(InfoLegacy, path.resolve(getAltSourceFolder(path.dirname(folder)), path.basename(folder), 'war3map.w3i'));
		console.error('Fallback OK');
	}
	try {
		strings = parseWar(StringsLatest, path.resolve(folder, 'war3map.wts'));
	} catch (err) {
		if (!allowFallback) throw err;
		console.error(err.stack);
		strings = parseWar(StringsLegacy, path.resolve(getAltSourceFolder(path.dirname(folder)), path.basename(folder), 'war3map.wts'));
		console.error('Fallback OK');
	}
	return MAP_DESC_STRINGS.reduce((meta, key) => {
		if (!mapInfo.map[key]) return meta;
		const index = parseInt(mapInfo.map[key].slice(8));
		meta[key] = strings[index].normalize('NFD').replace(/[^\x00-\xFF]/g, '');
		return meta;
	}, {});
}

function getDate() {
	const date = new Date();
	return new Intl.DateTimeFormat('en-US', {
		timeZone: 'UTC',
		hour12: false,
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).format(date).replace(/at|,|/g, '') + ` ${date.getUTCFullYear()}`;
	return date.toString();
}

function getMapHash(filePath) {
	const fileContents = fs.readFileSync(filePath);
	return crypto.createHash('sha256').update(fileContents).digest('hex');
}

function qHasCachedProto() {
	const dirpath = path.dirname(PROTO_FILE_PATH);
	try {
		return getMapHash(PROTO_FILE_PATH) === fs.readFileSync(path.resolve(dirpath, 'checksum.txt'), 'utf8');
	} catch (err) {
		if (err.code === 'ENOENT') return false;
		throw err;
	}
}

function getChecksum(folder) {
  try {
    return fs.readFileSync(path.resolve(folder, 'checksum.txt'), 'utf8').trim();
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw err;
  }
}

function cacheProtoHash() {
	const dirpath = path.dirname(PROTO_FILE_PATH);
	return fs.writeFileSync(path.resolve(dirpath, 'checksum.txt'), getMapHash(PROTO_FILE_PATH));
}

function getAMAIVersion() {
	const amaiBinPath = execSync(`where MakeTFT`).toString('utf8').trim();
	const amaiFolder = path.dirname(amaiBinPath);
	const localBranch = execSync(`git rev-parse --abbrev-ref head`, {cwd: amaiFolder}).toString('utf8').trim();
	const localCommit = execSync(`git rev-parse head`, {cwd: amaiFolder}).toString('utf8').trim();
	if (localCommit !== getChecksum(amaiFolder)) {
		const amaiResult = spawnSync(`MakeTFT.bat`, {stdio: 'inherit', cwd: amaiFolder});
		assert.strictEqual(localCommit, getChecksum(amaiFolder));
		spawnSync(`MakeOptTFT.bat`, {stdio: 'inherit', cwd: amaiFolder});
		assert.strictEqual(localCommit, getChecksum(amaiFolder));
	}
	const refToPublicCommit = localBranch === 'tree-refactor' ? `official` : `2.6.x-zh~3`;
	const upstreamVersion = execSync(`git rev-parse ${refToPublicCommit}`, {cwd: amaiFolder}).toString('utf8').trim();
	return {
		branch: localBranch,
		brand: localBranch === 'tree-refactor' || localBranch.startsWith('3.3.x') ? '|cffffcc003.3.0|r' : '|cffffcc002.6.2|r',
		private: localCommit,
		public: upstreamVersion,
	};
}

let cachedExtraListFiles = undefined;
function getSlkExtraListFiles() {
	if (cachedExtraListFiles !== undefined) return cachedExtraListFiles;
	cachedExtraListFiles = fs.readFileSync(path.resolve(__dirname, 'listfile_slk.txt'), 'utf8');
	return cachedExtraListFiles;
}

function removeVowels(input) {
	return input.replace(/a|e|i|o|u|[^a-zA-Z0-9\.]/g, '');
}

function brandMap(baseName, version, suffix = '(1.26)') {
	baseName = baseName.replace(/_v\d+(.\d+)?$/, '');
	baseName = baseName.replace(/_s\d+$/, '');
	let firstVowelMatch = baseName.match(/[aeiou]/);
	if (firstVowelMatch) {
		baseName = baseName.slice(0, firstVowelMatch.index + 1) + removeVowels(baseName.slice(firstVowelMatch.index + 1, -1)) + baseName.at(-1);
	}
	version = snake_case(version).replace(/evergreen_/i, 'evrgrn');
	return baseName + `_${version}${suffix}.w3x`
}

function delFolders(rootDirs, options = {}) {
	//console.log(`[delFolders] ${rootDirs}`);
	if (!options.allowOutside) {
		for (const rootDir of rootDirs) {
			assert(!path.relative(process.cwd(), rootDir).startsWith('..'));
		}
	}
	const allDirs = [];
	for (const rootDir of rootDirs) {
		let contents;
		try {
			contents = fs.readdirSync(rootDir);
		} catch (err) {
			if (err.code === 'ENOENT') continue;
		}
		for (const name of contents) {
			if (fs.statSync(path.resolve(rootDir, name)).isDirectory()) {
				rootDirs.push(path.resolve(rootDir, name));
				allDirs.push(path.resolve(rootDir, name));
			} else {
				try {
					fs.unlinkSync(path.resolve(rootDir, name));
				} catch (err) {
					return false;
				}
			}
		}
	}
	return true;
}

module.exports = {
	DoodadsLegacy, InfoLegacy, UnitsLegacy, StringsLegacy,
	DoodadsLatest, InfoLatest, UnitsLatest, StringsLatest,

	spawnSync, delFolders,
	float, quote, snake_case,
	deepClone,
	logOnce,
	parseWar, writeWar, isMapFileName,
	batchExtract, batchAdapt,
	getMapInfo, getMapDescStrings,
	getDate, getAMAIVersion,
	getSlkExtraListFiles,
	brandMap, coloredHash, coloredShortHash, coloredString,
	getMapHash, qHasCachedProto, cacheProtoHash,

	exists, replacements, tryReplaceUnit,
	copyFileSync,
};
