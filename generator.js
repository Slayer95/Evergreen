"use strict"

const {LUA_SOURCE} = require('./shared');
const {exists, tryReplaceUnit, float, quote, coloredHash} = require('./lib');
const {objectCostsToSource, sunderingUnitsToSource, heroAbilitiesToSource, unitButtonsToSource} = require('./flag-definitions');

const invalidPatterns = [
	/GetConvertedPlayerId\(([a-zA-Z0-9_ \(\)]+)\) \+ 1/g,
]

function lua2jass(node, source) {
	const lines = source.split(/\r?\n/);
	lines[0] = `${lines[0].slice(0, -2)} takes nothing returns nothing`;
	let indentLevel = 1;
	for (let i = 1; i < lines.length - 1; i++) {
		let trimmed = lines[i].trim();
		if (!trimmed || trimmed.startsWith(`//`)) continue;
		if (trimmed === 'end') {
			indentLevel--;
			lines[i] = ' '.repeat(4 * indentLevel) + 'endif';
			continue;
		} else if (trimmed === 'else') {
			lines[i] = ' '.repeat(4 * (indentLevel - 1)) + 'else';
			continue;
		}
		
		if (trimmed.startsWith('local ')) {
			const initValue = /= (.*)$/.exec(trimmed)
			const initString = initValue ? ' ' + initValue[0] : '';
			const identifier = trimmed.slice(6).split(' ')[0];
			let type = '';

			switch (identifier) {
			case 'p':
				type = 'player';
				break;
			case 'u':
			case 'trigUnit':
				type = 'unit';
				break;
			case 'unitID':
			case 'itemID':
				type = 'integer';
				break;
			case 't':
				type = 'trigger';
				break;
			case 'we':
				type = 'weathereffect';
				break;
			case 'life':
				type = 'real';
				break;
			case 'trigWidget':
				type = 'widget';
				break;
			case 'canDrop':
				type = 'boolean';
				break;
			default:
				throw new Error(`Unknown type for identifier ${identifier}.`);
			}
			if (type) {
				lines[i] = ' '.repeat(4 * indentLevel) + `local ${type} ${identifier}${initString}`;
			}
		} else if (trimmed.startsWith('if ')) {
			lines[i] = ' '.repeat(4 * indentLevel) + lines[i];
			indentLevel++;
		} else if (lines[i].includes('=')) {
			lines[i] = ' '.repeat(4 * indentLevel) + 'set ' + lines[i];
			lines[i] = lines[i].replace(/= ([a-zA-Z0-9_]+)\((?=[^\s])/, '= $1( ');
			lines[i] = lines[i].replace(/(?<=[^\s])\)$/, ' )');
			lines[i] = lines[i].replace(/\( \)$/, '(  )');
		} else {
			lines[i] = ' '.repeat(4 * indentLevel) + 'call ' + lines[i];
			lines[i] = lines[i].replace(/call ([a-zA-Z0-9_]+)\((?=[^\s])/, 'call $1( ');
			lines[i] = lines[i].replace(/(?<=[^\s])\)$/, ' )');
			lines[i] = lines[i].replace(/\( \)$/, '(  )');
		}
		if (lines[i].includes('BlzCreateUnitWithSkin')) {
			lines[i] = lines[i].replace('BlzCreateUnitWithSkin', 'CreateUnit');
			lines[i] = lines[i].replace(/, ([a-zA-Z0-9_]+|FourCC\("[^"]+"\))\s?\)/, ' )');
		}
		lines[i] = lines[i].replace(/FourCC\("([^"]+)"\)/g, `'$1'`);
		if (lines[i].includes('SetEnemyStartLocPrio(') || lines[i].includes('SetEnemyStartLocPrioCount(')) {
			lines[i] = '';
		}
		lines[i] = lines[i].replaceAll(/CreateUnit\( p, '([a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9][a-zA-Z0-9])'/g, (match, code) => `CreateUnit( p, '${tryReplaceUnit(code)}'`);
		lines[i] = lines[i].replace(/, (Unit|ItemTable)(\d+_DropItems)/g, ', function $1$2');
		lines[i] = lines[i].replace(/~=/g, '!=');
		lines[i] = lines[i].replace(/\bnil\b/g, 'null');
		// TODO: RandomDistAddItem(), check next
		// (unitID|itemID) = RandomDistChoose(  )
	}
	lines[lines.length - 1] = `endfunction`;
	return lines.join('\r\n');
}

function downgradeJass(source) {
	source = source.replace(/BlzCreateUnitWithSkin\(([^\n]+),\s*'[^']+'\s*\)/g, 'CreateUnit($1)');
	return source;
}

function insertInSection(source, header, functions) {
	if (!Array.isArray(functions)) functions = [functions];
	functions = functions.filter(x => x);
	if (!functions.length) return source;
	let headerIndex = source.indexOf(`//*  ${header}`);
	let nlIndex1 = source.indexOf(`\n`, headerIndex);
	let nlIndex2 = source.indexOf(`\n`, nlIndex1 + 1);
	let nlIndex3 = source.indexOf(`\n`, nlIndex2 + 1);
	let fnSources = functions.map(fn => fn.hasOwnProperty(LUA_SOURCE) ? lua2jass(fn, fn[LUA_SOURCE]) : downgradeJass(fn.source));
	fnSources.push('');
	return source.slice(0, nlIndex3 + 1) + `\r\n` + fnSources.join(`\r\n`) + source.slice(nlIndex3 + 1);
}

function insertMeta(jassCode, meleeMeta, evergreenMeta) {
	const {hash: meleeHash, editorVersion: meleeEditorVersion, texts: meleeTexts} = meleeMeta;
	const {author, date, generator, version, AMAIVersion} = evergreenMeta;
	const questMapCreditsText = `|cffffcc00${meleeTexts.name}|r is a map made by |cffffcc00${meleeTexts.author}|r.`
	jassCode = jassCode.replace(/(set udg_MetaTextQuestCredits\[1\] = )"[^"]+"/, `$1"${questMapCreditsText}"`);
	jassCode = jassCode.replace(/(set udg_MetaTextQuestCredits\[2\] = )"[^"]+"/, `$1"|cff32cd32Project Evergreen|r |cffffcc00v${version.split(' ').at(-1)}|r includes:"`);
	jassCode = jassCode.replace(/(set udg_MetaTextQuestCredits\[9\] = )"[^"]+"/, `$1"|cffffcc00${meleeTexts.name}|r's (WorldEdit version |cffffcc00${meleeEditorVersion}|r) hash (|cff4682b4sha256|r):"`);
	jassCode = jassCode.replace(/(set udg_MetaTextQuestCredits\[10\] = )"[^"]+"/, `$1"${coloredHash(meleeHash)}"`);
	jassCode = jassCode.replace(/(set udg_MetaTextQuestCredits\[13\] = )"[^"]+"/, `$1"${evergreenMeta.AMAIVersion}"`);

	/* JASS metadata */
	jassCode = jassCode.replace(/\/\/ ([\w][^\r\n]+?)(?=\r?\n)/, `// ${meleeTexts.name} ${version} (for 1.26)`);
	jassCode = jassCode.replace(/Generated by [^\n]+/, `Generated by ${generator}`);
	jassCode = jassCode.replace(/Date: [^\n]+/, `Date: ${date}`);
	jassCode = jassCode.replace(/Map Author: [^\n]+/, `Map Author: ${author}`);

	/* Hashtables */
	jassCode = jassCode.replace(/\/\/ BEGIN udg_RFObjectCost(.*)\/\/ END udg_RFObjectCost/s, objectCostsToSource());
	jassCode = jassCode.replace(/\/\/ BEGIN udg_RFSunderingUnits(.*)\/\/ END udg_RFSunderingUnits/s, sunderingUnitsToSource());
	/*jassCode = jassCode.replace(/\/\/ BEGIN udg_RFMeleeUnits(.*)\/\/ END udg_RFMeleeUnits/s, meleeUnitsToSource());*/
	jassCode = jassCode.replace(/\/\/ BEGIN udg_RFHeroAbilities(.*)\/\/ END udg_RFHeroAbilities/s, heroAbilitiesToSource());
	jassCode = jassCode.replace(/\/\/ BEGIN udg_RFUnitButtons(.*)\/\/ END udg_RFUnitButtons/s, unitButtonsToSource());
	return jassCode;
}

function lintJass(jassCode) {
	for (const re of invalidPatterns) {
		const match = re.exec(jassCode);
		if (match) {
			throw new Error(`Invalid code ${match[0]}.`, {cause: new Error(`Regexp matched ${re}`)});
		}
	}
	jassCode = jassCode.replace(/\( GetConvertedPlayerId\(([a-zA-Z0-9_ \(\)]+)\) \- 1 \)/g, `( GetPlayerId($1) )`),
	jassCode = jassCode.replace(/GetPlayerName\([^\n]+\) == "WorldEdit"/g, `false`);

	let codeCoordinate = 0;
	let multiBoardRegex = /call MultiboardSetItemValueBJ\( *([^,]+) *, *([^,]+) *, *([^,]+) *, *([^\n]+)\)\r?\n/g;
	let jassCode2 = jassCode.replace(multiBoardRegex, (match, $1, $2, $3, $4) => {
		codeCoordinate++;
		return `if ${$3} == 0 then
		call DisplayTimedTextToForce( GetPlayersAll(), 300.00, "Replaced entire column " + (I2S(${$2}) + " at ${codeCoordinate}."))
endif
${match}
`;
	});
	if (jassCode === jassCode2) throw new Error(`Replace invalid`);
	jassCode = jassCode2;

	/*
	jassCode = jassCode.replace(/(call RemoveLocation\(udg_RH[^\)]+\))/g, `// $1`);
	jassCode = jassCode.replace(/(call RemoveLocation\(udg_RF[^\)]+\))/g, `// $1`);
	jassCode = jassCode.replace(/(set udg_AI[^=]+=\s*null)/g, `// $1`);
	//jassCode = jassCode.replace(/(set udg_RF[^=]+=\s*null)/g, `// $1`);
	//jassCode = jassCode.replace(/(set udg_RH[^=]+=\s*null)/g, `// $1`);
	jassCode = jassCode.replace(/(set udg_RH(?:HumansInGame|Observers|AllUnits)\s*=\s*null)/g, `// $1`);
	jassCode = jassCode.replace(/(call DestroyGroup[^\n]+)/g, `// $1`);
	jassCode = jassCode.replace(/(set bj_wantDestroyGroup = true)/g, `// $1`);
	*/

	return jassCode;
}

function mergeMain(mergedCode, main) {
	mergedCode = mergedCode.replace(/call SetCameraBounds([^\r\n]+?)(?=\r?\n)/, `call SetCameraBounds(${main.camera.join(', ')})`);
	mergedCode = mergedCode.replace(/call SetDayNightModels([^\r\n]+?)(?=\r?\n)/, `call SetDayNightModels(${main.dayNightModels.join(', ')})`);
	mergedCode = mergedCode.replace(/call SetAmbientDaySound\([^\)]+\)/, `call SetAmbientDaySound(${main.daySound})`);
	mergedCode = mergedCode.replace(/call SetAmbientNightSound\([^\)]+\)/, `call SetAmbientNightSound(${main.nightSound})`);
	if (main.regions.length) {
		mergedCode = mergedCode.replace(/(\s*)call CreateAllUnits/, `$1call CreateRegions(  )\r\n$1call CreateAllUnits`);
	}
	return mergedCode;
}

function mergeConfig(mergedCode, config) {
	const {playerCount, teamCount, startLocations, playerSlots} = config;
	const startLocationsSrc = startLocations.map(([x, y], i) => `    call DefineStartLocation( ${i}, ${float(x)}, ${float(y)} )`).join(`\r\n`) + `\r\n`;
	const playerSlotsSrc = playerSlots.map((controller, i) => `    call SetPlayerSlotAvailable( Player(${i}), ${controller} )`).join(`\r\n`) + `\r\n`;

	mergedCode = mergedCode.replace(/(?<=\n)(\s+?)call SetPlayers\(\s*\d+\s*\)/, `$1call SetPlayers( ${playerCount} )`);
	mergedCode = mergedCode.replace(/(?<=\n)(\s+?)call SetTeams\(\s*\d+\s*\)/, `$1call SetTeams( ${teamCount} )`);
	mergedCode = mergedCode.replace(/(?<=\n)\s+call DefineStartLocation\([^\)]+\)[^\n]+?\n/g, ``);
	mergedCode = mergedCode.replace(/(?<=\n)\s+call SetPlayerSlotAvailable\(\s*Player\(\d+\), [^\)]+\)[^\n]+?\n/g, ``);
	mergedCode = mergedCode.replace(/(?<=\n)(\s+)\/\/ Player setup\r?\n    call InitCustomPlayerSlots\(  \)/,
		(startLocationsSrc) +
		(`$1// Player setup\r\n`) +
		(`$1call InitCustomPlayerSlots(  )\r\n`) +
		(playerSlotsSrc)
	);
	return mergedCode;
}

