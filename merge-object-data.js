"use strict"

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const util = require('util');
const path = require('path');
const child_process = require('child_process');
const CsvReadableStream = require('csv-reader');
const {pipeline} = require('stream/promises');
const {Transform} = require('stream');

const {
	dataDir,
} = require('./shared');

const outPath = path.resolve(__dirname, 'costs.json');
const ID_KEYS = new Map([
	['AbilityData', 'alias'],
	['DestructableData', 'DestructableID'],
	['Doodads', 'doodID'],
	['ItemData', 'itemID'],
	['UnitBalance', 'unitBalanceID'],
	['UnitData', 'unitID'],
	//UnitFunc handled by data-ini2json
	['UnitWeapons', 'unitWeapID'],
	['UpgradeData', 'upgradeid'],
].map(tuple => [tuple[0].toLowerCase(), tuple[1]]));

const SPECIAL_VALUES = new Map([
	['SYLK_TRUE', true],
	['SYLK_FALSE', false],
	['SYLK_#VALUE!', null],
]);

const FROM_UPGRADES = new Map([
	['hkee', 'htow'],
	['hcas', 'hkee'],
	['hgtw', 'hwtw'],
	['hctw', 'hwtw'],
	['hatw', 'hwtw'],
	['ostr', 'ogre'],
	['ofrt', 'ostr'],
	['unp1', 'unpl'],
	['unp2', 'unp1'],
	['uzg1', 'uzig'],
	['uzg2', 'uzig'],
	['etoa', 'etol'],
	['etoe', 'etoa'],
]);

function readCsv(filePath) {
	const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
}

async function getConsolidatedOfType(type) {
	// war3.mpq, war3x.mpq, war3Patch.mpq, prototype.w3x
	const files = [`${type}.csv`, `x${type}.csv`, `p${type}.csv`, `q${type}.csv`];
	const merged = new Map();
	const idKey = ID_KEYS.get(type);
	for (const fileName of files) {
		if (!fs.existsSync(path.resolve(dataDir, fileName))) continue;
		await new Promise((resolve, reject) => {
			fs.createReadStream(path.resolve(dataDir, fileName), 'utf8')
			.pipe(new CsvReadableStream({asObject: true, parseNumbers: true}))
			.on('data', (entry) => {
				if (!(idKey in entry)) throw new Error(`Malformed entry "${JSON.stringify(entry)}"`);
				const id = entry[idKey];
				if (!merged.has(id)) merged.set(id, {});
				for (const key in entry) {
					if (typeof entry[key] === 'string') {
						if (entry[key].trim()) merged.get(id)[key] = entry[key];
					} else {
						merged.get(id)[key] = entry[key];
					}
				}
			})
			.on('end', resolve)
			.on('error', reject);
		});
	}
	for (const [id, entry] of merged) {
		for (const [key, value] of Object.entries(entry)) {
			if (SPECIAL_VALUES.has(value)) {
				entry[key] = SPECIAL_VALUES.get(value);
			}
		}
		if (FROM_UPGRADES.has(id)) entry.prev = FROM_UPGRADES.get(id);
	}
	return merged;
}

async function run() {
	const types = new Set(
		fs.readdirSync(dataDir)
		.filter(name => name.charAt(0) != 'p' && name.charAt(0) != 'q' && name.charAt(0) != 'x')
		.map(name => name.slice(0, -path.extname(name).length).toLowerCase())
	);
	for (const type of types) {
		if (!ID_KEYS.has(type)) {
			console.log(`Skipping unhandled ${type}...`);
			continue;
		}
		console.log(`Merging ${type}...`);
		const consolidated = await getConsolidatedOfType(type);
		fs.writeFileSync(path.resolve(dataDir, `${type}.json`), JSON.stringify(Array.from(consolidated)));
	}
}

module.exports = {
	run,
};
