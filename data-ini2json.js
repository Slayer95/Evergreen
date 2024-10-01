"use strict";

const fs = require('fs');
const ini = require('ini');
const path = require('path');

const {
  dataDir,
} = require('./shared');

const output = new Map();
const processes = {
  'UnitFunc': [
    // War3.mpq
    'HumanUnitFunc',
    'OrcUnitFunc',
    'UndeadUnitFunc',
    'NightElfUnitFunc',
    'NeutralUnitFunc',
    // War3x.mpq
    'xHumanUnitFunc',
    'xOrcUnitFunc',
    'xUndeadUnitFunc',
    'xNightElfUnitFunc',
    'xNeutralUnitFunc',	
    // War3patch.mpq (1.26a)
    'pNeutralUnitFunc',
  ],
  'UnitStrings': [
    'qcampaignabilitystrings',
    'qcampaignunitstrings',
    'qcampaignupgradestrings',
    'qcommonabilitystrings',
    'qhumanabilitystrings',
    'qhumanunitstrings',
    'qhumanupgradestrings',
    'qitemabilitystrings',
    'qitemstrings',
    'qneutralabilitystrings',
    'qneutralunitstrings',
    'qneutralupgradestrings',
    'qnightelfabilitystrings',
    'qnightelfunitstrings',
    'qnightelfupgradestrings',
    'qorcabilitystrings',
    'qorcunitstrings',
    'qorcupgradestrings',
    'qundeadabilitystrings',
    'qundeadunitstrings',
    'qundeadupgradestrings',
  ],
};

async function run() {
	for (const outName in processes) {
		for (const fileName of processes[outName]) {
		  const tree = ini.parse(fs.readFileSync(path.resolve(dataDir, `${fileName}.txt`), 'utf8'));
		  for (const unitId in tree) {
			output.set(unitId, tree[unitId]);
		  }
		}
		fs.writeFileSync(path.resolve(dataDir, `${outName}.json`), JSON.stringify(Array.from(output)));
	}
	console.log(`DONE`);
}

module.exports = {
  run,
};

