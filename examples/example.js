import ipvfs from "../index.js";
import {create} from "ipfs";
import {all} from "@anywhichway/all";

const ipfs = await ipvfs(create({repo:"demo-filestore"})); // create an ipfs instance and enhance it to use ipvfs
// use standard ipfs file function rm to remove the file
try {
    await ipfs.files.rm("/hello-world.txt");
} catch(e) {

}
// use the versioned forms of write and read
console.log(await ipfs.files.versioned.write("/hello-world.txt","hello there peter!")); // returns undefined just like regular version
console.log(await ipfs.files.versioned.read("/hello-world.txt#1",{all:true}));
//console.log(await ipfs.files.versioned.read("/hello-world.txt#1",{all:true})); // returns the contents as a single item, i.e. all chunks combined
try {
    console.log(await ipfs.files.versioned.read("/hello-world.txt#2",{all:true})); // throws since there is no version 2
} catch(e) {
    console.log(e)
}
await ipfs.files.versioned.write("/hello-world.txt","hello there paul!");
// logs the second version of the file
console.log(await ipfs.files.versioned.read("/hello-world.txt#2",{all:true}),"=  hello there paul!");
// logs the same thing as the above, since version 2 is the most recent
console.log(await ipfs.files.versioned.read("/hello-world.txt",{all:true}));
await ipfs.files.versioned.write("/hello-world.txt","hello there mary!");
for await(const chunk of await ipfs.files.versioned.read("/hello-world.txt#3")) { // returns a generator for chunks of the file as Buffers or strings
    console.log(chunk);
}
console.log((await all(ipfs.files.versioned.read("/hello-world.txt#3"))).join(""),"= hello there mary!")
// see documentation for withMetadata, withHistory, withRoot
console.log(await ipfs.files.versioned.read("/hello-world.txt",{all:true,withMetadata:true,withHistory:true,withRoot:true}));
// standard ipfs file read returns an array of transforms and metadata, the first item of which has a path (CID) of the original content
console.log(String.fromCharCode(...await ipvfs.chunksToBuffer(all(ipfs.files.read("/hello-world.txt")))));
// rebase to paul
await ipfs.files.versioned.rebase("/hello-world.txt#2");
// version 1 is now paul
console.log(await ipfs.files.versioned.read("/hello-world.txt#1",{all:true}),"= hello there paul!");
// version 2 is now mary
console.log(await ipfs.files.versioned.read("/hello-world.txt#2",{all:true}),"= hello there mary!");
// force base to peter
await ipfs.files.versioned.write("/hello-world.txt","hello there peter!",{asBase:true});
// standard ipfs file read shows a history with no changes, just a rebase to peter
console.log(String.fromCharCode(...await ipvfs.chunksToBuffer(all(ipfs.files.read("/hello-world.txt")))));

// write a JSON object
await ipfs.files.versioned.write("/hello-world.txt",{message:"hello there paul!"});
// all is not required, it is implicit for objects
console.log(await ipfs.files.versioned.read("/hello-world.txt"));

// create large content
const text = "".padStart(1024,"a");
// update existing file to large content
await ipfs.files.versioned.write("/hello-world.txt",text);
// make a lot of changes
let content = [...await ipfs.files.versioned.read("/hello-world.txt",{all:true})];
for(let i=0;i<50;i++) {
    const random = Math.round(Math.random()*1000);
    content[random] = "b";
    if(random % 2 === 0) {
        content = content.reverse()
    } else {
        content = [...content,..."".padStart(1024,"c").split("")];
    }
    await ipfs.files.versioned.write("/hello-world.txt",content.join(""));
}
let i=0;
for await(const chunk of await ipfs.files.versioned.read("/hello-world.txt")) { // returns a generator for chunks of the file as Buffers or strings
   i++
}
console.log(i,"chunks in updated large file");
// standard ipfs file read returns an array of transforms and metadata, the first item of which has a path (CID) of the original content
console.log(String.fromCharCode(...await ipvfs.chunksToBuffer(all(ipfs.files.read("/hello-world.txt")))));
let start = Date.now();
let finalcontent = await ipfs.files.versioned.read("/hello-world.txt",{all:true});
let finish = Date.now();
console.log((finish-start)+"ms read large file with many changes",finalcontent.length,text.length,content.join("")==finalcontent,finalcontent.includes("b"));
try {
    await ipfs.files.rm("/large-file.txt");
} catch(e) {

}
await ipfs.files.versioned.write("/large-file.txt",finalcontent);
start = Date.now();
finalcontent = await ipfs.files.versioned.read("/large-file.txt",{all:true});
finish = Date.now();
console.log((finish-start)+"ms read large file with no changes",finalcontent.length,text.length,content.join("")==finalcontent,finalcontent.includes("b"));
