"use strict"

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const util = require('util');
const path = require('path');

const oldFolder = path.resolve(__dirname, '_latest-maps');
const liveFolder = path.resolve(__dirname, 'latest-maps');

async function main() {
	const oldMapNames = fs.readdirSync(oldFolder);
	const newMapNames = fs.readdirSync(liveFolder);
	for (const mapName of newMapNames) {
		if (!oldMapNames.includes(mapName)) {
			console.log(`New map: ${mapName}`);
		} else {
			const oldContent = fs.readFileSync(path.resolve(oldFolder, mapName));
			const newContent = fs.readFileSync(path.resolve(liveFolder, mapName));
			if (Buffer.compare(oldContent, newContent) !== 0) {
				console.log(`Updated map: ${mapName}`);
			}
		}
	}
}

main();
