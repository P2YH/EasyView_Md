// Loaded by VS Code as --extensionTestsPath: runs the e2e/*.test.js suites inside the extension host.
const fs = require('node:fs');
const path = require('node:path');
const Mocha = require('mocha');

exports.run = function run() {
  const mocha = new Mocha({ ui: 'tdd', timeout: 45_000, color: true });
  const directory = path.resolve(__dirname, '..');
  for (const name of fs.readdirSync(directory).filter((file) => file.endsWith('.test.js')).sort()) {
    mocha.addFile(path.join(directory, name));
  }
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} extension-host test(s) failed`)) : resolve()));
  });
};
