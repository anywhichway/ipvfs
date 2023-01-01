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
```

# API

## async ipvfs(ipfs:ipfsInstance)

Enhance the `ipfs.files` sub-object to support versioned files with a sub-object  `ipfsInstance.files.versioned`;

returns `ipfs`

## async ipfs.files.versioned.read(path:string,{withMetadata,withHistory,withRoot}={})

Reads a versioned file and returns the ENTIRE contents, which could be a buffer or a string or an object.

The path may end with one of:

- a file name with no version specifier
- a file name with a `#<number>` specifier
- a file name with an `@<string>` specifier

An object is only returned if one of `withMetadata`, `withHistory`, `withRoot` is present. The returned object has the following form:

```json
{
    content: <the file contents as a string or buffer>,
    metadata: {
            version: <a number or the string specifier for the version>
            ... rest <any metadata provided when the file was crrated/written
        },
    history: [
           <ordered array of change records for contents>
    ],
    root: [
         <the first change record for the file, i.e. its creation record>   
    ]
}
```

Change records take the following form:

```javascript
{
    path: <CID of the the base content, only in the first record>,
    version: <manually provided version or the index+1 in the history>,
    kind: <constructor name of original content provided>,
    delta: [
        [start,end,[...additions]]
        ...
    ],
    birthtime: <ms>,
    ctime: <ms>
    ...restOfMetadata <manually provided>
}
```

## async ipfs.files.versioned.write(path:string,content:string|Buffer,{version,...restOfMetadata}={})

Writes a versioned file.

`version` and `...resetOfMetadata` are optional. `version` can be a number or string. If version is a string, it can be retrieved using the `@` form of `read`. Semantic versioning, .e.g. `@1.0.1` is not required, but certainly possible. The calling library will need to handle the semantics.

If the file does not exist, it is created.

If there are any changes since the first write (including changes to the version number of metadata, a new version is created.


# Release History (Reverse Chronological Order)

2023-01-01 v0.0.3 Documentation updates.

2023-01-01 v0.0.2 Documentation updates. Fix to version handling when version does not exist and error throwing when provided # version is not a number.

2023-01-01 v0.0.1 Initial public release
