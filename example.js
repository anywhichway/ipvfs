import ipvfs from "./index.js";
import {create} from "ipfs";
import {all} from "@anywhichway/all";

const ipfs = await ipvfs(create({repo:"demo-filestore"})); // create an ipfs instance and enhance it to use ipvfs
// use standard ipfs file function rm to remove the file
try {
    await ipfs.files.rm("/hello-world.txt");
} catch(e) {

}
// use the versioned forms of write and read
console.log(await ipfs.files.versioned.write("/hello-world.txt","hello there jake!")); // returns undefined just like regular version
console.log(await ipfs.files.versioned.read("/hello-world.txt#1")); // unlike the regular version, returns the contents
try {
    console.log(await ipfs.files.versioned.read("/hello-world.txt#2")); // throws since there is no version 2
} catch(e) {
    console.log(e)
}
await ipfs.files.versioned.write("/hello-world.txt","hello there bill!");
// logs the second version of the file
console.log(await ipfs.files.versioned.read("/hello-world.txt#2"));
// logs the same thing as the above, since version 2 is the most recent
console.log(await ipfs.files.versioned.read("/hello-world.txt"));
// see documentation for withMetadata, withHistory, withRoot
console.log(await ipfs.files.versioned.read("/hello-world.txt",{withMetadata:true,withHistory:true,withRoot:true}));
// standard ipfs file read returns an array of transforms and metadata, the first item of which has a path (CID) of the original content
console.log(JSON.parse(String.fromCharCode(...await ipvfs.chunksToBuffer(all(ipfs.files.read("/hello-world.txt"))))));
