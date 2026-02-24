"use strict"

const assert = require('assert');
const util = require('util');

const luaparse = require('luaparse');
const {
	LUA_SOURCE,
} = require('./shared');
const {
	getMapDescStrings,
} = require('./lib');

const jassparse = {
	parse(source, options) {
		let currentFn = null;
		const inputLines = source.split(/\r?\n/);
		const outputLines = [];
		for (let i = 0; i < inputLines.length; i++) {
			if (currentFn) {
				currentFn.body.push(inputLines[i]);
				if (inputLines[i] === 'endfunction') {
					if (options.onCreateNode) options.onCreateNode({
						type: 'FunctionDeclaration',
						identifier: {name: currentFn.name},
						source: currentFn.body.join('\r\n'),
					});
					currentFn = null;
				}
			} else {
				const declarationMatch = inputLines[i].match(/^function (Unit\d+_DropItems|ItemTable\d+_DropItems|CreateNeutralHostile|CreateNeutralPassiveBuildings|CreateNeutralPassive|CreatePlayerBuildings|CreatePlayerUnits|CreateAllUnits|CreateRegions|InitCustomPlayerSlots|InitCustomTeams|InitAllyPriorities|InitRandomGroups) takes nothing returns nothing$/);
				if (declarationMatch) {
					currentFn = {
						name: declarationMatch[1],
						body: [declarationMatch[0]],
					};
				} else {
					outputLines.push(inputLines[i]);
				}
			}
			{
				const callMatch = inputLines[i].match(/^\s*(?:call\s+|set [a-zA-Z0-9_]+\s*?=\s*)([a-zA-Z0-9_]+)\((.*)\)\s*$/);
				if (callMatch) {
					if (options.onCreateNode) {
						const callExpressionNode = {
							type: 'CallExpression',
							base: {type: 'Identifier', name: callMatch[1]},
							arguments: callMatch[2].split(/,/).map(jassparse.parseFnArg),
						};
						options.onCreateNode(callExpressionNode);
						if (!/^\s*call/.test(callMatch[0])) {
							options.onCreateNode({
								type: 'AssignmentStatement',
								variables: [{name: /^\s*set ([a-zA-Z0-9_]+)/.exec(callMatch[0])[1]}],
								init: [callExpressionNode],
							});
						}
					}
				}
				
				const fixedMatch = inputLines[i].match(/^\s*set ([a-zA-Z0-9_]+)(\[\d+\]|)\s*?=\s*('[\da-zA-Z][\da-zA-Z][\da-zA-Z][\da-zA-Z]'|\d+)/);
				if (fixedMatch) {
					const assignmentStatementNode = {
						// TODO: Check spec
						type: 'AssignmentStatement',
						variables: [{name: fixedMatch[1], index: fixedMatch[2]}],
						init: []
					};
					if (options.onCreateNode) {
						options.onCreateNode(assignmentStatementNode);
					}
				}
			}
		}
		return outputLines.join(`\r\n`);
	},
	parseFnArg(arg) {
		arg = arg.trim();
		let source = arg;
		let raw, value, name;
		if (arg.startsWith(`"`)) {
			raw = arg;
		} else if (/^\-?\d+$/.test(arg) || /^\-?\d+\.\d*$/.test(arg)) {
			value = +arg;
			return {type: 'NumericLiteral', source, raw, value, name};
		} else if (arg.includes('(') && arg.endsWith(')')) {
			let parenIndex = arg.indexOf('(');
			return {
				source,
				base: {type: 'Identifier', name: arg.slice(0, parenIndex)},
				arguments: arg.slice(parenIndex + 1, -1).split(/,/).map(jassparse.parseFnArg),
			};
		} else {
			name = arg;
		}
		return {source, raw, value, name};
	},
};

function getInteger(node) {
	if (node.type === 'NumericLiteral') return node.value;
	if (node.type === 'UnaryExpression' && node.operator === '-') {
		if (node.argument.type !== 'NumericLiteral') throw new Error(`Cannot parse as integer: ${JSON.stringify(node)}.`);
		return -node.argument.value;
	} else {
		throw new Error(`Cannot parse as integer: ${JSON.stringify(node)}.`);
	}
}

function onCreateNode(sourceCode, functions, main, config, node) {
	if (node.type === 'FunctionDeclaration') {
		functions[node.identifier.name] = node;
		if (!node.source) node[LUA_SOURCE] = sourceCode.slice(node.range[0], node.range[1]);
		// TODO: Transpile
	} else if (node.type === 'CallExpression' && node.base.type === 'Identifier') {
		switch (node.base.name) {
		case 'SetCameraBounds':
			main.camera = node.arguments.map(({range, source}) => source || sourceCode.slice(range[0], range[1]));
			break;
		case 'SetDayNightModels':
			main.dayNightModels = node.arguments.map(({range, source}) => source || sourceCode.slice(range[0], range[1]));
			break;
		case 'SetAmbientDaySound':
			main.daySound = node.arguments[0].raw;
			break;
		case 'SetAmbientNightSound':
			main.nightSound = node.arguments[0].raw;
			break;
		case 'SetPlayers':
			config.playerCount = node.arguments[0].value;
			break;
		case 'SetTeams':
			config.teamCount = node.arguments[0].value;
			break;
		case 'DefineStartLocation':
			config.startLocations[node.arguments[0].value] = node.arguments.slice(1).map(getInteger);
			break;
		case 'SetPlayerSlotAvailable':
			config.playerSlots[node.arguments[0].arguments[0].value] = node.arguments[1].name;
			break;
		}
	} else if (node.type === 'AssignmentStatement') {
		for (let i = 0; i < node.init.length; i++) {
			if (node.init[i] && node.init[i].type === 'CallExpression' && node.init[i].base.type === 'Identifier') {
				switch (node.init[i].base.name) {
				case 'Rect':
					main.regions.add(node.variables[i].name);
					break;
				}
			}
		}
		if (node.variables[0].name.startsWith('gg_rg_')) {
			main.randomUnitGroups.add(node.variables[0].name);
		}
	}
}

function parseLua(source, {main, config}) {
	const functions = {};
	luaparse.parse(source, {
		ranges: true,
		onCreateNode: onCreateNode.bind(null, source, functions, main, config),
	});
	return functions;
}

function parseJass(source, {main, config}) {
	const functions = {};
	jassparse.parse(source, {
		ranges: true,
		onCreateNode: onCreateNode.bind(null, source, functions, main, config),
	});
	return functions;
}

function parseCode(source, language) {
	const dropItemsTriggers = [];
	const main = {
		camera: [],
		dayNightModels: [],
		daySound: '',
		nightSound: '',
		regions: new Set(),
		randomUnitGroups: new Set(),
	};
	const config = {
		playerCount: 2,
		teamCount: 2,
		startLocations: [],
		playerSlots: [],
	};

	const functions = language === 'lua' ? parseLua(source, {main, config}) : parseJass(source, {main, config});
	for (const fnName in functions) {
		if (/^(Unit|ItemTable)\d+_DropItems$/.test(fnName)) {
			dropItemsTriggers.push(functions[fnName]);
		}
	}
	return {
		functions, main, config,
		dropItemsTriggers,
	};
}

module.exports = {
	parseLua, parseJass,
	parseCode,
};
