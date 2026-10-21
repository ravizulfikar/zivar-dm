import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(project, '.tools', 'builder-cache');
const nsisRoot = path.join(cache, 'nsis-3.0.4.1');
const nsis = path.join(nsisRoot, (await fs.readdir(nsisRoot)).find(name => name.startsWith('nsis-')));
const resourceRoot = path.join(cache, 'nsis-resources-3.4.1');
const resources = path.join(resourceRoot, (await fs.readdir(resourceRoot)).find(name => name.startsWith('nsis-resources-')));
const nsi = path.join(project, '.tools', 'tutorial-check.nsi');
const nsisPath = input => input;
const script = [
  'Unicode true',
  '!include "MUI2.nsh"',
  `!include "${nsisPath(path.join(project, 'node_modules/app-builder-lib/templates/nsis/include/StdUtils.nsh'))}"`,
  `!addplugindir /x86-unicode "${nsisPath(path.join(resources, 'plugins/x86-unicode'))}"`,
  'Name "ZIVAR Tutorial Compile Check"',
  `OutFile "${nsisPath(path.join(project, '.tools/tutorial-check.exe'))}"`,
  'Var launchLink',
  `!include "${nsisPath(path.join(project, 'desktop/installer.nsh'))}"`,
  '!insertmacro MUI_PAGE_INSTFILES',
  '!insertmacro customFinishPage',
  '!insertmacro MUI_LANGUAGE "English"',
  'Section',
  'SectionEnd',
].join('\n');
await fs.writeFile(nsi, script);
const result = spawnSync(path.join(nsis, 'makensis.exe'), ['-V2', nsi], { windowsHide: true, encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stdout + result.stderr);
console.log('PASS: NSIS tutorial page and finish-page launch compile successfully.');
