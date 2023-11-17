"use strict";

const fs = require('fs');
const ini = require('ini');
const path = require('path');

const output = new Map();
const fileNames = [
	'HumanUnitFunc',
	'OrcUnitFunc',
	'UndeadUnitFunc',
	'NightElfUnitFunc',
	'NeutralUnitFunc',
	'xHumanUnitFunc',
	'xOrcUnitFunc',
	'xUndeadUnitFunc',
	'xNightElfUnitFunc',
	'xNeutralUnitFunc',	
	'pNeutralUnitFunc-File00000062',
];

function main() {
	for (const fileName of fileNames) {
		const tree = ini.parse(fs.readFileSync(path.resolve(__dirname, 'data', `${fileName}.txt`), 'utf8'));
		for (const unitId in tree) {
			output.set(unitId, tree[unitId]);
		}
	}

	fs.writeFileSync(path.resolve(__dirname, 'data', 'UnitFunc.json'), JSON.stringify(Array.from(output)));
}

main()
