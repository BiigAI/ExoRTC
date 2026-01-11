const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const srcDir = path.join(rootDir, 'src');

console.log('Building for production...');

// 1. Clean dist
if (fs.existsSync(distDir)) {
    console.log('Cleaning dist...');
    fs.rmSync(distDir, { recursive: true, force: true });
}

// 2. Run TSC
console.log('Compiling TypeScript...');
try {
    execSync('tsc', { cwd: rootDir, stdio: 'inherit' });
} catch (error) {
    console.error('TypeScript compilation failed.');
    process.exit(1);
}

// 3. Copy Assets
console.log('Copying assets...');
function copyRecursive(src, dest) {
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        fs.readdirSync(src).forEach(childItemName => {
            copyRecursive(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        // Filter: Only copy non-ts files
        if (!src.endsWith('.ts') && !src.endsWith('.tsx')) {
            // Create parent dir if not exists
            const destDir = path.dirname(dest);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }
            fs.copyFileSync(src, dest);
        }
    }
}

// Copy renderer assets (HTML, CSS, Images)
// We assume tsc outputs JS to dist/, so we overlay assets
copyRecursive(path.join(srcDir, 'renderer'), path.join(distDir, 'renderer'));

console.log('Build complete!');
