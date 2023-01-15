# ipvfs (Interplanetary Versioned File System)
Creates and manages diff versioned files in an IPFS Mutable File System store.

# Goals

- A simple version management capability that can meet the needs of casual document authors when wrapped in a user interface. In short, provide the ability to track and retrieve old versions of files. Branching and merging are not an objective.
- Be efficient in time, space, and network utilization.

# Rationale

IPFS automatically versions files because it is content addressable, i.e. each file can be identified and retrieved based on a unique hash of its contents. The IPFS Mutable File System also supports the access of files through normal names; however, it does not keep a version history so that older versions can be reviewed or recovered. The Interplanetary Versioned File System (ipvfs) if layered on top of the IPFS Mutable File System to support version tracking.

There are other options and approaches for file version tracking with IPFS:

- (https://github.com/martindbp/ipvc)[Inter-Planetary Version Control (System)], which is not being actively developed.
- Use IPLD (IPFS Linked Data) as documented on (https://ethereum.stackexchange.com/questions/63109/ipfs-versioning-how-to-get-all-files-from-the-ipfs-key/63163#63163)[Stackexchange]

## Inter-Planetary Version Control (System)

In addition to not being actively developed, IPVC is based on a Git model of version control. Although this model is very powerful, it offers far more capability than a casual content author requires or is capable of using. The vast majority of authors just wish to keep old versions of files they can refer back to, branching, merging, committing, and rolling back are no generally things they understand. A more end user focused version management capability could be layered on top of a Git like API; however, since the project is not maintained and the goals of IPVFS are simpler, this approach was not taken.

## IPFS Linked Data Versioning

This approach is neither simple or space efficient. It requires creating and managing separate JSON metadata files to track version history. It duplicates the entirety of the modified original content. If just one character is changed in a 1 megabyte document, there will be two megabytes consumed on IPFS (not taking into consideration any sophisticated data compression that IPFS might do itself).

# Installation

```
npm install --save ipvfs
```

# Usage

```javascript
import ipvfs from "ipvfs";
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
```

# API

## async ipvfs(ipfs:ipfsInstance)

Enhance the `ipfs.files` sub-object to support versioned files with a sub-object  `ipfsInstance.files.versioned`.

returns `ipfs`

As a result, all other methods are available as `ipfs.files.versioned.<methodName>`.

## async versioned.read(path:string,{all,withMetadata,withHistory,withRoot}={})

Reads a versioned file and returns the changed contents as chunks of strings or buffers or an unchunked POJO (depending on content stored) unless `all` is set to true, in which can the entire content is returned at once. 

Note: If an JavaScript object was saved, then `all` is implicitly set to `true`. Regardless of the class of the saved object, it is returned as a POJO.

The path may end with one of:

- a file name with no version specifier (returns most recent version)
- a file name with a `#<number>` version number
- a file name with an `@<string>` version identifier

An object is returned if one of `withMetadata`, `withHistory`, `withRoot` is present. The returned object has the following form:

```javascript
{
    content: string|Buffer|Object|asyncGenerator, // file contents, asyncGenerator if `all` is not set to true
    metadata: {
            version: number|string, // if number it is the same as the index+1 in the history, otherwise manaully assigned string
            ... rest // key value metadata provided when the file was created or updated
        },
    history: [
           ...ChangeRecord
    ],
    root: ChangeRecord
}
```

A ChangeRecord takes the following form:

```javascript
{
    path: string // CID of the the base content, only exists in the first record of a change history,
    version: number|string // if number it is the same as the index+1 in the history, otherwise manaully assigned string
    kind: string // constructor name of original content provided,
    delta: [ // splice instructions
        [start,end,[...additions]] // start position, number items (chars or buffer positions to delete), items (chars or buffer entries) to insert (if any)
        ...
    ],
    btime: number, // ms time first contents were first created
    mtime: number // ms time update occured
    ...restOfMetadata // manual provided
}
```

## async versioned.publish(path:string,target:string=null)

Makes the provided version the published version. If a published version exists, it will be returned from `versioned.read` when no version is specified; however, the version is not changed when something is published, e.g. you can publish version 5 while working on version 10. 

The most important aspect of publishing is that the full content of the version is added to IPFS and a CID path is returned so the contents can be accessed directly via an IPFS gateway, i.e. `path` is a file path including a `#` version number or an `@` version identifier.

By default, the content is published to regular IPFS. The `target` argument is optional and if provided will be used as an IPFS Mutable File System path, so you can do things like `versioned.publish("/drafts/index.html#3","/www/index.html")`.

returns CID path

## async versioned.rebase(path:string,readOptions={},writeOptions={})

Makes the provided version be the base version. Preserves history that is after the new base. Renumbers numeric version numbers but leave string versions the same. Sets `mtime` on all subsequent versions in the preserved history to the time of the rebase. Adds a `rebased` array to the first change record. The rebased array has one entry for every time the file is rebased. Each entry is the version number and the time in milliseconds of the rebase.

`path` is a file path including a `#` version number or an `@` version identifier.

`readOptions` are the standard `ipfs.files.read` options.

`writeOptions` are the standard `ipfs.files.write` options;

returns undefined

## async versioned.write(path:string,content:string|Buffer|Object,{metadata={},asBase:boolean,...restOfOptions}={})

Writes a versioned file.

`{version,...restOfMetadata} = metadata`

`version` and `...restOfMetadata` are optional.

When `version` is provided, it should be a string. It can be retrieved using the `@` form of `read`. Semantic versioning, .e.g. `@1.0.1` is not required, but certainly possible. The calling library will need to handle the semantics. When a version is not provided, a sequential number is assigned that is the same as the history index position + 1. Previous versions can always be retrieved using the `#` from of `read`.

the `restOfMetadata` can be any JSON key value pairs, including nested ones.

If there are any changes to the `content`, `version` or `restOfMetadata` since the previous write a new `ChangeRecord` is added to the history. Leaving properties out of `restOfMetadata` has them remain the same. To delete a property, use an explicit value of `undefined` or `null`.

`asBase` instructs `ipvfs` to use the content as the base version. History is truncated. An array `rebased` is added to the first change record. See the function`rebase` for a description.

`restOfOptions` are the standard options for `ipfs.files.write`.

Note: Writing a new version with an Object as content is compatible with files that have previously held strings, but not with those that have held Buffers. Work to relax this constraint is in progress.

If the file at path does not exist, it is created.

returns undefined

# Testing

Testing is done with Jasmin and C8. We were unable to get native Node or Jest testing to work.

## Current Test Coverage

----------------|---------|----------|---------|---------|------------------------------------
File            | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s                  
----------------|---------|----------|---------|---------|------------------------------------
All files       |   98.21 |    84.78 |     100 |   98.21 |                                   
ipvfs          |   96.92 |    87.58 |     100 |   96.92 |                                   
index.js      |   96.92 |    87.58 |     100 |   96.92 | 15,133,140-145,153-154


# Release History (Reverse Chronological Order)

2023-01-14 v0.2.3b Enhanced `publish` to support writing to Mutable File System. Refined stress and performance testing. In the next release, the stress and performance testing will be extracted as (https://github.com/anywhichway/benchtest)[Benchtest] 3.0.0b.

2023-01-11 v0.2.2b Added some stress test capability to Jasmine testing. Removed `index.test.custom.js`.

2023-01-11 v0.2.1b Corrected `publish` to return CID path not CID object. Updated read tests to check the primary IPFS gateway for content as appropriate. Added some stress test capability to Jasmine testing. Removed `index.test.custom.js`.

2023-01-11 v0.2.0b Added `publish` function and ability to write with version in path as well as metadata option. More unit tests. Documentation reformatting and content updates.

2023-01-11 v0.1.5b Added more unit tests. Corrected a few unit tests that were written in a way they would always pass.

2023-01-10 v0.1.4b Got Jasmin and C8 working for testing. No longer using custom test harness. Code left in `index.test.custom.js` because it has some interesting performance and memory testing capabilities.

2023-01-10 v0.1.3b Added custom test harness and unit tests.

2023-01-07 v0.1.2b Started adding unit tests.

2023-01-07 v0.1.1b Removed more excess test data.

2023-01-07 v0.1.0b Removed some excess test data.

2023-01-07 v0.0.10a Added `rebase` and `asBase` capability. Added JSON save and restore capability. Updated docs. Functionally complete. Next version will be a BETA.

2023-01-06 v0.0.9a Updated docs. Implemented large file example, for which chunking works.

2023-01-05 v0.0.8a Updated docs.

2023-01-04 v0.0.7a Updated dependency versions for little-diff, arg-waiter, and @anywhichway/all.

2023-01-03 v0.0.6a Documentation updates. Passing of standard read/write options. Optimizations using SHA-256 hashes to compare content.

2023-01-02 v0.0.5a Documentation updates. Chunking working for small files (i.e. those that are a single chunk).

2023-01-02 v0.0.4a Documentation updates. Changed numbering to include the ALPHA (a) indicator.

2023-01-01 v0.0.3 Documentation updates.

2023-01-01 v0.0.2 Documentation updates. Fix to version handling when version does not exist and error throwing when provided # version is not a number.

2023-01-01 v0.0.1 Initial public release
