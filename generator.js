"use strict"

const {LUA_SOURCE} = require('./shared');
const {exists, tryReplaceUnit, float, quote, coloredHash} = require('./lib');
const {
  objectCostsToSource,
  objectNamesToSource,
  sunderingUnitsToSource,
  heroAbilitiesToSource,
  unitButtonsToSource,
} = require('./flag-definitions');

const invalidPatterns = [
	/GetConvertedPlayerId\(([a-zA-Z0-9_ \(\)]+)\) \+ 1/g,
];

const contradictoryConditions = new Set([
	`if false then`,
	`if true == false then`,
	`if false == true then`,
	`if ( true == false ) then`,
	`if ( false == true ) then`,
	`if udg_DEAD_CODE then`,
	`if udg_DEAD_CODE == true then`,
	`if ( udg_DEAD_CODE == true ) then`,
]);

const negatedContradictoryConditions = new Set();
for (const condition of contradictoryConditions) {
	negatedContradictoryConditions.add(`if ( not ( ${condition.slice(3, -5)} ) ) then`);
}

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
	const {author, date, generator, version, language, AMAIVersion} = evergreenMeta;
	const questMapCreditsText = `|cffffcc00${meleeTexts.name}|r is a map made by |cffffcc00${meleeTexts.author}|r.`
  const localizationText = `- |cffffcc00${language}|r localization.`;

/*
See also common.eai
//==============================================================
// (AMAI)  General Stuff
//==============================================================
	boolean IsAMAI = false
    boolean leadally = false
	
	boolean campaign_ai = false

    string language = "Spanish"
*/

  jassCode = jassCode.replace(/(set udg_MetaTextQuestAuthor\[5\] = )"[^"]+"/, `$1"${localizationText}"`);
	jassCode = jassCode.replace(/(set udg_MetaTextQuestCredits\[1\] = )"[^"]+"/, `$1"${questMapCreditsText}"`);
	jassCode = jassCode.replace(/(set udg_MetaTextQuestCredits\[2\] = )"[^"]+"/, `$1"|cff32cd32Project Evergreen|r |cffffcc00v${version.split(' ').at(-1)}|r includes:"`);
	jassCode = jassCode.replace(/(set udg_MetaTextQuestCredits\[10\] = )"[^"]+"/, `$1"|cffffcc00${meleeTexts.name}|r's (WorldEdit version |cffffcc00${meleeEditorVersion}|r) hash (|cff4682b4sha256|r):"`);
	jassCode = jassCode.replace(/(set udg_MetaTextQuestCredits\[11\] = )"[^"]+"/, `$1"${coloredHash(meleeHash)}"`);
	jassCode = jassCode.replace(/(set udg_MetaTextQuestCredits\[14\] = )"[^"]+"/, `$1"${evergreenMeta.AMAIVersion}"`);

	/* JASS metadata */
	jassCode = jassCode.replace(/\/\/ ([\w][^\r\n]+?)(?=\r?\n)/, `// ${meleeTexts.name} ${version} (for 1.26)`);
	jassCode = jassCode.replace(/Generated by [^\n]+/, `Generated by ${generator}`);
	jassCode = jassCode.replace(/Date: [^\n]+/, `Date: ${date}`);
	jassCode = jassCode.replace(/Map Author: [^\n]+/, `Map Author: ${author}`);

	/* Hashtables */
	jassCode = jassCode.replace(/ *\/\/ BEGIN udg_RFObjectCost(.*)\/\/ END udg_RFObjectCost/s, objectCostsToSource());
	jassCode = jassCode.replace(/ *\/\/ BEGIN udg_RFObjectName(.*)\/\/ END udg_RFObjectName/s, objectNamesToSource());
	jassCode = jassCode.replace(/ *\/\/ BEGIN udg_RFSunderingUnits(.*)\/\/ END udg_RFSunderingUnits/s, sunderingUnitsToSource());
	/*jassCode = jassCode.replace(/\/\/ BEGIN udg_RFMeleeUnits(.*)\/\/ END udg_RFMeleeUnits/s, meleeUnitsToSource());*/
	jassCode = jassCode.replace(/ *\/\/ BEGIN udg_RFHeroAbilities(.*)\/\/ END udg_RFHeroAbilities/s, heroAbilitiesToSource());
	jassCode = jassCode.replace(/ *\/\/ BEGIN udg_RFUnitButtons(.*)\/\/ END udg_RFUnitButtons/s, unitButtonsToSource());
	return jassCode;
}

