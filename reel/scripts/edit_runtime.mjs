// TypeScript loading for schema/catalog tools; no Remotion bundling or child processes.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
export const require=createRequire(import.meta.url);
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);
export const {registry}=require('../src/edit/registry.ts');
export const {editSchema}=require('../src/edit/schema.ts');
export const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
