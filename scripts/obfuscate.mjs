/**
 * Vercel build: istemci JS'ini yerinde obfuscate eder.
 * Kaynak git'te okunabilir kalır. Yerelde çalışmaz (OBFUSCATE=1 gerekir).
 * api/*.js dokunulmaz (Node serverless).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const root = path.resolve(rootIdx >= 0 && args[rootIdx + 1]
  ? args[rootIdx + 1]
  : path.join(__dirname, '..'));

if (!process.env.VERCEL && process.env.OBFUSCATE !== '1') {
  console.log('obfuscate: skipped (Vercel veya OBFUSCATE=1)');
  process.exit(0);
}

function looksObfuscated(src) {
  const head = String(src).slice(0, 200);
  return /function _0x[0-9a-f]+\(/.test(head) || /var _0x[0-9a-f]+=/.test(head);
}

const OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.35,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: false,
  renameGlobals: false,
  renameProperties: false,
  reservedNames: [
    'DOLAP_SUPABASE',
    'DOLAP_ASSETS',
    'DolapDealer',
    'calculateQuote',
    'supabase',
    'jspdf',
    'jsPDF',
    'html2canvas',
    'XLSX'
  ],
  selfDefending: true,
  simplify: true,
  splitStrings: false,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayThreshold: 0.75,
  target: 'browser',
  unicodeEscapeSequence: false
};

function matchBrace(src, openIdx) {
  if (src[openIdx] !== '{') throw new Error('matchBrace: expected {');
  let depth = 0;
  let inStr = null;
  let escape = false;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length - 1 : nl;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length - 1 : end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error('matchBrace: unbalanced');
}

function splitAssets(js) {
  const marker = 'const ASSETS = {';
  const idx = js.indexOf(marker);
  if (idx === -1) return { prelude: '', rest: js };
  const braceStart = idx + marker.length - 1;
  const braceEnd = matchBrace(js, braceStart);
  const obj = js.slice(braceStart, braceEnd + 1);
  const rest = js.slice(0, idx) + 'const ASSETS = window.DOLAP_ASSETS' + js.slice(braceEnd + 1);
  return { prelude: 'window.DOLAP_ASSETS=' + obj + ';\n', rest };
}

function obfuscateCode(code) {
  return JavaScriptObfuscator.obfuscate(code, OPTIONS).getObfuscatedCode();
}

function processJsFile(rel) {
  const file = path.join(root, rel);
  const src = fs.readFileSync(file, 'utf8');
  if (looksObfuscated(src)) {
    throw new Error(rel + ' already obfuscated — abort');
  }
  const out = obfuscateCode(src);
  fs.writeFileSync(file, out);
  console.log('obfuscated', rel, src.length, '->', out.length);
}

function processHtmlFile(rel) {
  const file = path.join(root, rel);
  const html = fs.readFileSync(file, 'utf8');
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let out = '';
  let last = 0;
  let m;
  let count = 0;
  while ((m = re.exec(html)) !== null) {
    out += html.slice(last, m.index);
    const attrs = m[1] || '';
    const code = m[2];
    if (/\bsrc\s*=/.test(attrs) || !String(code).trim()) {
      out += m[0];
    } else {
      if (looksObfuscated(code)) {
        throw new Error(rel + ' inline script already obfuscated — abort');
      }
      const { prelude, rest } = splitAssets(code);
      const obf = obfuscateCode(rest);
      if (prelude) {
        out += `<script${attrs}>${prelude}</script><script${attrs}>${obf}</script>`;
      } else {
        out += `<script${attrs}>${obf}</script>`;
      }
      count++;
      console.log('obfuscated inline', rel, '#' + count, rest.length, '->', obf.length);
    }
    last = m.index + m[0].length;
  }
  out += html.slice(last);
  fs.writeFileSync(file, out);
}

processJsFile('js/supabase-config.js');
processJsFile('js/dealer-session.js');
processHtmlFile('index.html');
processHtmlFile('admin/index.html');
console.log('obfuscate: done');
