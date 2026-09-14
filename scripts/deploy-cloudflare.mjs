import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {readFileSync,existsSync} from 'node:fs';
const require=createRequire(import.meta.url);
const wrangler=resolve(dirname(require.resolve('wrangler/package.json')),'bin/wrangler.js');
const redirect=resolve('.wrangler/deploy/config.json');
if(!existsSync(redirect))throw new Error('Build first: npm run build');
const config=resolve(dirname(redirect),JSON.parse(readFileSync(redirect,'utf8')).configPath);
for(const args of [ ['d1','migrations','apply','DB','--remote','--config',config], ['deploy','--config',config] ]){
 const result=spawnSync(process.execPath,[wrangler,...args],{stdio:'inherit',env:process.env});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
}
