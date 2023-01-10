import crypto from "crypto";
import {getDelta,applyDelta} from "little-diff";
import {argWaiter} from "arg-waiter";
import {all as allItems} from "@anywhichway/all";

/*const chunksToBuffer = argWaiter((chunks) => {
    return new Uint8Array(chunks.reduce((buffer,chunk) => {
        buffer = [...buffer,...chunk];
        return buffer;
    },[]))
})*/

const chunksToBuffer = argWaiter((chunks) => {
    return chunks.reduce((buffer,chunk) => {
        return [...buffer,...chunk];
        return buffer;
    })
})

const getChangeSets = (history) => {
    const changeSets = [],
        processed = new Map();
    history.forEach((item) => {
        const changeSet = {
            changes: []
        }
        history.forEach(({delta}) => {
            if(!processed.has(delta)) {
                processed.set(delta,new Set());
            }
            const processedChanges = processed.get(delta);
            delta.forEach((change) => {
                if(processedChanges.has(change)) {
                    return;
                }
                const [start,del,changes] = change;
                if(changeSet.start===undefined) {
                    changeSet.start = start;
                    changeSet.end = start + del;
                    processedChanges.add(change);
                    changeSet.changes.push(change);
                }
                if(start<changeSet.start) {
                    changeSet.start = start;
                    changeSet.end = Math.max(start+del,changeSet.end);
                    processedChanges.add(change);
                    changeSet.changes.push(change);
                } else if(start<changeSet.end) {
                    changeSet.end = Math.max(start+del,changeSet.end);
                    processedChanges.add(change);
                    changeSet.changes.push(change);
                }
            })
        })
        if(changeSet.changes.length>0) {
            changeSets.push(changeSet)
        }
    })
    return changeSets;
}

