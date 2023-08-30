"use strict"

const assert = require('assert');
const fs = require('fs');
const util = require('util');
const path = require('path');
const crypto = require('crypto');

const {
	InfoLegacy, DoodadsLegacy, UnitsLegacy, StringsLegacy,
	InfoLatest, DoodadsLatest, UnitsLatest, StringsLatest,

	spawnSync,
	delFolders,
	logOnce,
	parseWar, writeWar, isMapFileName,
	batchExtract, batchAdapt, getMapDescStrings,
	brandMap,
	getDate,
	getMapHash, qHasCachedProto, cacheProtoHash,
	deepClone,
	copyFileSync,
	getAMAIVersion,
} = require('./lib');

const {
	protoDir,
	modsDir,
	upstreamDirs,
	adaptedDirs,
	backportsDirs,
	releaseDir,
	MAP_DESC_STRINGS,
	PROTO_FILE_PATH,
} = require('./shared');

let upstreamDir, adaptedDir, backportsDir;

const {
	parseCode
} = require('./parser');

const {
	insertMeta,
	mergeGlobals,
	mergeInitialization,
} = require('./generator');

const releaseMapNames = new Map();

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

function mergeUpstreamIntoCopies(willOpt, ensureResumable) {
	const folderContents = new Set(fs.readdirSync(upstreamDir));
	const protoInfo = parseWar(InfoLegacy, path.resolve(modsDir, 'war3map.w3i'))
	const protoStrings = parseWar(StringsLegacy, path.resolve(modsDir, 'war3map.wts'))
	const protoJass = fs.readFileSync(path.resolve(modsDir, `war3map.j`), 'utf8');
	const lookupStringsIndices = MAP_DESC_STRINGS.map(key => parseInt(protoInfo.map[key].slice(8)));
	const evergreenAuthor = 'IceSandslash';
	const evergreenDate = getDate();
	const evergreenGenerator = 'the Evergreen Project';
	const evergreenVersion = protoStrings[lookupStringsIndices[0]].match(/Evergreen \d+/)?.[0] || `Evergreen 10`;
	const AMAIVersion = getAMAIVersion();
	for (const folder of folderContents) {
		if (!folderContents.has(`${folder}.w3x`)) continue;
		const hash = getMapHash(path.resolve(upstreamDir, `${folder}.w3x`));
		const portFolder = path.resolve(backportsDir, folder);
		try {
			fs.mkdirSync(portFolder);
		} catch (err) {
			if (err.code !== 'EEXIST') throw err;
		}
		const portedMapPathFromMods = path.relative(modsDir, path.resolve(portFolder, `${folder}.w3x`));
		console.log(`Processing ${path.relative(process.cwd(), portFolder)}...`);
		copyFileSync(PROTO_FILE_PATH, path.resolve(portFolder, `${folder}.w3x`));
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
		outJassString = insertMeta(outJassString, {hash, texts: mapMetaTexts}, {
			version: evergreenVersion,
			author: evergreenAuthor,
			date: evergreenDate,
			generator: evergreenGenerator,
			AMAIVersion: ['2.6.2', AMAIVersion.public, AMAIVersion.private].map(x => x.slice(0, 8)).join(` .. `),
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
			fs.statSync(path.resolve(portFolder, fileName));
			spawnSync(`MPQEditor`, [`add`, `${folder}.w3x`, fileName], {cwd: portFolder});
		}
		const asIsModFiles = [
			`war3mapMisc.txt`,
			`war3map.w3s`,
			`war3map.w3a`, `war3map.w3h`, `war3map.w3q`, `war3map.w3t`, `war3map.w3u`,
			/*`war3map.wct`, `war3map.wtg`,*/
			`war3mapImported`, `UI`,
		];
		for (const fileName of asIsModFiles) {
			fs.statSync(path.resolve(modsDir, fileName));
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
			throw new Error(`Place Map Adapter v1.1.6 output at ${adaptedDir} (missing for ${folder}.w3x)`);
		}
		const asIsUpstreamFiles = [
			//`war3map.shd`, `war3map.wpm`, `war3map.w3e`,
		];
		for (const fileName of asIsUpstreamFiles) {
			spawnSync(`MPQEditor`, [`add`, portedMapPathFromUpstream, fileName], {cwd: path.resolve(upstreamDir, folder)});
		}
		const nameBuffer = Buffer.from(`${mapMetaTexts.name.replace(/ v\d+(.\d+)?$/, '')} ${evergreenVersion}`);
		const outName = brandMap(folder, evergreenVersion);
		const sanitizedName = outName.replace(/^\((\d+)\)/, '$1_').replace(/\(([\.\d]+)\)\.w3x$/, (match, $1) => '_' + Buffer.from($1).toString('hex') + '.w3x');
		releaseMapNames.set(sanitizedName, nameBuffer);

		if (ensureResumable || !willOpt) {
			let rawData = fs.readFileSync(path.resolve(portFolder, `${folder}.w3x`));
			const startIndex = rawData.indexOf(0) + 4;
			const endIndex = rawData.indexOf(0, startIndex);
			// Done out-of-the-box by w3x2lni if willOpt=true
			rawData[endIndex + 5] = config.playerCount;
			const header = Buffer.concat([
				rawData.slice(0, startIndex),
				releaseMapNames.get(sanitizedName),
				rawData.slice(endIndex, 0x200),
			], 0x200);
			rawData = Buffer.concat([header, rawData.slice(0x200)]);
			const outPath = path.resolve(portFolder, '..', sanitizedName);
			
			fs.writeFileSync(outPath, rawData);
			fs.unlinkSync(path.resolve(portFolder, `${folder}.w3x`));
			fs.writeFileSync(path.resolve(releaseDir, `${folder}.w3x`), rawData);
		} else {
			fs.renameSync(path.resolve(portFolder, `${folder}.w3x`), path.resolve(portFolder, '..', sanitizedName));
		}
	}
}

function installAMAIInPlace() {
	const mapNames = fs.readdirSync(backportsDir).filter(isMapFileName);
	for (const fileName of mapNames) {
		const pathFromCwd = path.relative(process.cwd(), path.resolve(backportsDir, fileName));
		spawnSync(`InstallTFTToMap.bat`, [pathFromCwd], {stdio: 'inherit'});
	}
}

function installAMAICommander(wc3_data_path, sub_folder_base, sub_folder_cmdr) {
	const fromFolder = path.resolve(wc3_data_path, 'Maps', sub_folder_base);
	const outFolder = path.resolve(wc3_data_path, 'Maps', sub_folder_cmdr);
	const mapNames = fs.readdirSync(fromFolder).filter(isMapFileName);
	const tmpNames = new Set();
	for (const fileName of mapNames) {
		let tmpName = fileName;
		do {
			let hash = crypto.createHash('sha256');
			hash.update(tmpName);
			tmpName = `${hash.digest('hex')}.w3x`;
		} while (tmpNames.has(tmpName));
		tmpNames.add(tmpName);
		copyFileSync(path.resolve(fromFolder, fileName), path.resolve(outFolder, tmpName));
		spawnSync(`InstallCommanderToMap.bat`, [tmpName], {/*stdio: 'inherit', */cwd: outFolder});
		fs.renameSync(path.resolve(outFolder, tmpName), path.resolve(outFolder, fileName));
	}
}

function optimizeMaps() {
	delFolders([releaseDir]);
	const mapNames = fs.readdirSync(backportsDir).filter(isMapFileName);
	for (const fileName of mapNames) {
		console.log(`Optimizing ${fileName}...`);
		spawnSync('w2l.exe', ['slk', path.resolve(backportsDir, fileName)], {cwd: backportsDir, stdio: 'inherit'});
		try {
			fs.renameSync(
				path.resolve(backportsDir, `${fileName.slice(0, -4)}_slk.w3x`),
				path.resolve(releaseDir, fileName),
			);
		} catch (err) {
			if (err.code !== 'ENOENT') throw err;
			console.error(err.stack);
		}
	}
}

function setDisplayNamesInPlace() {
	const mapNames = fs.readdirSync(releaseDir).filter(isMapFileName);
	console.log(`setDisplayNamesInPlace() - ${mapNames.length} maps found.`);
	for (const fileName of mapNames) {
		const outPath = path.resolve(releaseDir, fileName);
		if (!releaseMapNames.has(fileName)) {
			logOnce(`[Resumed task] Unable to set display name for maps.`);
			continue;
		}
		let rawData = fs.readFileSync(outPath);
		const startIndex = rawData.indexOf(0) + 4;
		const endIndex = rawData.indexOf(0, startIndex);
		const header = Buffer.concat([
			rawData.slice(0, startIndex),
			releaseMapNames.get(fileName),
			rawData.slice(endIndex, 0x200),
		], 0x200);
		rawData = Buffer.concat([header, rawData.slice(0x200)]);
		fs.writeFileSync(outPath, rawData);
	}
}

function copyToWorkingWC3(wc3_data_path, sub_folder) {
	const outFolder = path.resolve(wc3_data_path, 'Maps', sub_folder);
	try {
		fs.mkdirSync(outFolder);
	} catch (err) {
		if (err.code !== 'EEXIST') throw err;
	}
	const mapNames = fs.readdirSync(releaseDir).filter(isMapFileName);
	if (!mapNames.length) return console.error(`No maps generated at ${releaseDir}.`);
	for (const sanitizedFileName of mapNames) {
		const fromPath = path.resolve(releaseDir, sanitizedFileName);
		const fileName = sanitizedFileName.replace(/^(\d+)_/, '($1)').replace(/_([a-f0-9]+)\.w3x$/, (match, $1) => '(' + Buffer.from($1, 'hex').toString('utf8') + ').w3x');
		copyFileSync(
			fromPath,
			path.resolve(outFolder, fileName),
		);
	}
	console.log(`${mapNames.length} maps deployed to ${outFolder}`);
}

function runUpdate(opts) {
	let hasCachedProto = qHasCachedProto();
	if (opts.extractPrototype && !hasCachedProto) extractProto();
	if (opts.extractSeasonalMaps) {
		batchExtract(adaptedDir);
		batchExtract(upstreamDir);
	}
	if (!opts.useCachedBackports || !hasCachedProto) {
		delFolders([backportsDir]);
	}
	if (opts.adaptSeasonalMaps) {
		batchAdapt(adaptedDir, 'legacy', backportsDir);
		batchAdapt(upstreamDir, 'latest', backportsDir);
	}
	if (!opts.useCachedBackports) {
		mergeUpstreamIntoCopies(opts.optimize, opts.resumable);
	}
	if (opts.installAI) {
		// Requires AMAI in PATH
		// In-place = Output is also stored for future useCachedBackports.
		// But explicit installAI overrides cache.
		installAMAIInPlace();
	}
	if (opts.optimize) {
		// Requires w3x2lni in PATH
		optimizeMaps();
		setDisplayNamesInPlace();
	}
	if (opts.deploy) {
		if (!hasCachedProto && opts.deployPath.prune) {
			delFolders([
				path.resolve(__dirname, '..', '..', '..', 'Games', 'Warcraft III', 'Maps', 'Evergreen'),
				path.resolve(__dirname, '..', '..', '..', 'Games', 'Warcraft III', 'Maps', 'Evergreen-Cmdr'),
			], {allowOutside: true});
		}
		copyToWorkingWC3(opts.deployPath.root, opts.deployPath.subFolder);
	}
	cacheProtoHash();
}

function useMapSet(i) {
	upstreamDir = upstreamDirs[i];
	adaptedDir = adaptedDirs[i];
	backportsDir = backportsDirs[i];
}

function runAttachCommander() {
	installAMAICommander(
		path.resolve(__dirname, '..', '..', '..', 'Games', 'Warcraft III'),
		'Evergreen',
		'Evergreen-Cmdr',
	);
}

function runMain(mapSet) {
	useMapSet(mapSet);
	runUpdate({
		extractPrototype: true, /* ignored if cached */
		extractSeasonalMaps: true, // true
		adaptSeasonalMaps: true,
		useCachedBackports: false, // false
		installAI: true, // true
		optimize: true, // true
		deploy: true,
		deployPath: {
			prune: true,
			root: path.resolve(__dirname, '..', '..', '..', 'Games', 'Warcraft III'),
			subFolder: 'Evergreen',
		},
		resumable: false,
	});
}

let t = process.hrtime();
runMain(1);
runMain(0);
runAttachCommander();
t = process.hrtime(t);

console.log(`Done in ${t[0]} seconds.`);
