const readline = require("readline");
const util = require("util");
const path = require("path");
const zlib = require("zlib");
const gzip = util.promisify(zlib.gzip);
const deflate = util.promisify(zlib.deflate);
const inflate = util.promisify(zlib.inflate);
const fs = require("fs").promises;
const crypto = require("crypto");
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});
const question = function(msg){return new Promise(function(resolve){
	rl.question(msg,function(inp){resolve(inp);});
});};

async function raw2xsd(raw,pwd){
	let gzipped=await deflate(raw);
	let cipher = crypto.createCipher("aes256",pwd);
	return Buffer.concat([cipher.update(gzipped),cipher.final()]);
}
async function xsd2raw(xsd,pwd){
	let decipher = crypto.createDecipher("aes256",pwd);
	let gzipped = Buffer.concat([decipher.update(xsd),decipher.final()]);
	return await inflate(gzipped);
}

async function scanFiles(dir){
	let r=[];
	for(let fn of await fs.readdir(dir)){
		let fullpath=path.join(dir,fn);
		let stat=await fs.stat(fullpath);
		if(fullpath===".git")continue;
		if(fullpath==="xsd.js")continue;
		if(fullpath==="schema.xsd")continue;
		if(fullpath==="schemas")continue;
		if(stat.isDirectory()){
			r=r.concat(await scanFiles(fullpath));
		}else{
			r.push(fullpath);
		}
	}
	return r;
}
function genId(c){
	return [...new Array(12)].map(c=>(~~(Math.random()*16)).toString(16)).join("")+(c.match(/\.[^.]+$/)?".xsd":"");
}
async function copyFile(s,d,pwd,isXSD){
	let d2=d.split(path.sep).slice(0,-1);
	d2=d2.map((_,n)=>d2.slice(0,n+1).join(path.sep));
	for(let dn of d2){
		try{
			await fs.stat(dn);
		}catch(e){
			await fs.mkdir(dn);
		}
	}
	if(pwd){
		let raw=await fs.readFile(s);
		let des;
		if(isXSD){
			des=await xsd2raw(raw,pwd);
		}else{
			des=await raw2xsd(raw,pwd);
		}
		fs.writeFile(d,des);
	}else{
		await fs.copyFile(s,d);
	}
}
async function InitEncrypted(){
	let pwd=await question("input  : ");
	{
		let c_pwd=await question("confirm: ");
		if(pwd!==c_pwd){
			console.log("unmatched.");
			process.exit();
		}
	}
	rl.close();
	let files=await scanFiles(".");
	let eidx=new Map();
	files=files.map(c=>[
		c,
		c.split(path.sep).map(c=>
			eidx.has(c)?eidx.get(c):eidx.set(c,genId(c)).get(c)
		).join(path.sep)
	]);
	for(let [rawfp,newfp] of files){
		await copyFile(rawfp,path.join("schemas",newfp),pwd);
	}
	let meta_raw=Buffer.from(JSON.stringify([...eidx]));
	let meta_xsd=await raw2xsd(meta_raw,pwd);
	await fs.writeFile("schema.xsd",meta_xsd);
}
async function InitDecrypted(){
	let pwd;
	let schema;
	while(1){
		pwd=await question("pwd: ");
		try{
			schema=await xsd2raw(await fs.readFile("schema.xsd"),pwd);
			schema=JSON.parse(schema.toString());
			break;
		}catch(e){
			console.log(e);
		}
	}
	let files=await scanFiles("./schemas");
	let eidx=new Map(schema.map(c=>[c[1],c[0]]));
	files=files.map(c=>[
		c,
		c.split(path.sep).slice(1).map(c=>
			eidx.has(c)?eidx.get(c):"???"
		).join(path.sep)
	]);
	for(let [rawfp,newfp] of files){console.log(rawfp,newfp);
		await copyFile(rawfp,newfp,pwd,true);
	}
	rl.close();
}

(async function(){
	console.log(process.cwd());
	try{
		await fs.stat("./schemas");
		await InitDecrypted();
	}catch(e){
		await InitEncrypted();
	}
})();