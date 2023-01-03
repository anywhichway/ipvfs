# ipvfs (Interplanetary Versioned File System)
Creates and manages diff versioned files in an IPFS Mutable File System store.

# Goals

- A simple version management capability that can meet the needs of casual users when wrapped in a user interface. In short, provide the ability to track and retrieve old versions of files.
- Be efficient in time and space

# Rationale

IPFS automatically versions files because it is content addressable, i.e. each file can be identified and retrieved based on a unique has of its contents. The IPFS Mutable File System also supports the access of files through normal names; however, it does not keep a version history so that older version can be reviewed or recovered. The Interplanetary Versioned File System (ipvfs) if layered on top of the IPFS Mutable File System to support version tracking.

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
const ipfs = await ipvfs(create({repo:"demo-filestore"})); // create an ipfs instance and enhance it to use ipvfs
// use standard ipfs file function rm to remove the file
try {
    await ipfs.files.rm("/hello-world.txt");
} catch(e) {

}
// use the versioned forms of write and read
console.log(await ipfs.files.versioned.write("/hello-world.txt","hello there peter!")); // returns undefined just like regular version
console.log(await ipfs.files.versioned.read("/hello-world.txt#1",{all:true})); // returns the contents as a single item, i.e. all chunks combined
try {
    console.log(await ipfs.files.versioned.read("/hello-world.txt#2",{all:true})); // throws since there is no version 2
} catch(e) {
    console.log(e)
}
await ipfs.files.versioned.write("/hello-world.txt","hello there paul!");
// logs the second version of the file
console.log(await ipfs.files.versioned.read("/hello-world.txt#2",{all:true}));
// logs the same thing as the above, since version 2 is the most recent
console.log(await ipfs.files.versioned.read("/hello-world.txt",{all:true}));
await ipfs.files.versioned.write("/hello-world.txt","hello there mary!");
// NOTE!! CHUNKING ONLY TESTED FOR SMALL FILES
for await(const chunk of await ipfs.files.versioned.read("/hello-world.txt#3")) { // returns a generator for chunks of the file as Buffers or strings
    console.log(chunk);
}
console.log((await all(ipfs.files.versioned.read("/hello-world.txt#3"))).join("")) // same as above but joined
// see documentation for withMetadata, withHistory, withRoot
console.log(await ipfs.files.versioned.read("/hello-world.txt",{all:true,withMetadata:true,withHistory:true,withRoot:true}));
// standard ipfs file read returns an array of transforms and metadata, the first item of which has a path (CID) of the original content
console.log(JSON.parse(String.fromCharCode(...await ipvfs.chunksToBuffer(all(ipfs.files.read("/hello-world.txt"))))));
```

# API

## async ipvfs(ipfs:ipfsInstance)

Enhance the `ipfs.files` sub-object to support versioned files with a sub-object  `ipfsInstance.files.versioned`;

returns `ipfs`

## async ipfs.files.versioned.read(path:string,{all,withMetadata,withHistory,withRoot}={})

Reads a versioned file and returns the changed contents as chunks of strings or buffers (depending on content stored) unless `all` is set to true, in which can the entire content is returned at once. In the current version `all` MUST be set to true. Chunking is not yet supported. The API is designed this way to better mirror the regular files API.

The path may end with one of:

- a file name with no version specifier
- a file name with a `#<number>` specifier
- a file name with an `@<string>` specifier

An object is only returned if one of `withMetadata`, `withHistory`, `withRoot` is present, otherwise a string or buffer is returned. The returned object has the following form:

```json
{
    content: string|Buffer|asyncGenerator, // file contents, asyncGenerator if `all` is not set to true
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

## async ipfs.files.versioned.write(path:string,content:string|Buffer,{version,...restOfMetadata}={})

Writes a versioned file.

`version` and `...restOfMetadata` are optional. 

When `version` is provided, it should be a string. It can be retrieved using the `@` form of `read`. Semantic versioning, .e.g. `@1.0.1` is not required, but certainly possible. The calling library will need to handle the semantics. When a version is not provided, a sequential number is assigned that is the same as the history index postion + 1. Previous versiouns can always be retrieved using the `#` from of `read`.

the `restOfMetadata` can be any JSON key vale pairs, including nested ones.

If the file at path does not exist, it is created.

If there are any changes to the `content`, `version` or `restOfMetadata` since the previous write a new `ChangeRecord` is added to the history. Leaving properties out of `restOfMetadata` has them remain the same. To delete a property, use an explicit value of `undefined` or `null`.

# Release History (Reverse Chronological Order)

2023-01-03 v0.0.6a Documentation updates. Passing of standard read/write options. Optimizations usings SHA-256 hashes to compare content.

2023-01-02 v0.0.5a Documentation updates. Chunking working for small files (i.e. those that are a single chunk).

2023-01-02 v0.0.4a Documentation updates. Changed numbering to include the ALPHA (a) indicator.

2023-01-01 v0.0.3 Documentation updates.

2023-01-01 v0.0.2 Documentation updates. Fix to version handling when version does not exist and error throwing when provided # version is not a number.

2023-01-01 v0.0.1 Initial public release
