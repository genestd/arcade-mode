#! /usr/bin/env node

/* A script for converting javascript challenge code into JSON.
  * Each challenge should have sections marked with comments '/// keyword:',
  * For example:
  *   /// solution:
  *   function MySolution()...
  *
  *   /// tests:
  *   assert(MySolution(2) === 3)...
  *
  * */

// TODO: fix script to remove empty string at end of the last property (i.e., test),
// otherwise an empty test case is added which is problematic.

const commandLineArgs = require('command-line-args');
const fs = require('fs');
const acorn = require('acorn');
const mongoose = require('mongoose');

const optionDefinitions = [
  { name: 'force', type: Boolean, descr: 'Overwrite output files forcefully.' },
  { name: 'help', alias: 'h', type: Boolean, descr: 'Print help message' },
  { name: 'infile', alias: 'f', type: String, multiple: true, descr: 'Input files' },
  { name: 'outfile', alias: 'o', type: String, descr: 'Output JSON file' },
  { name: 'verbose', alias: 'v', type: Boolean, descr: 'Run in verbose mode' }
];

// Regexp definitions for the script
const re = {
  lineComment: /^\/\/\//,
  lineCommentStartsWithProp: /^\/\/\/\s+(\w+):/,
  lineCommentWithProp: /^\/\/\/\s+(\w+):\s*$/,
  lineCommentWithPropAndText: /^\/\/\/\s+(\w+):\s*(\S.*)$/,
  lineCommentWithText: /^\/\/\/\s(.*)$/,
  endComment: /^\/\/\/\s+end\s+$/,
  workInProgress: /^\/\/\/\s+WIP/i
};

const opts = commandLineArgs(optionDefinitions);

if (opts.help) {
  usage(0);
}

const expectedProps = {
  title: String,
  type: String,
  description: String,
  challengeSeed: 'Code',
  solutions: 'Code',
  tests: 'Code'
};

const optionalProps = {
  difficulty: Number,
  benchmark: 'Code',
  categories: String,
  head: 'Code',
  tail: 'Code',
  images: String,
  naive: 'Code',
  id: String
};

const allProps = Object.assign({}, expectedProps, optionalProps);

if (!opts.infile || opts.infile.length === 0) {
  console.error('Error. No input files were given.');
  usage(1);
}

const propParser = {
  state: 'IDLE',
  currFile: null,
  prop: null,
  propValue: [],
  files: {},
  continuedComments: false
};

opts.infile.forEach(file => {
  processFile(propParser, file, expectedProps);
});

const result = formatResult(propParser.files);

printToOutput(result);

//---------------------------------------------------------------------------
// HELPER FUNCTIONS
//---------------------------------------------------------------------------

function processFile(parser, file, props) {
  const buffer = fs.readFileSync(file);
  parser.currFile = file;
  checkFileSyntax(buffer);

  const lines = buffer.toString().split('\n');
  if (!workInProgress(lines)) {
    parser.files[file] = {};
    lines.forEach(line => {
      processLine(parser, line);
    });

    if (parser.propValue.length > 0) {
      finishCurrProp(parser);
    }

    verifyExpectedProps(parser, file, props);
  }
  else {
    console.log('Skipping WIP file ' + file);
  }
}

/* Checks the code syntax in given buffer using acorn. */
function checkFileSyntax(buffer) {
  try {
    acorn.parse(buffer);
  }
  catch (err) {
    console.error(`Parsing failed: ${err}`);
    process.exit(1);
  }
}

/* Processes one line with regex and extracts prop values. */
function processLine(parser, line) {
  if (parser.continuedComments && !re.lineComment.test(line)) {
    finishCurrProp(parser);
    return;
  }
  parser.continuedComments = false;

  let propLegal = false;
  if (re.lineCommentStartsWithProp.test(line)) {
    const matches = line.match(re.lineCommentStartsWithProp);
    propLegal = isPropLegal(matches[1]);
  }

  if (propLegal && re.lineCommentWithProp.test(line)) {
    const matches = line.match(re.lineCommentWithProp);
    if (parser.prop !== null) {
      finishCurrProp(parser);
    }
    parser.prop = matches[1];
  }
  else if (propLegal && re.lineCommentWithPropAndText.test(line)) {
    const matches = line.match(re.lineCommentWithPropAndText);
    if (parser.prop !== null) {
      finishCurrProp(parser);
    }
    parser.prop = matches[1];
    parser.propValue.push(matches[2]);
    finishCurrProp(parser);
  }
  else if (re.lineCommentWithText.test(line)) {
    const matches = line.match(re.lineCommentWithText);
    parser.propValue.push(matches[1]);
    parser.continuedComments = true;
  }
  else if (re.endComment.test(line)) {
    finishCurrProp(parser);
  }
  else if (parser.prop !== null) {
    parser.propValue.push(line);
    // if prop is solutions, combine strings into one string with newline
    if (parser.prop === 'solutions' || parser.prop === 'naive') {
      if (parser.propValue.length > 1) {
        parser.propValue = [parser.propValue.join('\n')];
      }
    }
  }
}

