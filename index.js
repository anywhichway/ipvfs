import {create} from "ipfs";
import {getDelta,applyDelta} from "little-diff";
import {argWaiter} from "arg-waiter";
import {all as allItems} from "@anywhichway/all";

const chunksToBuffer = argWaiter((chunks) => {
    return new Uint8Array(chunks.reduce((buffer,chunk) => {
        buffer = [...buffer,...chunk];
        return buffer;
    },[]))
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
    return changeSets.sort((a,b) => a.start<b.start ? a : b) ;
}

const ipvfs = argWaiter((ipfs) => {
    ipfs.files.versioned = {
        async read(path,{all,withMetadata,withHistory,withRoot}={}) {
            const parts = path.split("/"),
                name = parts.pop(),
                nameParts =  name.includes("@") ? name.split("@") : (name.includes("#") ? name.split("#") : null),
                version = name.includes("@")  ? nameParts.pop() : (name.includes("#") ? parseInt(nameParts.pop()) : null),
                vtype = name.includes("@") ? "@" : (name.includes("#") ? "#" : null),
                buffer = await chunksToBuffer(allItems(ipfs.files.read(nameParts ? parts.join("/") + "/" + nameParts.pop() : path))),
                data = JSON.parse(String.fromCharCode(...buffer));
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
                contentStream = ipfs.cat(data[0].path),
                history = data.slice(0, i + 1);
            let content;
            if(all) {
                const rootBuffer = await chunksToBuffer(allItems(contentStream)),
                    rootContent = metadata.kind === "String" ? String.fromCharCode(...rootBuffer) : rootBuffer;
                content = history.reduce((targetContent, {delta}) => {
                    return applyDelta(targetContent,delta);
                }, rootContent);
            } else {
                const changeSets = getChangeSets(history);
                content = (async function*() {
                    let array = [],
                        read = 0;
                    for(const {start,end,changes} of changeSets) {
                        const offset = start,
                            length = end - start;
                        for await(const chunk of contentStream) {
                            array = [...array,...chunk];
                            read += array.length;
                            if(read<=end) {
                                yield metadata.kind === "String" ? String.fromCharCode(...array) : array;
                            } else if(array.length>=length) {
                                const nextarray = array.slice(array.length-length);
                                array = new Uint8Array(array.slice(0,array.length-length));
                                const nextContent =  metadata.kind === "String" ? String.fromCharCode(...array) : array;
                                yield applyDelta(nextContent,changes.map(([start,...rest]) => [start-offset,...rest]));
                                array = nextarray;
                            }
                        }
                        if(array.length>0) {
                            const nextContent =  metadata.kind === "String" ? String.fromCharCode(...array) : array;
                            yield applyDelta(nextContent,changes.map(([start,...rest]) => [start-offset,...rest]));
                        }
                        array = [];
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
                    result.metadata.birthtime = data[0].birthtime;
                }
                if(withHistory) {
                    result.history =  history;
                }
                return result
            }
            return content;
        },
        async write(path,content,{version,...rest}={}) {
            const kind = content.constructor.name;
            const parts = path.split("/"),
                name = parts.pop(),
                dir = parts.join("/") + "/",
                files = await allItems(ipfs.files.ls(dir)),
                file = files.find((file) => file.name===name);
            if(file) {
                const buffer = await chunksToBuffer(allItems(ipfs.files.read(path))),
                    data = JSON.parse(String.fromCharCode(...buffer)),
                    parent = data[data.length-1],
                    rootBuffer = await chunksToBuffer(allItems(ipfs.cat(data[0].path))),
                    rootContent = kind==="String" ? String.fromCharCode(...rootBuffer) : rootBuffer,
                    parentContent = data.reduce((parentContent,item) => {
                        return applyDelta(parentContent,item.delta);
                    },rootContent),
                    delta = getDelta(parentContent,content);
                if(delta.length>0 || (version!==undefined && version!==parent.version) || Object.entries(rest).some(([key,value]) => parent[key]!==value)) {
                    data.push({
                        version:version||data.length+1,
                        kind,
                        ...rest,
                        delta,
                        mtime: Date.now()
                    })
                    await ipfs.files.rm(path); // write sometimes fails to flush tail of file, so simply delete and re-create
                    await ipfs.files.write(path,JSON.stringify(data),{create:true});
                }
                return;
            }
            const added = await ipfs.add(content),
                now = Date.now(),
                data = [{path:added.path,version:version||1,kind,...rest,delta:[],birthtime:now,mtime:now}];
            await ipfs.files.write(path,JSON.stringify(data),{create:true});
        }
    }
    return ipfs;
});

ipvfs.chunksToBuffer = chunksToBuffer;

export {ipvfs,chunksToBuffer,ipvfs as default}

