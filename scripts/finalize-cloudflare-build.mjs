import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,resolve,relative} from 'node:path';
const redirect=resolve('.wrangler/deploy/config.json');
const config=resolve(dirname(redirect),JSON.parse(readFileSync(redirect,'utf8')).configPath);
const built=JSON.parse(readFileSync(config,'utf8'));
// Wrangler interprets migration paths relative to the generated config directory.
for(const database of built.d1_databases??[]){
 const migrations=resolve('drizzle');
 if(!existsSync(migrations))throw new Error('Missing database migrations');
 database.migrations_dir=relative(dirname(config),migrations).split('\\').join('/');
}
writeFileSync(config,JSON.stringify(built,null,2)+'\n');
console.log('Cloudflare build ready with database migrations.');