function removeDeadCode(jassCode) {
	let inputLines = jassCode.split('\n');
	let outputLines = [];
	let deadCodeDepth = 0;
	let ifDepth = 0;
	let fnName = '';
	let alwaysFalseFunctions = new Set();
	let fnBody = [];
	let alwaysFalseFunctionDeclarationLines = new Set();
	for (let i = 0; i < inputLines.length; i++) {
		let trimmed = inputLines[i].trim();
		if (trimmed.startsWith(`function `)) {
			fnName = trimmed.slice(9).split(` takes `, 1)[0];
			continue;
		} else if (trimmed.startsWith(`endfunction`)) {
			if (fnBody.length === 4 && (
				negatedContradictoryConditions.has(fnBody[0]) && fnBody[1] === `return false` && fnBody[2] === `endif` && fnBody[3] === `return true` ||
				contradictoryConditions.has(fnBody[0]) && fnBody[1] === `return true` && fnBody[2] === `endif` && fnBody[3] === `return false`
			)) {
				alwaysFalseFunctionDeclarationLines.add(i - 5);
				alwaysFalseFunctions.add(fnName);
			}
			fnName = '';
			fnBody.length = 0;
		}
		if (fnName) fnBody.push(trimmed);
	}

	for (let i = 0; i < inputLines.length; i++) {
		if (alwaysFalseFunctionDeclarationLines.has(i)) {
			i += 5;
			continue;
		}
		let trimmed = inputLines[i].trim();
		if (trimmed.startsWith(`if `)) {
			ifDepth++;
		} else if (trimmed.startsWith(`endif`)) {
			if (deadCodeDepth === ifDepth) {
				deadCodeDepth = 0;
				ifDepth--;
				continue;
			}
			ifDepth--;
		}
		if (contradictoryConditions.has(trimmed)) {
			deadCodeDepth = ifDepth;
		} else {
			let fnCall = /^if \( ([a-zA-Z0-9_]+)\(\) \) then$/.exec(trimmed);
			if (fnCall && alwaysFalseFunctions.has(fnCall[1])) {
				deadCodeDepth = ifDepth;
			}
		}
		if (deadCodeDepth) continue;
		//w2l automatically removes unused variables
		//if (/^boolean\s+udg_DEAD_CODE\s*=\s*false$/.test(trimmed)) continue;
		outputLines.push(inputLines[i]);
	}

	return outputLines.join(`\n`);
}

function insertMMDDeps(jassCode) {
  jassCode += (`
//Struct method generated initializers/callers:
function sa__MMD__QueueNode_onDestroy takes nothing returns boolean
local integer this=f__arg_this
            call FlushStoredInteger(MMD__gc, MMD__M_KEY_VAL + s__MMD__QueueNode_key[this], s__MMD__QueueNode_msg[this])
            call FlushStoredInteger(MMD__gc, MMD__M_KEY_CHK + s__MMD__QueueNode_key[this], s__MMD__QueueNode_key[this])
            set s__MMD__QueueNode_msg[this]=null
            set s__MMD__QueueNode_key[this]=null
            set s__MMD__QueueNode_next[this]=0
   return true
endfunction

function jasshelper__initstructs33761985 takes nothing returns nothing
    set st__MMD__QueueNode_onDestroy=CreateTrigger()
    call TriggerAddCondition(st__MMD__QueueNode_onDestroy,Condition( function sa__MMD__QueueNode_onDestroy))


endfunction
`
  );
  return jassCode;
}

