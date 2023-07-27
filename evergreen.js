"use strict"

const assert = require('assert');
const fs = require('fs');
const util = require('util');
const path = require('path');

const {
	InfoLegacy, DoodadsLegacy, UnitsLegacy, StringsLegacy,
	InfoLatest, DoodadsLatest, UnitsLatest, StringsLatest,

	spawnSync,
	delFolders,
	parseWar, writeWar,
	batchExtract, getMapDescStrings,
	getDate,
	brandMap,
	deepClone,
} = require('./lib');

const {
	protoDir,
	modsDir,
	upstreamDir,
	adaptedDir,
	backportsDir,
	amaiDir,
	MAP_DESC_STRINGS,
	GAME_MAPS_PATH,
	PROTO_FILE_PATH,
} = require('./shared');

const {
	parseCode
} = require('./parser');

const {
	insertMeta,
	mergeGlobals,
	mergeInitialization,
} = require('./generator');

function extractProto() {
	const protoFileName = path.relative(protoDir, PROTO_FILE_PATH);
	delFolders([modsDir]);
	return spawnSync(`MPQEditor`, [`extract`, protoFileName, `*`, path.relative(protoDir, modsDir), `/fp`], {cwd: protoDir});
}

function stripProtoJass(jass) {
	const inputLines = jass.split(/\r?\n/);
	const outputLines = [];
	let omitDeclaration = false;
	for (let i = 0; i < inputLines.length; i++) {
		if (omitDeclaration) {
			if (inputLines[i] === 'endfunction') omitDeclaration = false;
			continue;
		}
		const match = inputLines[i].match(/^function (Unit\d+_DropItems|ItemTable\d+_DropItems|CreateNeutralHostile|CreateNeutralPassiveBuildings|CreateNeutralPassive|CreatePlayerBuildings|CreatePlayerUnits|CreateAllUnits|CreateRegions|InitCustomPlayerSlots|InitCustomTeams|InitAllyPriorities) takes nothing returns nothing$/);
		if (match) {
			omitDeclaration = true;
		} else {
			outputLines.push(inputLines[i]);
		}
	}
	return outputLines.join(`\r\n`);
}

