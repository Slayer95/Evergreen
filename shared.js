"use strict"

const fs = require('fs');
const path = require('path');

const protoDir = path.resolve(__dirname, 'prototype');
const protoObjDir = path.resolve(protoDir, 'obj');
const protoSlkDir = path.resolve(protoDir, 'slk');
const dataDir = path.resolve(__dirname, 'data');
const customDir = path.resolve(__dirname, 'custom'); // additional files for maps
const upstreamDirs = ['latest-maps', 'latest-maps-x', 'latest-maps-t'].map(x => path.resolve(__dirname, x));
const adaptedDirs = ['latest-maps-auto', 'latest-maps-auto-x', 'latest-maps-auto-t'].map(x => path.resolve(__dirname, x));
const backportsDirs = ['backports', 'backports-x', 'backports-t'].map(x => path.resolve(__dirname, x));
const releaseDir = path.resolve(__dirname, 'release');
const LUA_SOURCE = Symbol('lua_source');
const MAP_DESC_STRINGS = ['name', 'author', 'description', 'recommendedPlayers'];

function getProtoFilePath() {
	const mapFiles = fs.readdirSync(protoDir).filter(filename => filename.endsWith('.w3x') && !filename.endsWith('_slk.w3x'));
	if (!mapFiles.length) throw new Error(`No map found in ${protoDir}`);
	if (mapFiles.length > 1) throw new Error(`Too many maps found in ${protoDir}`);
	return path.resolve(protoDir, mapFiles[0]);
}

module.exports = {
	protoDir,
	protoObjDir,
	protoSlkDir,
	dataDir,
	customDir, // additional files for maps
	upstreamDirs,
	adaptedDirs,
	backportsDirs,
	releaseDir,
	LUA_SOURCE,
	MAP_DESC_STRINGS,
	PROTO_FILE_PATH: getProtoFilePath(),
};
