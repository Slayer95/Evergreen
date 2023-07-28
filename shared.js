"use strict"

const fs = require('fs');
const path = require('path');

const protoDir = path.resolve(__dirname, 'prototype');
const modsDir = path.resolve(__dirname, 'mods');
const upstreamDir = path.resolve(__dirname, 'latest-official');
const adaptedDir = path.resolve(__dirname, 'latest-autoadapted');
const backportsDir = path.resolve(__dirname, 'backports');
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
	upstreamDir,
	adaptedDir,
	backportsDir,
	releaseDir,
	MAP_DESC_STRINGS,
	LUA_SOURCE,
	PROTO_FILE_PATH: getProtoFilePath(),
};