function mergeUpstreamIntoCopies() {
	const folderContents = new Set(fs.readdirSync(upstreamDir));
	const protoInfo = parseWar(InfoLegacy, path.resolve(modsDir, 'war3map.w3i'))
	const protoStrings = parseWar(StringsLegacy, path.resolve(modsDir, 'war3map.wts'))
	const protoJass = fs.readFileSync(path.resolve(modsDir, `war3map.j`), 'utf8');
	const lookupStringsIndices = MAP_DESC_STRINGS.map(key => parseInt(protoInfo.map[key].slice(8)));
	const evergreenAuthor = 'IceSandslash';
	const evergreenDate = getDate();
	const evergreenGenerator = 'the Evergreen Project';
	const evergreenVersion = protoStrings[lookupStringsIndices[0]].match(/Evergreen \d+/)?.[0] || `Evergreen 10`;
	for (const folder of folderContents) {
		if (!folderContents.has(`${folder}.w3x`)) continue;
		const portFolder = path.resolve(backportsDir, folder);
		try {
			fs.mkdirSync(portFolder);
		} catch (err) {
			if (err.code !== 'EEXIST') throw err;
		}
		const portedMapPathFromMods = path.relative(modsDir, path.resolve(portFolder, `${folder}.w3x`));
		console.log(`Processing ${path.relative(process.cwd(), portFolder)}...`);
		fs.copyFileSync(PROTO_FILE_PATH, path.resolve(portFolder, `${folder}.w3x`));
		const portedMapPathFromUpstream = path.relative(path.resolve(upstreamDir, folder), path.resolve(portFolder, `${folder}.w3x`));
		const isLua = fs.existsSync(path.resolve(upstreamDir, folder, `war3map.lua`));
		const {main, config, functions, dropItemsTriggers} = parseCode(
			fs.readFileSync(path.resolve(upstreamDir, folder, isLua ? `war3map.lua` : `war3map.j`), 'utf8'),
			isLua ? 'lua' : 'jass2'
		);

		// Create strings file
		const mapMetaTexts = getMapDescStrings(path.resolve(upstreamDir, folder))
		const editedStrings = Object.assign({}, protoStrings);
		for (let i = 0; i < MAP_DESC_STRINGS.length; i++) {
			if (MAP_DESC_STRINGS[i] in mapMetaTexts) {
				editedStrings[lookupStringsIndices[i]] = mapMetaTexts[MAP_DESC_STRINGS[i]];
			} else {
				delete editedStrings[lookupStringsIndices[i]];
			}
		}
		const outStringsPath = path.resolve(portFolder, 'war3map.wts');
		writeWar(outStringsPath, StringsLegacy, editedStrings);

		// Update jass
		const outJassPath = path.resolve(portFolder, 'war3map.j');
		//console.log(`Rewriting ${path.relative(process.cwd(), outJassPath)}...`);
		let outJassString = protoJass;
		outJassString = stripProtoJass(outJassString);
		outJassString = insertMeta(outJassString, mapMetaTexts, {
			version: evergreenVersion,
			author: evergreenAuthor,
			date: evergreenDate,
			generator: evergreenGenerator,
		});
		outJassString = mergeGlobals(outJassString, main, config);
		outJassString = mergeInitialization(outJassString, main, config, functions, {dropItemsTriggers});
		fs.writeFileSync(outJassPath, outJassString);

		// Update info
		const upstreamMapInfo = parseWar(InfoLatest, path.resolve(upstreamDir, folder, 'war3map.w3i'));
		const mapInfo = deepClone(protoInfo);
		mapInfo.camera = deepClone(upstreamMapInfo.camera);
		mapInfo.players = deepClone(upstreamMapInfo.players);
		mapInfo.map.playableArea = deepClone(upstreamMapInfo.map.playableArea);
		mapInfo.map.mainTileType = deepClone(upstreamMapInfo.map.mainTileType);
		mapInfo.customSoundEnvironment = upstreamMapInfo.customSoundEnvironment;
		mapInfo.customLightEnv = upstreamMapInfo.customLightEnv;
		for (let i = 0; i < mapInfo.players.length; i++) {
			if (mapInfo.players[i] && protoInfo.players[i]) {
				mapInfo.players[i].name = protoInfo.players[i].name;
			} else if (mapInfo.players[i]) {
				console.error(`Prototype map does not have enough players.`);
			} else {
				console.error(`Upstream map players corrupted.`);
			}
		}
		mapInfo.globalWeather = upstreamMapInfo.globalWeather;
		const outInfoPath = path.resolve(portFolder, 'war3map.w3i');
		writeWar(outInfoPath, InfoLegacy, mapInfo, buffer => buffer[0x81] = 2); // Game Data Set = Latest Patch
		const editedFiles = [
			`war3map.j`, `war3map.wts`, `war3map.w3i`,
			`war3map.doo`, `war3mapUnits.doo`,
		];
		for (const fileName of editedFiles) {
			spawnSync(`MPQEditor`, [`add`, `${folder}.w3x`, fileName], {cwd: portFolder});
		}
		const asIsModFiles = [
			`war3mapMisc.txt`,
			`war3map.w3s`,
			`war3map.w3a`, `war3map.w3h`, `war3map.w3q`, `war3map.w3t`, `war3map.w3u`,
			/*`war3map.wct`, `war3map.wtg`,*/
		];
		for (const fileName of asIsModFiles) {
			spawnSync(`MPQEditor`, [`add`, portedMapPathFromMods, fileName], {cwd: modsDir});
		}
		const fromAdaptedFiles = [
			`war3map.shd`, `war3map.wpm`, `war3map.w3e`, `war3mapMap.blp`, `war3map.mmp`,
		];
		for (const fileName of fromAdaptedFiles) {
			spawnSync(`MPQEditor`, [`delete`, `${folder}.w3x`, fileName], {cwd: portFolder});
			spawnSync(`MPQEditor`, [`add`, portedMapPathFromUpstream, fileName], {cwd: path.resolve(adaptedDir, folder)});
		}
		if (fromAdaptedFiles.includes(`war3map.w3e`) && !fs.existsSync(path.resolve(adaptedDir, folder, `war3map.w3e`))) {
			throw new Error(`Place Map Adapter v1.1.6 output at ${adaptedDir}`);
		}
		const asIsUpstreamFiles = [
			//`war3map.shd`, `war3map.wpm`, `war3map.w3e`,
		];
		for (const fileName of asIsUpstreamFiles) {
			spawnSync(`MPQEditor`, [`add`, portedMapPathFromUpstream, fileName], {cwd: path.resolve(upstreamDir, folder)});
		}
		let rawData = fs.readFileSync(path.resolve(portFolder, `${folder}.w3x`));
		const startIndex = rawData.indexOf(0) + 4;
		const endIndex = rawData.indexOf(0, startIndex);
		rawData[endIndex + 5] = config.playerCount;
		const nameBuffer = Buffer.from(`${mapMetaTexts.name.replace(/ v\d+(.\d+)?$/, '')} ${evergreenVersion}`);
		const header = Buffer.concat([
			rawData.slice(0, startIndex),
			nameBuffer,
			rawData.slice(endIndex, 0x200),
		], 0x200);
		rawData = Buffer.concat([header, rawData.slice(0x200)]);
		const outName = brandMap(folder, evergreenVersion);
		const sanitizedName = outName.replace(/^\((\d+)\)/, '$1_').replace(/\(([\.\d]+)\)\.w3x$/, (match, $1) => '_' + Buffer.from($1).toString('hex') + '.w3x');
		fs.writeFileSync(path.resolve(portFolder, '..', sanitizedName), rawData);
	}
}

