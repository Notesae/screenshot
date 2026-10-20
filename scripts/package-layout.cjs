// 为清晰的根目录入口和 app 全量依赖生成整包清单，不改写 app 内的许可或来源证据。
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(process.argv[2]);
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const name of ['Screenshot.exe', '使用说明.txt', 'app/Screenshot.exe', 'app/SHA256SUMS.txt', 'app/web/index.html']) {
  if (!fs.statSync(path.join(root, name)).isFile()) throw new Error('Missing packaged file: ' + name);
}
// 只接受固定的顶层入口，避免把开发输出或用户文件误装入发行包。
const topLevel = fs.readdirSync(root).filter(name => name !== 'SHA256SUMS.txt').sort();
if (JSON.stringify(topLevel) !== JSON.stringify(['Screenshot.exe', 'app', '使用说明.txt'].sort())) throw new Error('Unexpected files at package root.');
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Package contains a link.');
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const files = walk(root).filter(file => file !== path.join(root, 'SHA256SUMS.txt')).sort();
const sums = files.map(file => digest(file) + '  ' + path.relative(root, file).replaceAll('\\', '/')).join('\n') + '\n';
if (process.argv.includes('--verify')) {
  if (fs.readFileSync(path.join(root, 'SHA256SUMS.txt'), 'utf8') !== sums) throw new Error('Package checksum coverage or content differs.');
} else fs.writeFileSync(path.join(root, 'SHA256SUMS.txt'), sums);
console.log(JSON.stringify({ layout: 'launcher-and-app', files: files.length + 1, entry: 'Screenshot.exe' }));
