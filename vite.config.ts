import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {uiLanguagePlugin} from './scripts/ui-language-plugin';
export default defineConfig({plugins:[uiLanguagePlugin(),react()],server:{host:'127.0.0.1',port:4317,strictPort:true,proxy:{'/api':'http://127.0.0.1:4318'}},build:{sourcemap:true}});
