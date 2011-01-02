"use strict"

const fs = require('fs');
const path = require('path');

const protoDir = path.resolve(__dirname, 'prototype');
const modsDir = path.resolve(__dirname, 'mods');
const customDir = path.resolve(__dirname, 'custom');
const upstreamDirs = ['latest-maps', 'latest-maps-x'].map(x => path.resolve(__dirname, x));
const adaptedDirs = ['latest-maps-auto', 'latest-maps-auto-x'].map(x => path.resolve(__dirname, x));
const backportsDirs = ['backports', 'backports-x'].map(x => path.resolve(__dirname, x));
const releaseDir = path.resolve(__dirname, 'release');
const LUA_SOURCE = Symbol('lua_source');
const MAP_DESC_STRINGS = ['name', 'author', 'description', 'recommendedPlayers'];

function getProtoFilePath() {
	const mapFiles = fs.readdirSync(protoDir).filter(filename => filename.endsWith('.w3x'));
	if (!mapFiles.length) throw new Error(`No map found in ${protoDir}`);
	if (mapFiles.length > 1) throw new Error(`Too many maps found in ${protoDir}`);
	return path.resolve(protoDir, mapFiles[0]);
}

module.exports = {
	protoDir,
	modsDir,
	customDir,
	upstreamDirs,
	adaptedDirs,
	backportsDirs,
	releaseDir,
	LUA_SOURCE,
	MAP_DESC_STRINGS,
	PROTO_FILE_PATH: getProtoFilePath(),
};
