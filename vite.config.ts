import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'path';
import fs from 'fs';
import path from 'path';

// ビルド後にappsscript.jsonをコピーする関数
const copyAppScriptManifest = () => {
  return {
    name: 'copy-appsscript-manifest',
    closeBundle: async () => {
      const srcPath = resolve(__dirname, 'src/appsscript.json');
      const destPath = resolve(__dirname, 'dist/appsscript.json');
      
      // ファイルが存在するか確認
      if (fs.existsSync(srcPath)) {
        // distディレクトリがなければ作成
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        
        // ファイルをコピー
        fs.copyFileSync(srcPath, destPath);
        console.log('✓ appsscript.json copied to dist/');
      } else {
        console.error('✗ src/appsscript.json not found!');
      }
    }
  };
};

export default defineConfig({
  plugins: [
    viteSingleFile(),
    copyAppScriptManifest() // カスタムプラグインを追加
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/main.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'main.js'
      }
    }
  }
});