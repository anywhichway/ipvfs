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

const isPublishSpec = (spec,history) => {
    if(Object.entries(spec).some(([key,value]) => !["cid","version","hash","path"].includes(key) || value==null)) return false;
    if(typeof(spec.version)!=="number" || typeof(spec.cid)!=="string" || spec.hash!==history[spec.version-1]?.hash) return false;
    return true;
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
            let metadata, history;
            if(data[0].published && !vtype) {
                metadata = data[data[0].published.version-1];
                history = data.slice(0,data[0].published.version);
            } else {
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
                metadata = data[i];
                history = data.slice(0, i + 1);
            }
            const kind = metadata.kind,
                contentStream = ipfs.cat(data[0].path);
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
        async publish(path,target) {
            const parts = path.split("/"),
                name = parts.pop(),
                nameParts =  name.includes("@") ? name.split("@") : (name.includes("#") ? name.split("#") : null),
                result = await ipfs.files.versioned.read(path,{all:true,withHistory:true}),
                hash = crypto.createHash('sha256').update(result.content).digest('hex');
            let version = name.includes("@")  ? nameParts.pop() : (name.includes("#") ? parseInt(nameParts.pop()) : null);
            if(version) {
                version = result.history.findIndex((item) => item.version===version)+1
            }
            let cid;
            if(target) {
                await ipfs.files.write(target,result.content,{create:true});
                const stat = await ipfs.files.stat(target);
                cid = stat.cid.toString();
                await this.write(path,result.content,{metadata:{published:{cid,path:target,version,hash}}});
            } else {
                const added = await ipfs.add(result.content);
                cid = added.path;
                await this.write(path,result.content,{metadata:{published:{cid,version,hash}}});
            }
            return cid;
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
            let {version,...rest} = metadata;
            const kind = content && typeof(content)==="object" && !Array.isArray(content) ? "Object" : content.constructor.name,
                parts = path.split("/"),
                name = parts.pop(),
                nameParts =  name.includes("@") ? name.split("@") : (name.includes("#") ? name.split("#") : null),
                vtype = name.includes("@") ? "@" : (name.includes("#") ? "#" : null),
                dir = parts.join("/") + "/",
                fname = nameParts ? nameParts.shift() : name,
                fpath = dir + fname;
            if(version!=null) {
                const type = typeof(version);
                try {
                    if (type!=="string") throw new Error();
                    const parts = version.split(".");
                    if(parts.length===1) {
                        if(!isNan(parseInt(version))) throw new Error();
                    }
                    if(parts.length===2) {
                        if(!isNaN(parseFloat(version))) throw new Error();
                    }
                } catch(e) {
                    throw new TypeError(`Version provided as argument, ${version}, must be clearly symbolic.`)
                }
            }
            if(vtype) {
                if(version!=null && version!=nameParts[nameParts.length-1]) {
                    console.warn(`WARNING: Version ${nameParts[nameParts.length-1]} in path is overriding ${version} in function arguments.`)
                }
                version = nameParts[nameParts.length-1];
            }
            if(vtype==="#") {
                version = parseInt(version);
                if(isNaN(version)) {
                    throw new TypeError(`#${nameParts[nameParts.length-1]} version must be a number`)
                }
            }
            if(kind==="Object") {
                content = JSON.stringify(content); // use a structured clone here to prevent cyclic errors?
            }
            const hash = crypto.createHash('sha256').update(content).digest('hex');
            let buffer;
            try {
                buffer = await chunksToBuffer(allItems(ipfs.files.read(fpath)));
            } catch(e) {

            }
            if(buffer) {
                const history = JSON.parse(String.fromCharCode(...buffer)),
                    parent = version!=null ? history.find((item) => item.version===version) : history[history.length-1];
                if(asBase) {
                    const btime = history[0].btime,
                        rebased = history[0].rebased || [],
                        added = await ipfs.add(content),
                        now = Date.now(),
                        newhistory = [{path:added.path,hash,rebased,version:version||1,kind,...rest,delta:[],btime,mtime:now}],
                        string = JSON.stringify(newhistory);
                    newhistory[0].rebased.push([now,history[0].version]);
                    await ipfs.files.write(fpath,string,{...options,truncate:true});
                    return;
                }
                if(vtype==="#") {
                    if(parent.hash!==hash) {
                        throw new Error(`Can't write different content for a # numeric version. Try using a @ symbolic version.`)
                    }
                    if(Object.entries(rest).some(([key,value]) => key!=="published" || !isPublishSpec(value,history))) {
                        throw new TypeError(`Can't write a # numeric version with anything other than a publish spec that matches a version in history.`)
                    }
                }
                if(parent.hash!==hash || (version!==undefined && version!==parent.version) || Object.entries(rest).some(([key,value]) => parent[key]!==value)) {
                    let delta = [];
                    if(parent.hash!==hash) {
                        const rootBuffer = await chunksToBuffer(allItems(ipfs.cat(history[0].path))),
                            rootContent = ["String","Object"].includes(kind) ? String.fromCharCode(...rootBuffer) : rootBuffer,
                            parentContent = history.reduce((parentContent,item) => {
                                return applyDelta(parentContent,item.delta);
                            },rootContent);
                        delta = getDelta(parentContent,content);
                    }
                    if(rest.published) {
                        history[0].published = rest.published;
                    } else {
                        history.push({
                            hash,
                            version:version||history.length+1,
                            kind,
                            ...rest,
                            delta,
                            mtime: Date.now()
                        })
                    }
                    const string = JSON.stringify(history);
                    await ipfs.files.write(fpath,string,{...options,truncate:true});
                }
                return;
            }
            const added = await ipfs.add(content),
                now = Date.now(),
                data = [{path:added.path,hash,version:version||1,kind,...rest,delta:[],btime:now,mtime:now}];
            await ipfs.files.write(fpath,JSON.stringify(data),{...options,create:true,flush:true,parents:true});
        }
    }
    return ipfs;
});

ipvfs.chunksToBuffer = chunksToBuffer;

export {ipvfs,chunksToBuffer,ipvfs as default}