function insertMMDLibrary(jassCode) {

  let transpiledVJassCodeLibrary = (
`//Generated method caller for MMD__QueueNode.onDestroy
function sc__MMD__QueueNode_onDestroy takes integer this returns nothing
            call FlushStoredInteger(MMD__gc, MMD__M_KEY_VAL + s__MMD__QueueNode_key[this], s__MMD__QueueNode_msg[this])
            call FlushStoredInteger(MMD__gc, MMD__M_KEY_CHK + s__MMD__QueueNode_key[this], s__MMD__QueueNode_key[this])
            set s__MMD__QueueNode_msg[this]=null
            set s__MMD__QueueNode_key[this]=null
            set s__MMD__QueueNode_next[this]=0
endfunction

//Generated allocator of MMD__QueueNode
function s__MMD__QueueNode__allocate takes nothing returns integer
 local integer this=si__MMD__QueueNode_F
    if (this!=0) then
        set si__MMD__QueueNode_F=si__MMD__QueueNode_V[this]
    else
        set si__MMD__QueueNode_I=si__MMD__QueueNode_I+1
        set this=si__MMD__QueueNode_I
    endif
    if (this>8190) then
        return 0
    endif

   set s__MMD__QueueNode_next[this]= 0
    set si__MMD__QueueNode_V[this]=-1
 return this
endfunction

//Generated destructor of MMD__QueueNode
function sc__MMD__QueueNode_deallocate takes integer this returns nothing
    if this==null then
        return
    elseif (si__MMD__QueueNode_V[this]!=-1) then
        return
    endif
    set f__arg_this=this
    call TriggerEvaluate(st__MMD__QueueNode_onDestroy)
    set si__MMD__QueueNode_V[this]=si__MMD__QueueNode_F
    set si__MMD__QueueNode_F=this
endfunction

//library MMD:

    ///////////////////////////////////////////////////////////////
    /// Private variables and constants
    ///////////////////////////////////////////////////////////////
    
    ///////////////////////////////////////////////////////////////
    /// Private functions
    ///////////////////////////////////////////////////////////////
    
    ///Triggered when tampering is detected. Increases the number of safeguards against tampering.
    function MMD_RaiseGuard takes string reason returns nothing
        set MMD__num_senders=MMD__NUM_SENDERS_SAFE //increase number of players voting on each message
    endfunction

    ///Returns seconds elapsed in game time
    function MMD__time takes nothing returns real
        return TimerGetElapsed(MMD__clock)
    endfunction
    
    ///Initializes the char-to-int conversion
    function MMD__prepC2I takes nothing returns nothing
        local integer i= 0
        local string id
        loop
            exitwhen i >= MMD__num_chars
            set id=SubString(MMD__chars, i, i + 1)
            if id == StringCase(id, true) then
                set id=id + "U"
            endif
            call StoreInteger(MMD__gc, "c2i", id, i)
            set i=i + 1
        endloop
    endfunction
    ///Converts a character to an integer
    function MMD__C2I takes string c returns integer
        local integer i
        local string id= c
        if id == StringCase(id, true) then
            set id=id + "U"
        endif
        set i=GetStoredInteger(MMD__gc, "c2i", id)
        if ( i < 0 or i >= MMD__num_chars or SubString(MMD__chars, i, i + 1) != c ) and HaveStoredInteger(MMD__gc, "c2i", id) then
            //A cheater sent a fake sync to screw with the cached values
            set i=0
            loop
                exitwhen i >= MMD__num_chars //just a weird character
                if c == SubString(MMD__chars, i, i + 1) then //cheating!
                    call MMD_RaiseGuard("c2i poisoned")
                    call StoreInteger(MMD__gc, "c2i", id, i)
                    exitwhen true
                endif
                set i=i + 1
            endloop
        endif
        return i
    endfunction

    ///Computes a weak hash value, hopefully secure enough for our purposes
    function MMD__poor_hash takes string s,integer seed returns integer
        local integer n= StringLength(s)
        local integer m= n + seed
        local integer i= 0
        loop
            exitwhen i >= n
            set m=m * 41 + MMD__C2I(SubString(s, i, i + 1))
            set i=i + 1
        endloop
        return m
    endfunction

    ///Stores previously sent messages for tamper detection purposes
    function s__MMD__QueueNode_create takes integer id,string msg returns integer
        local integer this= s__MMD__QueueNode__allocate()
        set s__MMD__QueueNode_timeout[this]=(TimerGetElapsed(MMD__clock)) + 7.0 + GetRandomReal(0, 2 + 0.1 * GetPlayerId(GetLocalPlayer())) // INLINED!!
        set s__MMD__QueueNode_msg[this]=msg
        set s__MMD__QueueNode_checksum[this]=MMD__poor_hash(s__MMD__QueueNode_msg[this] , id)
        set s__MMD__QueueNode_key[this]=I2S(id)
        return this
    endfunction
    function s__MMD__QueueNode_onDestroy takes integer this returns nothing
        call FlushStoredInteger(MMD__gc, MMD__M_KEY_VAL + s__MMD__QueueNode_key[this], s__MMD__QueueNode_msg[this])
        call FlushStoredInteger(MMD__gc, MMD__M_KEY_CHK + s__MMD__QueueNode_key[this], s__MMD__QueueNode_key[this])
        set s__MMD__QueueNode_msg[this]=null
        set s__MMD__QueueNode_key[this]=null
        set s__MMD__QueueNode_next[this]=0
    endfunction

    //Generated destructor of MMD__QueueNode
    function s__MMD__QueueNode_deallocate takes integer this returns nothing
        if this==null then
            return
        elseif (si__MMD__QueueNode_V[this]!=-1) then
            return
        endif
        call s__MMD__QueueNode_onDestroy(this)
        set si__MMD__QueueNode_V[this]=si__MMD__QueueNode_F
        set si__MMD__QueueNode_F=this
    endfunction

    function s__MMD__QueueNode_send takes integer this returns nothing
        call StoreInteger(MMD__gc, MMD__M_KEY_VAL + s__MMD__QueueNode_key[this], s__MMD__QueueNode_msg[this], s__MMD__QueueNode_checksum[this])
        call StoreInteger(MMD__gc, MMD__M_KEY_CHK + s__MMD__QueueNode_key[this], s__MMD__QueueNode_key[this], s__MMD__QueueNode_checksum[this])
        call SyncStoredInteger(MMD__gc, MMD__M_KEY_VAL + s__MMD__QueueNode_key[this], s__MMD__QueueNode_msg[this])
        call SyncStoredInteger(MMD__gc, MMD__M_KEY_CHK + s__MMD__QueueNode_key[this], s__MMD__QueueNode_key[this])
    endfunction
    
    ///Returns true for a fixed size uniform random subset of players in the game
    function MMD__isEmitter takes nothing returns boolean
        local integer i= 0
        local integer n= 0
        local integer r
        local integer array picks
        local boolean array pick_flags
        loop
            exitwhen i >= udg_RFMaxPlayerIndex
            if GetPlayerController(Player(i)) == MAP_CONTROL_USER and GetPlayerSlotState(Player(i)) == PLAYER_SLOT_STATE_PLAYING then
                if n < MMD__num_senders then //initializing picks
                    set picks[n]=i
                    set pick_flags[i]=true
                else //maintain the invariant 'P(being picked) = c/n'
                    set r=GetRandomInt(0, n)
                    if r < MMD__num_senders then
                        set pick_flags[picks[r]]=false
                        set picks[r]=i
                        set pick_flags[i]=true
                    endif
                endif
                set n=n + 1
            endif
            set i=i + 1
        endloop
        return pick_flags[GetPlayerId(GetLocalPlayer())]
    endfunction
    
    ///Places meta-data in the replay and in network traffic
    function MMD__emit takes string message returns nothing
        local integer q
        if not MMD__initialized then
            call BJDebugMsg("MMD Emit Error: Library not initialized yet.")
            return
        endif
        
        //remember sent messages for tamper check
        set q=s__MMD__QueueNode_create(MMD__num_msg , message)
        if MMD__q_head == 0 then
            set MMD__q_head=q
        else
            set s__MMD__QueueNode_next[MMD__q_tail]=q
        endif
        set MMD__q_tail=q
                
        //send new message
        set MMD__num_msg=MMD__num_msg + 1
        if MMD__isEmitter() then
            call s__MMD__QueueNode_send(q)
        endif
    endfunction

    ///Performs tamper checks
    function MMD__tick takes nothing returns nothing
        local integer q
        local integer i
        
        //check previously sent messages for tampering
        set q=MMD__q_head
        loop
            exitwhen q == 0 or s__MMD__QueueNode_timeout[q] >= (TimerGetElapsed(MMD__clock)) // INLINED!!
            if not HaveStoredInteger(MMD__gc, MMD__M_KEY_VAL + s__MMD__QueueNode_key[q], s__MMD__QueueNode_msg[q]) then
                call MMD_RaiseGuard("message skipping")
                call s__MMD__QueueNode_send(q)
            elseif not HaveStoredInteger(MMD__gc, MMD__M_KEY_CHK + s__MMD__QueueNode_key[q], s__MMD__QueueNode_key[q]) then
                call MMD_RaiseGuard("checksum skipping")
                call s__MMD__QueueNode_send(q)
            elseif GetStoredInteger(MMD__gc, MMD__M_KEY_VAL + s__MMD__QueueNode_key[q], s__MMD__QueueNode_msg[q]) != s__MMD__QueueNode_checksum[q] then
                call MMD_RaiseGuard("message tampering")
                call s__MMD__QueueNode_send(q)
            elseif GetStoredInteger(MMD__gc, MMD__M_KEY_CHK + s__MMD__QueueNode_key[q], s__MMD__QueueNode_key[q]) != s__MMD__QueueNode_checksum[q] then
                call MMD_RaiseGuard("checksum tampering")
                call s__MMD__QueueNode_send(q)
            endif
            set MMD__q_head=s__MMD__QueueNode_next[q]
            call s__MMD__QueueNode_deallocate(q)
            set q=MMD__q_head
        endloop
        if MMD__q_head == 0 then
            set MMD__q_tail=0
        endif
        
        //check for future message tampering
        set i=0
        loop
            exitwhen not HaveStoredInteger(MMD__gc, MMD__M_KEY_CHK + I2S(MMD__num_msg), I2S(MMD__num_msg))
            call MMD_RaiseGuard("message insertion")
            call MMD__emit("Blank")
            set i=i + 1
            exitwhen i >= 10
        endloop
    endfunction
    
    ///Replaces control characters with escape sequences
    function MMD__pack takes string value returns string
        local integer j
        local integer i= 0
        local string result= ""
        local string c
        loop //for each character in argument string
            exitwhen i >= StringLength(value)
            if (i + 1 >= StringLength(value)) then
              set c=SubString(value, i, i + 1)
            else
              set c=SubString(value, i, i + 2)
              set i=i + 1
              if (c == "á") then
                set c = "a"
              elseif (c == "é") then
                set c = "e"
              elseif (c == "í") then
                set c = "i"
              elseif (c == "ó" or c == "ö") then
                set c = "o"
              elseif (c == "ú" or c == "ü") then
                set c = "u"
              elseif (c == "Á") then
                set c = "A"
              elseif (c == "É") then
                set c = "E"
              elseif (c == "Í") then
                set c = "I"
              elseif (c == "Ó" or c == "Ö") then
                set c = "O"
              elseif (c == "Ú" or c == "Ü") then
                set c = "U"
              elseif (c == "ñ") then
                set c = "n"
              elseif (c == "Ñ") then
                set c = "N"
              elseif (c == "ç") then
                set c = "c"
              elseif (c == "Ç") then
                set c = "C"
              else
                set c = SubString(c, 0, 1)
                set i = i - 1
              endif
            endif
            set j=0
            loop //for each character in escaped chars string
                exitwhen j >= StringLength(MMD__ESCAPED_CHARS)
                //escape control characters
                if c == SubString(MMD__ESCAPED_CHARS, j, j + 1) then
                    set c="\\\\" + c
                    exitwhen true
                endif
                set j=j + 1
            endloop
            set result=result + c
            set i=i + 1
        endloop
        return result
    endfunction
    
    ///Updates the value of a defined variable for a given player
    function MMD__update_value takes string name,player p,string op,string value,integer val_type returns nothing
        local integer id= GetPlayerId(p)
        if p == null or id < 0 or id >= udg_RFMaxPlayerIndex then
            //call BJDebugMsg("MMD Set Error: Invalid player. Must be P1 to P" + I2S(udg_RFMaxPlayerIndex) + ".")
        elseif val_type != GetStoredInteger(MMD__gc, "types", name) then
            call BJDebugMsg("MMD Set Error: Updated value of undefined variable " + name + ", or used value of incorrect type.")
        elseif StringLength(op) == 0 then
            call BJDebugMsg("MMD Set Error: Unrecognized operation type.")
        elseif StringLength(name) > 50 then
            call BJDebugMsg("MMD Set Error: Variable name is too long.")
        elseif StringLength(name) == 0 then
            call BJDebugMsg("MMD Set Error: Variable name is empty.")
        else
            //call BJDebugMsg ("MMD Update: [name: " + name + "] [pid: " + I2S (GetPlayerId (p)) + "] [op: " + op + "] [value: " + value + "] [val_type: " + I2S (val_type) + "]")
            call MMD__emit("VarP " + I2S(id) + " " + MMD__pack(name) + " " + op + " " + value)
        endif
    endfunction

    ///Defines an event's arguments and format
    function MMD__DefineEvent takes string name,integer num_args,string format,string arg_data returns nothing
        if GetStoredInteger(MMD__gc, "events", name) != 0 then
            //TODO(IceSandslash): This is actually an important debug message
            //call BJDebugMsg("MMD DefEvent Error: Event " + name + " redefined.")
        else
            call StoreInteger(MMD__gc, "events", name, num_args + 1)
            call MMD__emit("DefEvent " + MMD__pack(name) + " " + I2S(num_args) + " " + arg_data + MMD__pack(format))
        endif
    endfunction
    
    ///Places an event in the meta-data
    function MMD__LogEvent takes string name,integer num_args,string data returns nothing
        if GetStoredInteger(MMD__gc, "events", name) != num_args + 1 then
            call BJDebugMsg("MMD LogEvent Error: Event " + name + " not defined or defined with different # of args.")
        else
            call MMD__emit("Event " + MMD__pack(name) + data)
        endif
    endfunction

    ///////////////////////////////////////////////////////////////
    /// Initialization
    ///////////////////////////////////////////////////////////////
    
    ///Emits initialization data
    function MMD__init2 takes nothing returns nothing
        local integer i
        local trigger t
        local player p
        set MMD__initialized=true
        
        call MMD__emit("init version " + I2S(MMD__MINIMUM_PARSER_VERSION) + " " + I2S(MMD__CURRENT_VERSION))

        set i=0
        loop
            exitwhen i >= udg_RFMaxPlayerIndex
            p = Player(i)
            if GetPlayerSlotState(p) == PLAYER_SLOT_STATE_PLAYING then
                if GetPlayerController(p) == MAP_CONTROL_USER then
                  call MMD__emit("init pid " + I2S(i) + " " + MMD__pack(GetPlayerName(p)))
                elseif GetPlayerController(p) == MAP_CONTROL_COMPUTER then
                  if GetAIDifficulty(p) == AI_DIFFICULTY_INSANE then
                    call MMD__emit("init pid " + I2S(i) + " " + MMD__pack("AMAI Insane"))
                  elseif GetAIDifficulty(p) == AI_DIFFICULTY_NORMAL then
                    call MMD__emit("init pid " + I2S(i) + " " + MMD__pack("AMAI Normal"))
                  else
                    call MMD__emit("init pid " + I2S(i) + " " + MMD__pack("AMAI Easy"))
                  endif
                endif
            endif
            set i=i + 1
        endloop
        
        set t=CreateTrigger()
        call TriggerAddAction(t, function MMD__tick)
        call TriggerRegisterTimerEvent(t, 0.37, true)
    endfunction
    
    ///Places init2 on a timer, initializes game cache, and translates constants
    function MMD__init takes nothing returns nothing
        local trigger t= CreateTrigger()
        call TriggerRegisterTimerEvent(t, 0, false)
        call TriggerAddAction(t, function MMD__init2)
        
        set MMD__goals[MMD_GOAL_NONE]="none"
        set MMD__goals[MMD_GOAL_HIGH]="high"
        set MMD__goals[MMD_GOAL_LOW]="low"
        
        set MMD__types[MMD_TYPE_INT]="int"
        set MMD__types[MMD_TYPE_REAL]="real"
        set MMD__types[MMD_TYPE_STRING]="string"

        set MMD__suggestions[MMD_SUGGEST_NONE]="none"
        set MMD__suggestions[MMD_SUGGEST_TRACK]="track"
        set MMD__suggestions[MMD_SUGGEST_LEADERBOARD]="leaderboard"

        set MMD__ops[MMD_OP_ADD]="+="
        set MMD__ops[MMD_OP_SUB]="-="
        set MMD__ops[MMD_OP_SET]="="

        set MMD__flags[MMD_FLAG_DRAWER]="drawer"
        set MMD__flags[MMD_FLAG_LOSER]="loser"
        set MMD__flags[MMD_FLAG_WINNER]="winner"
        set MMD__flags[MMD_FLAG_LEAVER]="leaver"
        set MMD__flags[MMD_FLAG_PRACTICING]="practicing"

        call FlushGameCache(InitGameCache(MMD__FILENAME))
        set MMD__gc=InitGameCache(MMD__FILENAME)
        call TimerStart(MMD__clock, 999999999, false, null)
        call MMD__prepC2I()
    endfunction
`);

  let transpiledVJassCodeAPI = (
`
    ///Sets a player flag like "win_on_leave"
    function MMD_FlagPlayer takes player p,integer flag_type returns nothing
        local string flag= MMD__flags[flag_type]
        local integer id= GetPlayerId(p)
        if p == null or id < 0 or id >= udg_RFMaxPlayerIndex then
            call BJDebugMsg("MMD Flag Error: Invalid player. Must be P1 to P" + I2S(udg_RFMaxPlayerIndex) + ".")
        elseif StringLength(flag) == 0 then
            call BJDebugMsg("MMD Flag Error: Unrecognized flag type.")
        else
            call MMD__emit("FlagP " + I2S(id) + " " + flag)
        endif
    endfunction

    ///Defines a variable to store things in
    function MMD_DefineValue takes string name,integer value_type,integer goal_type,integer suggestion_type returns nothing
        local string goal= MMD__goals[goal_type]
        local string vtype= MMD__types[value_type]
        local string stype= MMD__suggestions[suggestion_type]
        if goal == null then
            call BJDebugMsg("MMD Def Error: Unrecognized goal type.")
        elseif vtype == null then
            call BJDebugMsg("MMD Def Error: Unrecognized value type.")
        elseif stype == null then
            call BJDebugMsg("Stats Def Error: Unrecognized suggestion type.")
        elseif StringLength(name) > 32 then
            call BJDebugMsg("MMD Def Error: Variable name is too long.")
        elseif StringLength(name) == 0 then
            call BJDebugMsg("MMD Def Error: Variable name is empty.")
        elseif value_type == MMD_TYPE_STRING and goal_type != MMD_GOAL_NONE then
            call BJDebugMsg("MMD Def Error: Strings must have goal type of none.")
        elseif GetStoredInteger(MMD__gc, "types", name) != 0 then
            //TODO(IceSandslash): This is actually an important debug message
            //call BJDebugMsg("MMD Def Error: Value " + name + " redefined.")
        else
            call StoreInteger(MMD__gc, "types", name, value_type)
            call MMD__emit("DefVarP " + MMD__pack(name) + " " + vtype + " " + goal + " " + stype)
        endif
    endfunction

    ///Updates the value of an integer variable
    function MMD_UpdateValueInt takes string name,player p,integer op,integer value returns nothing
        call MMD__update_value(name , p , MMD__ops[op] , I2S(value) , MMD_TYPE_INT)
    endfunction
    
    ///Updates the value of a real variable
    function MMD_UpdateValueReal takes string name,player p,integer op,real value returns nothing
        call MMD__update_value(name , p , MMD__ops[op] , R2S(value) , MMD_TYPE_REAL)
    endfunction
    
    ///Updates the value of a string variable
    function MMD_UpdateValueString takes string name,player p,string value returns nothing
        local string q= "\\""
        call MMD__update_value(name , p , MMD__ops[MMD_OP_SET] , q + MMD__pack(value) + q , MMD_TYPE_STRING)
    endfunction    
    
    function MMD_DefineEvent0 takes string name,string format returns nothing
        call MMD__DefineEvent(name , 0 , format , "")
    endfunction
    function MMD_DefineEvent1 takes string name,string format,string argName0 returns nothing
        call MMD__DefineEvent(name , 1 , format , MMD__pack(argName0) + " ")
    endfunction
    function MMD_DefineEvent2 takes string name,string format,string argName0,string argName1 returns nothing
        call MMD__DefineEvent(name , 2 , format , MMD__pack(argName0) + " " + MMD__pack(argName1) + " ")
    endfunction
    function MMD_DefineEvent3 takes string name,string format,string argName0,string argName1,string argName2 returns nothing
        call MMD__DefineEvent(name , 3 , format , MMD__pack(argName0) + " " + MMD__pack(argName1) + " " + MMD__pack(argName2) + " ")
    endfunction
    
    function MMD_LogEvent0 takes string name returns nothing
        call MMD__LogEvent(name , 0 , "")
    endfunction
    function MMD_LogEvent1 takes string name,string arg0 returns nothing
        call MMD__LogEvent(name , 1 , " " + MMD__pack(arg0))
    endfunction
    function MMD_LogEvent2 takes string name,string arg0,string arg1 returns nothing
        call MMD__LogEvent(name , 2 , " " + MMD__pack(arg0) + " " + MMD__pack(arg1))
    endfunction
    function MMD_LogEvent3 takes string name,string arg0,string arg1,string arg2 returns nothing
        call MMD__LogEvent(name , 3 , " " + MMD__pack(arg0) + " " + MMD__pack(arg1) + " " + MMD__pack(arg2))
    endfunction

    ///Emits meta-data which parsers will ignore unless they are customized to understand it
    function MMD_LogCustom takes string unique_identifier,string data returns nothing
        call MMD__emit("custom " + MMD__pack(unique_identifier) + " " + MMD__pack(data))
    endfunction
`);

	jassCode = jassCode.replace(/ *\/\/ BEGIN MMD LIBRARY(.*)\/\/ END MMD LIBRARY/s, transpiledVJassCodeLibrary);
  jassCode = jassCode.replace(/ *\/\/ BEGIN MMD API(.*)\/\/ END MMD API/s, transpiledVJassCodeAPI);
  jassCode = jassCode.replace(`    call InitGlobals(  )`, 
`    call ExecuteFunc( "jasshelper__initstructs33761985" )
    call ExecuteFunc( "MMD__init" )
    call InitGlobals(  )`
  );

  return jassCode;
}