function addAMAI() {
	const mapNames = fs.readdirSync(backportsDir).filter(x => x.endsWith(`.w3x`));
	for (const fileName of mapNames) {
		const mapFilePath = path.resolve(backportsDir, fileName);
		spawnSync(`InstallTFTToMap.bat`, [mapFilePath], {cwd: amaiDir, stdio: 'inherit'});
	}
}

function corruptMPQ() {
	const mapNames = fs.readdirSync(backportsDir).filter(x => x.endsWith(`.w3x`));
	for (const fileName of mapNames) {
		const mapFilePath = path.resolve(backportsDir, fileName);

		const deleteFiles = [
			`war3map.lua`,
			//`war3map.mmp`,
			//`war3map.wct`,
			`war3map.wtg`, `war3map.w3c`, `war3map.w3s`, `war3map.w3r`,
			`(listfile)`, `(attributes)`,
		];
		for (const deleteName of deleteFiles) {
			spawnSync(`MPQEditor`, [`delete`, fileName, deleteName], {cwd: backportsDir, stdio: 'inherit'});
		}

		const emptyFiles = [
			'(listfile)', '(attributes)',
		];
		for (const emptyFile of emptyFiles) {
			fs.writeFileSync(path.resolve(backportsDir, emptyFile), '');
			spawnSync(`WinMPQ`, [`add`, mapFilePath, path.resolve(backportsDir, emptyFile), '/'], {cwd: backportsDir, stdio: 'inherit'});
		}
		

		const content = fs.readFileSync(mapFilePath);
		const badHeader = Buffer.from('CATS');
		badHeader.copy(content, 0x204, 0, 4);
		fs.writeFileSync(mapFilePath, content);
	}
}

function copyToWorkingWC3() {
	try {
		fs.mkdirSync(path.resolve(GAME_MAPS_PATH));
	} catch (err) {
		if (err.code !== 'EEXIST') throw err;
	}
	const mapNames = fs.readdirSync(backportsDir).filter(x => x.endsWith(`.w3x`));
	for (const sanitizedFileName of mapNames) {
		const fileName = sanitizedFileName.replace(/^(\d+)_/, '($1)').replace(/_([a-f0-9]+)\.w3x$/, (match, $1) => '(' + Buffer.from($1, 'hex').toString('utf8') + ').w3x');
		fs.copyFileSync(
			path.resolve(backportsDir, sanitizedFileName),
			path.resolve(GAME_MAPS_PATH, fileName),
		);
	}
}

extractProto();
//*
batchExtract(adaptedDir, 'legacy', backportsDir);
batchExtract(upstreamDir, 'latest', backportsDir);
//*/
//*
mergeUpstreamIntoCopies();
addAMAI();
corruptMPQ();
copyToWorkingWC3();
//*/
