import ipvfs from "../index.js";
import {create} from "ipfs";
import {all} from "@anywhichway/all";

let ipfs = await ipvfs(create({repo:"hackernoon-filestore"}));

await ipfs.files.write("/hello-world.txt","hello there peter!",{create:true});
// log contents
console.log((await all(ipfs.files.read("/hello-world.txt"))).toString());
await ipfs.files.write("/hello-world.txt","hello there paul!",{create:true});
// log new contents, but access to the old version is not available
console.log((await all(ipfs.files.read("/hello-world.txt"))).toString());

await ipfs.files.versioned.write("/hello-world-versioned.txt","hello there peter!");
// log contents
console.log(await ipfs.files.versioned.read("/hello-world-versioned.txt",{all:true}));
await ipfs.files.versioned.write("/hello-world-versioned.txt","hello there paul!");
// log new contents
console.log(await ipfs.files.versioned.read("/hello-world-versioned.txt",{all:true}));
// log first version contents
console.log(await ipfs.files.versioned.read("/hello-world-versioned.txt#1",{all:true}));

await ipfs.files.versioned.write("/hello-world-versioned.txt","hello there mary!",{metadata:{version:"Mary Version"}});
console.log(await ipfs.files.versioned.read("/hello-world-versioned.txt@Mary Version",{all:true}));

console.log(await ipfs.files.versioned.read("/hello-world-versioned.txt",{all:true,withHistory:true}));