function mergeGlobals(mergedCode, main, config) {
	if (!main.regions.length) return mergedCode;
	let index = mergedCode.indexOf('endglobals');
	for (let regionName of main.regions) {
		let addedString = ' '.repeat(4) + 'rect                    ' + regionName + '            = null\r\n';
		mergedCode = mergedCode.slice(0, index) + addedString + mergedCode.slice(index);
		index += addedString.length;
	}
	return mergedCode;
}

function mergeInitialization(mergedCode, main, config, functions, {dropItemsTriggers}) {

	//***************************************************************************
	//*
	//*  Unit Item Tables
	//*
	//***************************************************************************
	//function UnitXYZABC_DropItems takes nothing returns nothing
	/*for (const dropTrigger of dropItemsTriggers) {
		mergedCode = insertInSection(mergedCode, 'Unit Item Tables', dropTrigger);
	}*/
	mergedCode = insertInSection(mergedCode, 'Unit Item Tables', dropItemsTriggers);

	//***************************************************************************
	//*
	//*  Sounds
	//*
	//***************************************************************************

	//***************************************************************************
	//*
	//*  Unit Creation
	//*
	//***************************************************************************
	//function CreateNeutralHostile takes nothing returns nothing
	//function CreateNeutralPassiveBuildings takes nothing returns nothing
	//function CreateNeutralPassive takes nothing returns nothing
	/*mergedCode = insertInSection(mergedCode, 'Unit Creation', functions.CreateNeutralHostile);
	mergedCode = insertInSection(mergedCode, 'Unit Creation', functions.CreateNeutralPassiveBuildings);
	mergedCode = insertInSection(mergedCode, 'Unit Creation', functions.CreateNeutralPassive);
	mergedCode = insertInSection(mergedCode, 'Unit Creation', functions.CreateAllUnits);*/
	mergedCode = insertInSection(mergedCode, 'Unit Creation', [
		functions.CreateNeutralHostile,
		functions.CreateNeutralPassiveBuildings,
		functions.CreateNeutralPassive,
		functions.CreatePlayerBuildings,
		functions.CreatePlayerUnits,
		functions.CreateAllUnits,
		functions.CreateRegions,
	]);
	
	//***************************************************************************
	//*
	//*  Triggers
	//*
	//***************************************************************************

	//***************************************************************************
	//*
	//*  Players
	//*
	//***************************************************************************
	//function InitCustomPlayerSlots takes nothing returns nothing
	//function InitCustomTeams takes nothing returns nothing
	//function InitAllyPriorities takes nothing returns nothing
	/*mergedCode = insertInSection(mergedCode, 'Players', functions.InitCustomPlayerSlots);
	mergedCode = insertInSection(mergedCode, 'Players', functions.InitCustomTeams);
	mergedCode = insertInSection(mergedCode, 'Players', functions.InitAllyPriorities);*/
	mergedCode = insertInSection(mergedCode, 'Players', [
		functions.InitCustomPlayerSlots,
		functions.InitCustomTeams,
		functions.InitAllyPriorities,
	]);

	//***************************************************************************
	//*
	//*  Main Initialization
	//*
	//***************************************************************************
	//call SetCameraBounds(-5120.0 + GetCameraMargin(CAMERA_MARGIN_LEFT), -5376.0 + GetCameraMargin(CAMERA_MARGIN_BOTTOM), 5120.0 - GetCameraMargin(CAMERA_MARGIN_RIGHT), 4864.0 - GetCameraMargin(CAMERA_MARGIN_TOP), -5120.0 + GetCameraMargin(CAMERA_MARGIN_LEFT), 4864.0 - GetCameraMargin(CAMERA_MARGIN_TOP), 5120.0 - GetCameraMargin(CAMERA_MARGIN_RIGHT), -5376.0 + GetCameraMargin(CAMERA_MARGIN_BOTTOM))
    //call SetDayNightModels( "Environment\\DNC\\DNCLordaeron\\DNCLordaeronTerrain\\DNCLordaeronTerrain.mdl", "Environment\\DNC\\DNCLordaeron\\DNCLordaeronUnit\\DNCLordaeronUnit.mdl" )
    //call SetAmbientDaySound( "LordaeronSummerDay" )
    //call SetAmbientNightSound( "LordaeronSummerNight" )
	mergedCode = mergeMain(mergedCode, main);

	//***************************************************************************
	//*
	//*  Map Configuration
	//*
	//***************************************************************************
	//DefineStartLocation(0, 3328.0, 3072.0)
	//SetPlayerSlotAvailable(Player(0), MAP_CONTROL_USER)
	mergedCode = mergeConfig(mergedCode, config);

	return mergedCode;
}


module.exports = {
	insertMeta,
	lintJass,
	mergeGlobals,
	mergeInitialization,
};
