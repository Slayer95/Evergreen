"use strict"

const assert = require('assert');
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

function spawnSync(...args) {
	//console.log(...args);
	return child_process.spawnSync(...args);
}

function parseWar(handler, path) {
	let result;
	try {
		result = handler.warToJson(fs.readFileSync(path));
	} catch (err) {
		throw new Error(`Internal error parsing ${path}`, {cause: err});
	}
	if (result.errors.length) throw new AggregateError(result.errors);
	return result.json;
}

function writeWar(targetPath, handler, data, modFn) {
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

function batchExtract(rootPath, mode = 'latest', rewriteFolder) {
	const mapFiles = fs.readdirSync(rootPath).filter(filename => filename.endsWith('.w3x'));
	if (!mapFiles.length) throw new Error(`No maps found in ${rootPath}`);
	for (const mapFile of mapFiles) {
		//console.log(`Extracting ${mapFile}...`);
		const outFolder = mapFile.slice(0, -4);
		delFolders([path.resolve(rootPath, outFolder)]);
		spawnSync(`MPQEditor`, [`extract`, mapFile, `*`, outFolder, `/fp`], {cwd: rootPath});
		const doodadsPath = path.resolve(rootPath, outFolder, 'war3map.doo');
		const unitsPath = path.resolve(rootPath, outFolder, 'war3mapUnits.doo');
		const doodads = parseWar(mode === 'legacy' ? DoodadsLegacy : DoodadsLatest, doodadsPath);
		const units = parseWar(mode === 'legacy' ? UnitsLegacy : UnitsLatest, unitsPath);


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

function getMapDescStrings(folder) {
	const mapInfo = parseWar(InfoLatest, path.resolve(folder, 'war3map.w3i'));
	const strings = parseWar(StringsLatest, path.resolve(folder, 'war3map.wts'));
	return MAP_DESC_STRINGS.reduce((meta, key) => {
		if (!mapInfo.map[key]) return meta;
		const index = parseInt(mapInfo.map[key].slice(8));
		meta[key] = strings[index];
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

function removeVowels(input) {
	return input.replace(/a|e|i|o|u|[^a-zA-Z0-9\.]/g, '');
}

function brandMap(baseName, version) {
	const suffix = '(1.26)';
	baseName = baseName.replace(/_v\d+(.\d+)?$/, '');
	baseName = baseName.replace(/_s\d+$/, '');
	let firstVowelMatch = baseName.match(/[aeiou]/);
	if (firstVowelMatch) {
		baseName = baseName.slice(0, firstVowelMatch.index + 1) + removeVowels(baseName.slice(firstVowelMatch.index + 1, -1)) + baseName.at(-1);
	}
	version = snake_case(version).replace(/evergreen_/i, 'evrgrn');
	return baseName + `_${version}${suffix}.w3x`
}

function delFolders(rootDirs) {
	for (const rootDir of rootDirs) {
		assert(!path.relative(process.cwd(), rootDir).startsWith('..'));
	}
	const allDirs = [];
	for (const rootDir of rootDirs) {
		const contents = fs.readdirSync(rootDir);
		for (const name of contents) {
			if (fs.statSync(path.resolve(rootDir, name)).isDirectory()) {
				rootDirs.push(path.resolve(rootDir, name));
				allDirs.push(path.resolve(rootDir, name));
			} else {
				fs.rmSync(path.resolve(rootDir, name));
			}
		}
	}
	while (allDirs.length) {
		fs.rmdirSync(allDirs.pop());
	}
}

module.exports = {
	DoodadsLegacy, InfoLegacy, UnitsLegacy, StringsLegacy,
	DoodadsLatest, InfoLatest, UnitsLatest, StringsLatest,

	spawnSync, delFolders,
	float, quote, snake_case,
	deepClone,
	parseWar, writeWar,
	batchExtract, getMapDescStrings,
	getDate,
	brandMap,

	exists, replacements, tryReplaceUnit,
};
