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
	brandMap, coloredShortHash,
	getDate,
	getMapHash, qHasCachedProto, cacheProtoHash,
	deepClone,
	copyFileSync,
	getAMAIVersion,
} = require('./lib');

const {
	protoDir,
	modsDir,
	customDir,
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
	lintJass,
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

function mergeUpstreamIntoCopies(willOpt) {
	const folderContents = new Set(fs.readdirSync(upstreamDir));
	const protoInfo = parseWar(InfoLegacy, path.resolve(modsDir, 'war3map.w3i'))
	const protoStrings = parseWar(StringsLegacy, path.resolve(modsDir, 'war3map.wts'))
	const protoJass = fs.readFileSync(path.resolve(modsDir, `war3map.j`), 'utf8');
	const lookupStringsIndices = MAP_DESC_STRINGS.map(key => parseInt(protoInfo.map[key].slice(8)));
	const evergreenAuthor = 'IceSandslash';
	const evergreenDate = getDate();
	const evergreenGenerator = 'the Evergreen Project';
	const evergreenVersion = protoStrings[lookupStringsIndices[0]].match(/Evergreen \d+(?:[a-z])?/)?.[0] || `Evergreen 20`;
	const AMAIVersion = getAMAIVersion();
	for (const folder of folderContents) {
		if (!folderContents.has(`${folder}.w3x`)) continue;
		let hash;
		if (fs.existsSync(path.resolve(upstreamDir, `${folder}.w3x.0`))) {
			// Some maps (e.g. 2023S2 Eversong v1.1) need to be saved with latest WorldEdit before it can be read by MapAdapter, etc
			// The .0 file is the original map file.
			hash = getMapHash(path.resolve(upstreamDir, `${folder}.w3x.0`));
		} else {
			hash = getMapHash(path.resolve(upstreamDir, `${folder}.w3x`));
		}
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
		const portedMapPathFromCustom = path.relative(customDir, path.resolve(portFolder, `${folder}.w3x`));
		const isLua = fs.existsSync(path.resolve(upstreamDir, folder, `war3map.lua`));
		const {main, config, functions, dropItemsTriggers} = parseCode(
			fs.readFileSync(path.resolve(upstreamDir, folder, isLua ? `war3map.lua` : `war3map.j`), 'utf8'),
			isLua ? 'lua' : 'jass2'
		);
		const upstreamMapInfo = parseWar(InfoLatest, path.resolve(upstreamDir, folder, 'war3map.w3i'));

		// Create strings file
		const mapMetaTexts = getMapDescStrings(path.resolve(upstreamDir, folder))
		const editedStrings = Object.assign({}, protoStrings);
		let maxStringIndex = -1;
		for (const key in editedStrings) {
			let num = Number(key);
			if (num > maxStringIndex) maxStringIndex = num;
		}
		for (let i = 0; i < upstreamMapInfo.players.length - 6; i++) {
			/* GHost: WorldEdit supports up to 6 named forces. Hack to support 12 forces. */
			editedStrings[`${maxStringIndex + i + 1}`] = `Force ${7 + i}`;
		}
		for (let i = 0; i < MAP_DESC_STRINGS.length; i++) {
			const stringId = lookupStringsIndices[i];
			if (MAP_DESC_STRINGS[i] in mapMetaTexts) {
				editedStrings[stringId] = mapMetaTexts[MAP_DESC_STRINGS[i]];
				if (MAP_DESC_STRINGS[i] === 'author') {
					editedStrings[stringId] += `, and IceSandslash`;
				} else if (MAP_DESC_STRINGS[i] === 'description') {
					editedStrings[stringId] = editedStrings[stringId].trim() + ` Evergreen edition.`;
				} else if (MAP_DESC_STRINGS[i] === 'name') {
					// For map databases
					editedStrings[stringId] = editedStrings[stringId].replace(/\s+v\d+(.\d+)?$/, '') + ` Evergreen`;
				}
			} else {
				delete editedStrings[stringId];
			}
		}
		const defaultGHostTeams = /synergy|friends/.test(folder) ? 'Pairs' : (/\b(\d)vs?\1\b/.test(folder) ? 'NvN' : 'FFA');
		const outStringsPath = path.resolve(portFolder, 'war3map.wts');
		writeWar(outStringsPath, StringsLegacy, editedStrings);

		// Update info
		const mapInfo = deepClone(protoInfo);
		mapInfo.camera = deepClone(upstreamMapInfo.camera);
		mapInfo.players = deepClone(upstreamMapInfo.players);
		for (const player of mapInfo.players) {
			/* GHost: Default to (unselectable) random races, rather than WorldEdit defaults */
			player.race = 0;
		}

		mapInfo.forces = deepClone(upstreamMapInfo.forces);
		const forceNames = protoInfo.forces.map(force => force.name);
		assert.strictEqual(forceNames.length, 6, `Expected 6 named forces in prototype map.`);
		for (let i = 0; i < upstreamMapInfo.players.length - 6; i++) {
			/* GHostOne: WorldEdit supports up to 6 named forces. Hack to support 12 forces. */
			forceNames.push(forceNames.at(-1).replace(/\d+$/, match => `${maxStringIndex + i + 1}`.padStart(match.length, '0')));
		}
		
		const protoForce = mapInfo.forces[0];
		protoForce.flags.allied = true;
		protoForce.flags.alliedVictory = true;

		/* InfoTranslator.js@1.1.0:134
		outBuffer.addInt(force.players === -1 ? (1 << 11) - 1 : force.players);
		*/
		mapInfo.forces.splice(1, mapInfo.forces.length);
		if (defaultGHostTeams === 'NvN') {
			/* Forced team-up in GHostOne default config. */
			protoForce.players = (1 << (mapInfo.players.length >> 1)) - 1;
			mapInfo.forces.push(deepClone(protoForce));
			mapInfo.forces.at(-1).players <<= (mapInfo.players.length >> 1);
			protoForce.players = ~mapInfo.forces.at(-1).players; /* Fill higher-order bytes */
		} else {
			let factor = (defaultGHostTeams === 'Pairs' ?
				2 /* Synergy, Friends, Heart To Heart, etc. */ :
				1 /* Default to FFA */
			);
			protoForce.players = 1;
			let allUsedPlayers = 0;
			for (let i = 1; i < upstreamMapInfo.players.length / factor; i++) {
				mapInfo.forces.push(deepClone(protoForce));
				mapInfo.forces.at(-1).players <<= i * factor;
				allUsedPlayers |= mapInfo.forces.at(-1).players;
			}
			protoForce.players = ~allUsedPlayers; /* Fill higher-order bytes */
		}

		//*/
		for (let i = 0; i < mapInfo.forces.length; i++) {
			mapInfo.forces[i].name = forceNames[Math.min(forceNames.length - 1, i)];
		}
		mapInfo.map.flags.useCustomForces = false;

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
		writeWar(outInfoPath, InfoLegacy, mapInfo, buffer => buffer[0x81] = 2); // Game Data Set = 2 (Latest Patch)

		// Update jass
		const outJassPath = path.resolve(portFolder, 'war3map.j');
		//console.log(`Rewriting ${path.relative(process.cwd(), outJassPath)}...`);
		let outJassString = protoJass;
		outJassString = stripProtoJass(outJassString);
		outJassString = lintJass(outJassString);
		outJassString = insertMeta(outJassString, {hash, editorVersion: mapInfo.editorVersion, texts: mapMetaTexts}, {
			version: evergreenVersion,
			author: evergreenAuthor,
			date: evergreenDate,
			generator: evergreenGenerator,
			AMAIVersion: ['|cffffcc002.6.2|r', ...[AMAIVersion.public, AMAIVersion.private].map(coloredShortHash)].join(` .. `),
		});
		outJassString = mergeGlobals(outJassString, main, config);
		outJassString = mergeInitialization(outJassString, main, config, functions, {dropItemsTriggers});
		{
			// W3 calls the config function to setup the match slots.
			const re = /(call +SetPlayerTeam\(\s*Player\(\s*)(\d+)(\s*\)\s*,\s*)(\d+)(\s*\))/g;
			let match;
			while (match = re.exec(outJassString)) {
				let teamIndex = defaultGHostTeams === 'NvN' ? ~~(Number(match[2]) >= (mapInfo.players.length >> 1)) : (defaultGHostTeams === 'Pairs' ? (Number(match[2]) >> 1) : Number(match[2]));
				outJassString = outJassString.slice(0, match.index) + match[1] + match[2] + match[3] + teamIndex.toString(10) + match[5] + outJassString.slice(match.index + match[0].length);
			}
		}
		outJassString = outJassString.replace(/RACE_PREF_(HUMAN|ORC|NIGHTELF|UNDEAD)/g, `RACE_PREF_USER_SELECTABLE`);
		fs.writeFileSync(outJassPath, outJassString);

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
		const asIsCustomFiles = [
			`war3mapSkin.txt`,
		];
		for (const fileName of asIsCustomFiles) {
			spawnSync(`MPQEditor`, [`add`, portedMapPathFromCustom, fileName], {cwd: customDir});
		}
		const nameBuffer = Buffer.from(`|cff32cd32${mapMetaTexts.name.replace(/ v\d+(.\d+)?$/, '')} ${evergreenVersion}`);
		const outName = brandMap(folder, evergreenVersion, '');
		const sanitizedName = outName.replace(/^\((\d+)\)/, '$1_').replace(/\(([\.\d]+)\)\.w3x$/, (match, $1) => '_' + Buffer.from($1).toString('hex') + '.w3x');
		releaseMapNames.set(sanitizedName, nameBuffer);

		if (!willOpt) {
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

function installAMAIInPlace(dirPath) {
	const mapNames = fs.readdirSync(dirPath).filter(isMapFileName);
	for (const fileName of mapNames) {
		const pathFromCwd = path.relative(process.cwd(), path.resolve(dirPath, fileName));
		spawnSync(`InstallTFTToMap.bat`, [pathFromCwd], {stdio: 'inherit'});
	}
}

function installAMAICommander(wc3_data_path, sub_folder_base, sub_folder_cmdr) {
	const fromFolder = path.resolve(wc3_data_path, 'Maps', sub_folder_base);
	const outFolder = path.resolve(wc3_data_path, 'Maps', sub_folder_cmdr);
	const mapNames = fs.readdirSync(fromFolder).filter(isMapFileName);
	const tmpNames = new Set();
	try {
		fs.mkdirSync(outFolder);
	} catch (err) {
		if (err.code !== 'EEXIST') throw err;
	}
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

function updateMapHashes(wc3_data_path, sub_folder) {
	const outFolder = path.resolve(wc3_data_path, 'Maps', sub_folder);
	try {
		fs.mkdirSync(outFolder);
	} catch (err) {
		if (err.code !== 'EEXIST') throw err;
	}
	const mapNames = fs.readdirSync(outFolder).filter(isMapFileName);
	if (!mapNames.length) return console.error(`No maps generated at ${outFolder}.`);
	const hashes = new Map();
	for (const fileName of mapNames) {
		hashes.set(fileName, getMapHash(path.resolve(outFolder, fileName)));
	}
	const hashList = Array.from(hashes).map(tuple => tuple.join(','));
	hashList.unshift('Map,SHA256');
	hashList.push('');
	fs.writeFileSync(path.resolve(outFolder, 'hashes.csv'), hashList.join('\n'));
}

function runUpdate(opts) {
	if (opts.deploy && !opts.adaptSeasonalMaps && !opts.useCachedBackports) {
		throw new Error(`Either deploy from cache or from new adaption (deploy=true requires opts.useCachedBackports, or opts.adaptSeasonalMaps)`);
	}

	let hasCachedProto = qHasCachedProto();
	if (opts.extractPrototype && !hasCachedProto) extractProto();
	if (opts.extractSeasonalMaps) {
		// TODO: This extraction can be cached, but gotta ensure that no new maps have been added.
		batchExtract(adaptedDir);
		batchExtract(upstreamDir);
	}

	let useReleased = opts.useCachedBackports && hasCachedProto;
	if (!useReleased) {
		if (!delFolders([backportsDir])) throw new Error(`Unable to delete backports folder (${backportsDir}).`);
		if (opts.adaptSeasonalMaps) {
			batchAdapt(adaptedDir, 'legacy', backportsDir);
			batchAdapt(upstreamDir, 'latest', backportsDir);
		}
	}
	if (!useReleased) {
		if (!delFolders([releaseDir])) throw new Error(`Unable to delete release folder (${releaseDir}).`);
		mergeUpstreamIntoCopies(opts.optimize);
		// If optimize is false, mergeUpstreamIntoCopies writes directly to releaseDir
		useReleased = !opts.optimize;
	}
	if (opts.installAI) {
		// Requires AMAI in PATH
		// In-place = Output is also stored for future useCachedBackports.
		// But explicit installAI overrides cache.
		installAMAIInPlace(useReleased ? releaseDir : backportsDir);
	}
	if (opts.optimize) {
		// Requires w3x2lni in PATH
		optimizeMaps();
		setDisplayNamesInPlace();
	}
	if (opts.deploy) {
		if (!hasCachedProto && opts.deployPath.prune) {
			if (!delFolders([
				path.resolve(opts.deployPath.root, 'Maps', opts.deployPath.subFolder),
				path.resolve(opts.deployPath.root, 'Maps', `${opts.deployPath.subFolder}-Cmdr`),
			], {allowOutside: true})) throw new Error(`Unable to delete deploy folder (${opts.deployPath.subFolder}).`);
		}
		copyToWorkingWC3(opts.deployPath.root, opts.deployPath.subFolder);
		updateMapHashes(opts.deployPath.root, opts.deployPath.subFolder);
	}
	cacheProtoHash();
	return true;
}

function useMapSet(i) {
	upstreamDir = upstreamDirs[i];
	adaptedDir = adaptedDirs[i];
	backportsDir = backportsDirs[i];
}

function runAttachCommander(suffix = '') {
	const deployRoot = path.resolve(__dirname, '..', '..', '..', 'Games', 'WC3');
	installAMAICommander(deployRoot, `Evergreen${suffix}`, `Evergreen-Cmdr${suffix}`);
	updateMapHashes(deployRoot, `Evergreen-Cmdr${suffix}`);
}

function runDeploy(mapSet, suffix = '') {
	useMapSet(mapSet);
	runUpdate({
		extractPrototype: false, /* ignored if cached */
		extractSeasonalMaps: false, // true
		adaptSeasonalMaps: false, /* ignored if cached */
		useCachedBackports: true, // false
		installAI: false, // false
		optimize: false, // false
		deploy: true,
		deployPath: {
			prune: true,
			root: path.resolve(__dirname, '..', '..', '..', 'Games', 'WC3'),
			subFolder: `Evergreen${suffix}`,
		},
	});
}

function runMain(mapSet, suffix = '') {
	useMapSet(mapSet);
	runUpdate({
		extractPrototype: true, /* ignored if cached */
		extractSeasonalMaps: true, // true
		adaptSeasonalMaps: true, /* ignored if cached */
		useCachedBackports: false, // false
		installAI: true, // true
		optimize: true, // true
		deploy: true,
		deployPath: {
			prune: true,
			root: path.resolve(__dirname, '..', '..', '..', 'Games', 'WC3'),
			subFolder: `Evergreen${suffix}`,
		},
	});
}

let t = process.hrtime();
let errors = [];
try {
	runMain(1, '-N');
} catch (err) {
	errors.push(err);
	console.error(err.message);
}
try {
	runMain(0, '-N');
} catch (err) {
	errors.push(err);
	console.error(err.message);
}
runAttachCommander('-N');
t = process.hrtime(t);

console.log(`Done in ${t[0]} seconds.`);
if (errors.length) {
	console.error(`${errors.length} errors.`);
	for (const error of errors) console.error(error);
}