function lintJass(jassCode) {
	for (const re of invalidPatterns) {
		const match = re.exec(jassCode);
		if (match) {
			throw new Error(`Invalid code ${match[0]}.`, {cause: new Error(`Regexp matched ${re}`)});
		}
	}
	jassCode = removeDeadCode(jassCode);
  // Readability optimization
	jassCode = jassCode.replace(/\( GetConvertedPlayerId\(([a-zA-Z0-9_ \(\)]+)\) \- 1 \)/g, `( GetPlayerId($1) )`),

  // Transpilation
  jassCode = jassCode.replace(/"EVAL\(([^\n]+)\)"/g, '$1');
	jassCode = jassCode.replace(/GetPlayerName\([^\n]+\) == "WorldEdit"/g, `false`);
	jassCode = jassCode.replace(/GetUnitName\(([a-zA-Z0-9_-]+(?:\(\))?)\)/, `LoadStringBJ(GetUnitTypeId($1), 0, udg_RFObjectName)`);
	jassCode = jassCode.replace(/GetObjectName\(([a-zA-Z0-9_-]+(?:\(\))?)\)/, `LoadStringBJ(GetUnitTypeId($1), 0, udg_RFObjectName)`);

  // Readability
  jassCode = jassCode.replace(/call MMD_DefineValue\(([^\n]+), 101, 101, 103 \)/g, `call MMD_DefineValue($1, MMD_TYPE_STRING, MMD_GOAL_NONE, MMD_SUGGEST_LEADERBOARD)`);
  jassCode = jassCode.replace(/call MMD_FlagPlayer\(([^\n]+ = )101\)/g, `call MMD_FlagPlayer($1MMD_FLAG_DRAWER)`);
	jassCode = jassCode.replace(/call MMD_FlagPlayer\(([^\n]+ = )102\)/g, `call MMD_FlagPlayer($1MMD_FLAG_LOSER)`);
  jassCode = jassCode.replace(/call MMD_FlagPlayer\(([^\n]+ = )103\)/g, `call MMD_FlagPlayer($1MMD_FLAG_WINNER)`);
  jassCode = jassCode.replace(/call MMD_FlagPlayer\(([^\n]+ = )104\)/g, `call MMD_FlagPlayer($1MMD_FLAG_LEAVER)`);

	/*
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
	*/

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

function mergeMaxPlayers(mergedCode) {
  mergedCode = mergedCode.replace(/(integer\s+udg_RFMaxPlayerIndex\s*=\s*)0/, `$1bj_MAX_PLAYERS`);
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

function insertMMDGlobals(mergedCode, main, config) {
	let index = mergedCode.indexOf('endglobals');
  let globalsText = (
`//globals from MMD
constant boolean LIBRARY_MMD=true
constant integer MMD_GOAL_NONE= 101
constant integer MMD_GOAL_HIGH= 102
constant integer MMD_GOAL_LOW= 103
        
constant integer MMD_TYPE_STRING= 101
constant integer MMD_TYPE_REAL= 102
constant integer MMD_TYPE_INT= 103

constant integer MMD_OP_ADD= 101
constant integer MMD_OP_SUB= 102
constant integer MMD_OP_SET= 103

constant integer MMD_SUGGEST_NONE= 101
constant integer MMD_SUGGEST_TRACK= 102
constant integer MMD_SUGGEST_LEADERBOARD= 103

constant integer MMD_FLAG_DRAWER= 101
constant integer MMD_FLAG_LOSER= 102
constant integer MMD_FLAG_WINNER= 103
constant integer MMD_FLAG_LEAVER= 104
constant integer MMD_FLAG_PRACTICING= 105
constant boolean MMD__SHOW_DEBUG_MESSAGES= true
        
constant string MMD__chars= "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-+= \\\\!@#$%^&*()/?>.<,;:'\\"{}[]|\`~"
constant integer MMD__num_chars= StringLength(MMD__chars)
string array MMD__flags
string array MMD__goals
string array MMD__ops
string array MMD__types
string array MMD__suggestions
boolean MMD__initialized= false
                
gamecache MMD__gc= null
constant string MMD__ESCAPED_CHARS= " \\\\"
        
constant integer MMD__CURRENT_VERSION= 1
constant integer MMD__MINIMUM_PARSER_VERSION= 1
constant string MMD__FILENAME= "MMD.Dat"
constant string MMD__M_KEY_VAL= "val:"
constant string MMD__M_KEY_CHK= "chk:"
constant integer MMD__NUM_SENDERS_NAIVE= 1
constant integer MMD__NUM_SENDERS_SAFE= 1
integer MMD__num_senders= MMD__NUM_SENDERS_NAIVE
integer MMD__num_msg= 0
        
timer MMD__clock= CreateTimer()
string array MMD__q_msg
real array MMD__q_time
integer array MMD__q_index
integer MMD__q_head= 0
integer MMD__q_tail= 0
//endglobals from MMD

trigger l__library_init

//JASSHelper struct globals:
constant integer si__MMD__QueueNode=1
integer si__MMD__QueueNode_F=0
integer si__MMD__QueueNode_I=0
integer array si__MMD__QueueNode_V
real array s__MMD__QueueNode_timeout
string array s__MMD__QueueNode_msg
integer array s__MMD__QueueNode_checksum
string array s__MMD__QueueNode_key
integer array s__MMD__QueueNode_next
trigger st__MMD__QueueNode_onDestroy
integer f__arg_this
`
  );

  for (let line of globalsText.split(/[\r\n]/)) {
    if (!(line = line.trim())) continue;
    let addedString = ' '.repeat(4) + line + '\r\n';
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
	insertMMDLibrary,
	insertMMDGlobals,
	insertMMDDeps,
	lintJass,
	removeDeadCode,
	mergeGlobals,
	mergeMaxPlayers,
	mergeInitialization,
};