const ipvfs = argWaiter((ipfs) => {
    ipfs.files.versioned = {
        async read(path,{all,withMetadata,withHistory,withRoot,...options}={}) {
            const parts = path.split("/"),
                name = parts.pop(),
                nameParts =  name.includes("@") ? name.split("@") : (name.includes("#") ? name.split("#") : null),
                version = name.includes("@")  ? nameParts.pop() : (name.includes("#") ? parseInt(nameParts.pop()) : null),
                vtype = name.includes("@") ? "@" : (name.includes("#") ? "#" : null),
                buffer = await chunksToBuffer(allItems(ipfs.files.read(nameParts ? parts.join("/") + "/" + nameParts.pop() : path,options))),
                string = String.fromCharCode(...buffer),
                data = JSON.parse(string);
            if(name.includes("#") && isNaN(version)) {
                throw new TypeError(`File version using # is not a number for: ${name}`);
            }
            let i = data.length-1;
            if(vtype) {
                i = -1;
                if(vtype==="#") {
                    if(data[version-1]) {
                        i = version - 1;
                    }
                } else {
                    for(let j=0;j<data.length;j++) { // gets last index in case manual versioning is a bit messed up by users
                        if(data[j].version===version) {
                            i = j;
                        }
                    }
                }
                if(i<0) {
                    throw new Error(`Version ${vtype}${version} not found for ${parts.join("/")}/${name}`)
                }
            }
            const metadata = data[i],
                kind = metadata.kind,
                contentStream = ipfs.cat(data[0].path),
                history = data.slice(0, i + 1);
            let content;
            if(kind==="Object") {
                all = true;
            }
            if(all) {
                const rootBuffer = await chunksToBuffer(allItems(contentStream)),
                    rootContent = ["String","Object"].includes(kind) ? String.fromCharCode(...rootBuffer) : rootBuffer;
                content = history.reduce((targetContent, {delta}) => {
                    return applyDelta(targetContent,delta);
                }, rootContent);
                if(kind==="Object") {
                    content = JSON.parse(content);
                }
            } else {
                const changeSets = getChangeSets(history);
                content = (async function*() {
                    let array = [],
                        offset = 0;
                    for(const {start,end,changes} of changeSets) {
                        const length = end - start;
                        for await(const chunk of contentStream) {
                            array = [...chunk];
                            offset += chunk.length;
                            if(offset<start) {
                                yield kind === "String" ? String.fromCharCode(...new Uint8Array(array)) : new Uint8Array(array);
                            } else {
                                yield kind === "String" ? String.fromCharCode(...new Uint8Array(array.slice(0,offset-(offset-start)))) : new Uint8Array(array.slice(0,offset-(offset-start)));
                                array = array.slice(offset-(offset-start));
                            }
                        }
                        for await(const chunk of contentStream) {
                            array = [...array, ...chunk];
                            offset += chunk.length;
                            if (offset + length >= end) { // read just enough of the file to address all the changes between start and end
                                break;
                            }
                        }
                        const nextarray = array.length >= length ? array.slice(length) : []; // get the portion of the array beyond the current change bounds
                        array = new Uint8Array(array.slice(0,length)); // get the portion of the array within the current change bounds
                        const nextContent =  kind === "String" ? String.fromCharCode(...array) : array;
                        yield applyDelta(nextContent,changes.map(([changeStart,...rest]) => [changeStart-start,...rest])); // apply the change after adjusting for file offset
                        array = nextarray; // set array to the next portion to process
                    }
                    if(array.length>0) { // process portion of file already read, which has no changes
                        yield  kind === "String" ? String.fromCharCode(... new Uint8Array(array)) :  new Uint8Array(array);
                    }
                    for await(const chunk of contentStream) { // process rest of file, which has no changes
                        yield  kind === "String" ? String.fromCharCode(...new Uint8Array([...chunk])) : new Uint8Array([...chunk]);
                    }
                })();
            }
            if(withMetadata||withHistory||withRoot) {
                const result = {
                    content
                }
                if(withRoot) {
                    result.root = data[0];
                }
                if(withMetadata) {
                    result.metadata = metadata;
                    result.metadata.btime = data[0].btime;
                }
                if(withHistory) {
                    result.history =  history;
                }
                return result
            }
            return content;
        },
        async rebase(path,readOptions={},writeOptions={}) {
            const {content,history,metadata} = await ipfs.files.versioned.read(path,{all:true,withHistory:true,withMetadata:true,...readOptions}),
                hash = crypto.createHash('sha256').update(content).digest('hex'),
                version = history[history.length-1].version,
                parts = path.split("/"),
                name = parts.pop(),
                dir = parts.join("/") + "/",
                fname = name.includes("#") ? name.split("#").shift() : name.split("@").shift(),
                currentHistory = JSON.parse(String.fromCharCode(...await chunksToBuffer(allItems(await ipfs.files.read(dir+fname))))),
                now = Date.now(),
                newHistory = currentHistory.slice(history.length).map((item,i)=> {
                    if(typeof(item.version)==="number") {
                        item.version = i+2;
                    }
                    item.mtime = now;
                    return item;
                }),
                btime = history[0].btime,
                rebased = history[0].rebased || [],
                added = await ipfs.add(content);
            delete metadata.btime;
            const data = [{path:added.path,hash,rebased,version:typeof(version)==="string" ? version : 1,...metadata,delta:[],btime,mtime:now},...newHistory];
            data[0].rebased.push([now,version]);
            const string = JSON.stringify(data);
            await ipfs.files.write(dir+fname,string,{...writeOptions,flush:true,truncate:true});
        },
        async write(path,content,{metadata={},asBase,...options}={}) {
            const {version,...rest} = metadata, // todo: provide abiliyt to write using @ in path name
                kind = content && typeof(content)==="object" && !Array.isArray(content) ? "Object" : content.constructor.name,
                parts = path.split("/"),
                name = parts.pop(),
                dir = parts.join("/") + "/",
                files = await allItems(ipfs.files.ls(dir)), // todo: use stat to check for file, less expensive
                file = files.find((file) => file.name===name);
            if(kind==="Object") {
                content = JSON.stringify(content); // use a structured clone here to prevent cyclic errors?
            }
            const hash = crypto.createHash('sha256').update(content).digest('hex');
            if(file) {
                const buffer = await chunksToBuffer(allItems(ipfs.files.read(path))),
                    data = JSON.parse(String.fromCharCode(...buffer)),
                    parent = data[data.length-1];
                if(asBase) {
                    const btime = data[0].btime,
                        rebased = data[0].rebased || [],
                        added = await ipfs.add(content),
                        now = Date.now(),
                        newdata = [{path:added.path,hash,rebased,version:version||1,kind,...rest,delta:[],btime,mtime:now}],
                        string = JSON.stringify(newdata);
                    newdata[0].rebased.push([now,data[0].version]);
                    await ipfs.files.write(path,string,{...options,truncate:true});
                    return;
                }
                if(parent.hash!==hash || (version!==undefined && version!==parent.version) || Object.entries(rest).some(([key,value]) => parent[key]!==value)) {
                    let delta = [];
                    if(parent.hash!==hash) {
                        const rootBuffer = await chunksToBuffer(allItems(ipfs.cat(data[0].path))),
                            rootContent = ["String","Object"].includes(kind) ? String.fromCharCode(...rootBuffer) : rootBuffer,
                            parentContent = data.reduce((parentContent,item) => {
                                return applyDelta(parentContent,item.delta);
                            },rootContent);
                        delta = getDelta(parentContent,content);
                    }
                    data.push({
                        hash,
                        version:version||data.length+1,
                        kind,
                        ...rest,
                        delta,
                        mtime: Date.now()
                    })
                    const string = JSON.stringify(data);
                    await ipfs.files.write(path,string,{...options,truncate:true});
                }
                return;
            }
            const added = await ipfs.add(content),
                now = Date.now(),
                data = [{path:added.path,hash,version:version||1,kind,...rest,delta:[],btime:now,mtime:now}];
            await ipfs.files.write(path,JSON.stringify(data),{...options,create:true,flush:true,parents:true});
        }
    }
    return ipfs;
});

ipvfs.chunksToBuffer = chunksToBuffer;

export {ipvfs,chunksToBuffer,ipvfs as default}

