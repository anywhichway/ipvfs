import ipvfs from "./index.js";
import {create} from "ipfs";
import {all} from "@anywhichway/all";

const ipfs = await ipvfs(create({repo:"demo-filestore"}));

const text = "Hello world!";

try {
    //await ipfs.files.rm("/hello-world.txt");
} catch(e) {

}
//await ipfs.files.versioned.write("/hello-world.txt","Hello world!",{author:"Simon Y. Blackwell"});
//await ipfs.files.versioned.write("/hello-world.txt","hello there ann!",{author:"Simon Y. Blackwell"});
//await ipfs.files.versioned.write("/hello-world.txt","hello there bill!",{author:"Simon Y. Blackwell",version:"1.0.0"});
await ipfs.files.versioned.write("/hello-world.txt","hello there jabe!",{author:"Simon Y. Blackwell"});
console.log(await all(ipfs.files.ls('/')));
console.log(await ipfs.files.versioned.read("/hello-world.txt#1"));
console.log(await ipfs.files.versioned.read("/hello-world.txt#2"));
console.log(await ipfs.files.versioned.read("/hello-world.txt@1.0.0"));
console.log(await ipfs.files.versioned.read("/hello-world.txt",{withMetadata:true,withHistory:true,withRoot:true}));