/* Adds current property value into the parser for the current file being processed. Resets
 * the prop value after this. */
function finishCurrProp(parser) {
  // shave off ending empty string from arrays:
  if (parser.propValue.slice(-1).toString() === '') {
    parser.propValue.splice(-1);
  }

  let newPropVal;

  // keep solutions string in an array
  if (parser.prop === 'solutions') {
    newPropVal = parser.propValue;
  }
  else if (parser.propValue.length === 1) {
    newPropVal = parser.propValue[0] || parser.propValue;
  }
  else newPropVal = parser.propValue;

  if (typeof parser.files[parser.currFile][parser.prop] === 'undefined') {
    parser.files[parser.currFile][parser.prop] = newPropVal;
    parser.files[parser.currFile][parser.prop].num = 1;
  }
  else if (typeof parser.files[parser.currFile][parser.prop] === 'string') {
    const oldValue = parser.files[parser.currFile][parser.prop];
    parser.files[parser.currFile][parser.prop] = [oldValue, newPropVal];
    parser.files[parser.currFile][parser.prop].num = 2;
  }
  else if (typeof parser.files[parser.currFile][parser.prop] === 'object') {
    if (parser.files[parser.currFile][parser.prop].num === 1) {
      // Need to wrap the value in an array first.
      parser.files[parser.currFile][parser.prop] = [
        parser.files[parser.currFile][parser.prop],
        newPropVal
      ];
      parser.files[parser.currFile][parser.prop].num = 2;
    }
    else {
      parser.files[parser.currFile][parser.prop].push(newPropVal);
      parser.files[parser.currFile][parser.prop].num += 1;
    }
  }

  parser.propValue = [];
  parser.prop = null;
}

/* Verifies that the parsed file contains expected props like 'solution' etc.*/
function verifyExpectedProps(parser, file, props) {
  Object.keys(props).forEach(prop => {
    if (parser.files[file][prop] === undefined) {
      console.warn(`Prop ${prop} missing from file ${file}`);
    }

    // Add unique IDs to files, unless they already exist
    if (!parser.files[file].id) {
      const id = mongoose.Types.ObjectId();
      parser.files[file].id = id;
      fs.appendFileSync(file, `/// id: ${id}\n`);
    }
  });
}

/* Formats the result as JSON. */
function formatResult(parsedFiles) {
  const challenges = Object.keys(parsedFiles).map(filename =>
    parsedFiles[filename]
  );

  const finalFormat = {
    name: 'ArcadeMode Interview Questions',
    order: '',
    time: '',
    helpRoom: '',
    challenges
  };

  return JSON.stringify(finalFormat, null, 2);
}

/* Prints the results to given output file. */
function printToOutput (res) {
  if (opts.outfile) {
    if (!fs.existsSync(opts.outfile) || opts.force) {
      fs.writeFileSync(opts.outfile, res);
    }
  }
  else {
    console.log(res);
  }
}

/* Prints the usage of the script and exits. */
function usage(exitCode = 0) {
  console.log('Usage: bin/js2json_challenges.js [opts] -f <files>+\n');
  optionDefinitions.forEach(opt => {
    if (opt.alias) {
      console.log(`\t--${opt.name},-${opt.alias}\t- ${opt.descr}`);
    }
    else {
      console.log(`\t--${opt.name}\t\t- ${opt.descr}`);
    }
  });
  process.exit(exitCode);
}

function isPropLegal(propName) {
  return allProps.hasOwnProperty(propName);
}

function workInProgress(lines) {
  let wip = false;
  lines.forEach(line => {
    if (line.match(re.workInProgress)) {
      wip = true;
    }
  });
  return wip;
}

