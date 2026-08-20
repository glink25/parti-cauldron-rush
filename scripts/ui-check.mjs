import { readFileSync } from 'node:fs';

const css = readFileSync('src/ui/style.css', 'utf8');
const ui = readFileSync('src/ui/main.ts', 'utf8');
const required = [
  ['desktop workspace gets remaining viewport', '.workspace{min-height:0;display:grid'],
  ['desktop opponent list scrolls', '.opponent-scroll{height:calc(100% - 46px);overflow:auto'],
  ['desktop command body scrolls', '.command-body{min-height:0;overflow:auto'],
  ['mobile has one main scroll container', '.workspace{display:flex;flex-direction:column;overflow-y:auto'],
  ['mobile command is first', '.command{order:1'],
  ['mobile board is second', '.board{order:2'],
  ['mobile opponents are third', '.opponents{order:3'],
  ['mobile command avoids nested scrolling', '.command-body{overflow:visible}'],
  ['safe area reserves Parti host controls', 'padding-right:max(72px,env(safe-area-inset-right,0px))'],
  ['short desktop viewport compacts UI', '@media(max-height:620px) and (min-width:821px)'],
  ['reduced motion supported', '@media(prefers-reduced-motion:reduce)'],
  ['UI mounts stable shell instead of replacing whole app every snapshot', 'function ensureShell()'],
  ['board updates in place', "document.querySelector('#board')"],
  ['command updates in place', "document.querySelector('#command')"],
];

let failed = false;
for (const [label, needle] of required) {
  const ok = (needle.startsWith('function') || needle.includes('querySelector')) ? ui.includes(needle) : css.includes(needle);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
