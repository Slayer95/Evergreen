"use strict"

const AbilityData = new Map(require('./data/AbilityData.json'));
const UnitBalance = new Map(require('./data/UnitBalance.json'));
const UnitData = new Map(require('./data/UnitData.json'));
const UnitWeapons = new Map(require('./data/UnitWeapons.json'));
const UpgradeData = new Map(require('./data/UpgradeData.json'));
const UnitFunc = new Map(require('./data/UnitFunc.json'));

function objectCostsToSource() {
	let output = [];
	for (const [id, {goldcost, lumbercost, prev}] of UnitBalance) {
		if (goldcost) output.push(`call SaveInteger(udg_RFObjectCost, 0, '${id}', ${goldcost})`);
		if (lumbercost) output.push(`call SaveInteger(udg_RFObjectCost, 1, '${id}', ${lumbercost})`);
		if (prev) { // Delta = Upgrade cost
			output.push(`call SaveInteger(udg_RFObjectCost, 2, '${id}', ${goldcost - UnitBalance.get(prev).goldcost})`);
			output.push(`call SaveInteger(udg_RFObjectCost, 3, '${id}', ${lumbercost - UnitBalance.get(prev).lumbercost})`);
		}
	}
	for (const [id, {goldbase, goldmod, lumberbase, lumbermod}] of UpgradeData) {
		if (goldbase) output.push(`call SaveInteger(udg_RFObjectCost, 0, '${id}', ${goldbase})`);
		if (lumberbase) output.push(`call SaveInteger(udg_RFObjectCost, 1, '${id}', ${lumberbase})`);
		if (goldmod) output.push(`call SaveInteger(udg_RFObjectCost, 2, '${id}', ${goldmod})`);
		if (lumbermod) output.push(`call SaveInteger(udg_RFObjectCost, 3, '${id}', ${lumbermod})`);
	}
	return output.map((x, i) => i ? ` `.repeat(4) + x : x).join(`\r\n`);
}

function sunderingUnitsToSource() {
	let output = [];
	for (const [id, {defType}] of UnitBalance) {
		if (defType === 'medium') output.push(`call SaveInteger(udg_RFSunderingUnits, 0, '${id}', 1)`);
	}
	return output.map(x => ` `.repeat(4) + x).join(`\r\n`);
}

function meleeUnitsToSource() {
	let output = [];
	/*for (const [id, {weapsOn, rangeN1, rangeN2, targs1, targs2}] of UnitWeapons) {*/
	for (const [id, {movetp}] of UnitData) {
		if (!UnitWeapons.has(id)) {
			continue; // nmrf
		}
		if (movetp === 'foot' || movetp === 'horse' || movetp === 'hover' || movetp === 'float') {
			const {weapsOn, rangeN1, rangeN2} = UnitWeapons.get(id);
			if ((weapsOn & 1) && rangeN1 < 128 || (weapsOn & 2) && rangeN2 < 128) {
				output.push(`call SaveInteger(udg_RFMeleeUnits, 0, '${id}', 1)`);
			}
		}
	}
	return output.map((x, i) => i ? ` `.repeat(4) + x : x).join(`\r\n`);
}

function heroAbilitiesToSource() {
	let output = [];
	for (const [id, {hero}] of AbilityData) {
		if (hero) {
			output.push(`call SaveInteger(udg_RFHeroAbilities, 0, '${id}', 1)`);
		}
	}
	return output.map((x, i) => i ? ` `.repeat(4) + x : x).join(`\r\n`);
}

function unitButtonsToSource() {
	let output = [];
	for (const [id, {Art}] of UnitFunc) {
		if (Art) {
			output.push(`call SaveStringBJ(${JSON.stringify(Art)}, '${id}', 0, udg_RFUnitButtons)`);
		}
	}
	return output.map((x, i) => i ? ` `.repeat(4) + x : x).join(`\r\n`);
}

const cachedSources = new Map();
function cached(fn) {
	return function () {
		if (cachedSources.has(fn)) return cachedSources.get(fn);
		const result = fn();
		cachedSources.set(fn, result);
		return result;
	};
}

module.exports = {
	objectCostsToSource: cached(objectCostsToSource),
	sunderingUnitsToSource: cached(sunderingUnitsToSource),
	meleeUnitsToSource: cached(meleeUnitsToSource),
	heroAbilitiesToSource: cached(heroAbilitiesToSource),
	unitButtonsToSource: cached(unitButtonsToSource),
};
